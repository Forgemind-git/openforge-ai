// ── Forge AI live voice client (Gemini Live) ────────────────────────────────
// Talks to our own backend (/api/assistant/live), which holds the Gemini key.
// The browser half of the mediator. Talks to our own backend (never to Google) over
// one WebSocket: raw PCM up, raw PCM down, small JSON envelopes for everything else.
//
//   mic → AudioWorklet → Int16 PCM 16kHz ──binary──> /api/assistant/live
//   speaker ← AudioWorklet jitter buffer ← binary ── PCM 24kHz
//
// BOTH directions run on the audio thread on purpose. The main thread is shared
// with React, and a render landing at the wrong moment used to hold up playback
// (audible as a stutter) and hold up outgoing mic frames (which delays the point
// where Gemini decides you have stopped talking, i.e. the whole reply).
//
// Two things this has that the batch STT engine cannot:
//   • no turn boundary — audio streams continuously, so Gemini hears you interrupt
//   • server-side VAD — no client RMS heuristic deciding when you stopped talking
//
// Echo: the mic is NOT hard-muted while the agent speaks (that would kill barge-in,
// the entire point of a live model). We rely on getUserMedia's echoCancellation, and
// on `interrupted` from the server to drop buffered playback the moment Gemini
// decides you have started talking over it.

const IN_RATE = 16000;    // what the Live API expects from us
const OUT_RATE = 24000;   // what it sends back

// AudioWorklet source: downsamples whatever the mic context runs at to 16k mono
// Int16 and posts it back. A worklet (not ScriptProcessor) so capture runs on the
// audio thread and does not glitch when React re-renders.
const WORKLET = `
class PcmDown extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.ratio = sampleRate / ${IN_RATE};
    this.acc = 0;
    this.buf = [];
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // Linear decimation. The mic is speech at 48k; a proper FIR would be nicer but
    // the Live API resamples server-side anyway and this keeps the worklet cheap.
    for (let i = 0; i < ch.length; i++) {
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        let s = Math.max(-1, Math.min(1, ch[i]));
        this.buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
    }
    if (this.buf.length >= 1024) {
      const out = new Int16Array(this.buf.splice(0, this.buf.length));
      this.port.postMessage(out, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-down', PcmDown);
`;

// ── Playback jitter buffer ───────────────────────────────────────────────────
// Playback used to be a queue of AudioBufferSourceNodes scheduled off a cursor on
// the MAIN thread, with a 40ms lead. Two things broke it, and both bite hardest in
// the first second of a reply, when the buffer is shallowest:
//   • 40ms is less than the jitter of a socket that crosses the proxy and the
//     public internet, so a late frame lands after its slot has already passed —
//     the cursor resets to now+40ms and the gap is audible as a stutter; and
//   • the scheduling runs on the main thread, so ANY long React render (the chat
//     is being rewritten word by word while the agent talks) delays it by exactly
//     as long as the render takes.
// So playback moved to the audio thread. Chunks are handed to a worklet that owns
// a sample queue and emits continuously from it; scheduling can no longer drift,
// and a busy main thread can no longer interrupt audio that is already buffered —
// it only has to hand over the bytes before the buffer drains.
//
// PREBUF is the cold-start cushion (how much audio we hold before the first sound
// of a turn); REARM is the smaller cushion used to resume after the queue runs dry
// mid-reply, so a natural pause does not cost the full lead-in again.
const PREBUF_S = 0.22;
const REARM_S = 0.08;
// Report "stopped speaking" only after this much continuous silence. Without the
// hold, every gap between frames flipped the speaking flag, which drives React
// state on the other side — the visuals flickered and the swarm could clear
// mid-reply. The same threshold means "the turn is over", which is what re-arms
// the cold-start cushion for the next one.
const QUIET_HOLD_S = 0.3;
// Silence → mid-waveform is a step discontinuity, and a step is a click. Ramp in
// over a few ms whenever playback starts from nothing, so the first word opens
// cleanly instead of with a tick in front of it.
const FADE_S = 0.006;

const PLAYER_WORKLET = `
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = [];          // queued Float32Array chunks
    this.head = 0;        // read offset into q[0]
    this.queued = 0;      // samples still unplayed
    this.playing = false; // false = filling the buffer
    this.primed = false;  // past the cold-start cushion for THIS turn
    this.speaking = false;
    this.dry = 0;         // consecutive silent samples
    this.fade = 0;        // samples left in the ramp-in
    this.drain = false;   // play out what is queued regardless of the threshold
    this.prebuf = Math.round(${PREBUF_S} * sampleRate);
    this.rearm = Math.round(${REARM_S} * sampleRate);
    this.quiet = Math.round(${QUIET_HOLD_S} * sampleRate);
    this.fadeLen = Math.round(${FADE_S} * sampleRate);
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d && d.flush) {
        this.q = []; this.head = 0; this.queued = 0;
        this.playing = false; this.primed = false; this.drain = false;
        this.say(false);
      } else if (d && d.drain) {
        // The turn is finished upstream, so no more audio is coming for it. Play
        // whatever is left even if it never reached the cushion — otherwise a reply
        // shorter than the cushion sits in the buffer until the NEXT turn pushes it
        // out, which arrives as a fragment glued to the front of the next reply.
        this.drain = true;
      } else if (d && d.pcm) {
        this.q.push(d.pcm);
        this.queued += d.pcm.length;
      }
    };
  }
  say(v) {
    if (v === this.speaking) return;
    this.speaking = v;
    this.port.postMessage({ speaking: v });
  }
  process(inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    if (!this.playing && this.queued > 0) {
      // NOTE: no backticks in here — this whole class is a template literal, and one
      // stray backtick ends the string with a parse error a long way from the cause.
      //
      // The primed flag is per TURN, not per session. It used to be set once and
      // never cleared, so only the very first reply of a session got the cold-start
      // cushion and every later one opened on the much smaller re-arm — the start of
      // a turn, exactly when the model is still ramping up and delivery is at its
      // most uneven. That was the glitchy first word.
      const need = this.drain ? 1 : (this.primed ? this.rearm : this.prebuf);
      if (this.queued >= need) {
        this.playing = true;
        this.primed = true;
        this.fade = this.fadeLen;   // open with a ramp, not a step
      }
    }
    let i = 0;
    if (this.playing) {
      while (i < out.length && this.q.length) {
        const cur = this.q[0];
        const n = Math.min(out.length - i, cur.length - this.head);
        out.set(cur.subarray(this.head, this.head + n), i);
        i += n; this.head += n; this.queued -= n;
        if (this.head >= cur.length) { this.q.shift(); this.head = 0; }
      }
    }
    if (this.fade > 0 && i > 0) {
      const n = Math.min(i, this.fade);
      for (let k = 0; k < n; k++) out[k] *= (this.fadeLen - this.fade + k) / this.fadeLen;
      this.fade -= n;
    }
    if (i < out.length) {
      out.fill(0, i);
      // Ran dry. Go back to filling rather than emitting whatever trickles in —
      // playing single frames as they arrive is exactly the word-by-word chop we
      // are trying to avoid.
      this.playing = false;
      this.drain = false;
      this.dry += out.length - i;
      if (this.dry >= this.quiet) {
        // Quiet this long is a turn boundary, not a hiccup: stop reporting speech
        // AND re-arm the full cushion so the next turn opens on a deep buffer.
        this.say(false);
        this.primed = false;
      }
    } else {
      this.dry = 0;
      this.say(true);
    }
    return true;
  }
}
registerProcessor('pcm-player', PcmPlayer);
`;

// Playing a live voice (no microphone) needs only audio + a socket — not the
// microphone / AudioWorklet that the two-way session needs (both are secure-context only).
export function canPlayLive() {
  return !!((window.AudioContext || window.webkitAudioContext) && window.WebSocket);
}

export function isGeminiLiveSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
    (window.AudioContext || window.webkitAudioContext) &&
    window.WebSocket && window.AudioWorklet);
}

// `mode: 'brief'` opens the session as a morning brief (Gemini starts it, in
// its own voice) instead of the usual greeting.
// `listen: false` opens no microphone (the scripted brief only plays); `onAudio(sec)`
// reports each chunk's length so a caller can keep a screen in step with the voice.
export function createGeminiLive({ onReady, onTranscript, onTool, onError, onSpeakingChange, onClose, onConversation, onTurnComplete, onProgress, onAudio, mode = null, listen = true, lang = null, voice = null }) {
  let ws = null, micCtx = null, outCtx = null, stream = null, node = null, src = null;
  let workletUrl = null, playerUrl = null;
  let player = null;          // the playback worklet, when available
  let stopped = false;
  let muted = false;             // hold-your-voice: frames dropped, session kept alive
  let playAt = 0;             // fallback path: next scheduled time on the output clock
  let sources = [];           // fallback path: live sources, so a barge-in can kill them
  let speaking = false;

  const setSpeaking = (v) => { if (v !== speaking) { speaking = v; onSpeakingChange && onSpeakingChange(v); } };

  // Drop everything queued for playback — used on barge-in and on stop.
  function flushPlayback() {
    if (player) { try { player.port.postMessage({ flush: true }); } catch {} }
    for (const s of sources) { try { s.stop(); } catch {} }
    sources = [];
    playAt = 0;
    setSpeaking(false);
  }

  function playChunk(arrayBuf) {
    if (!outCtx || stopped) return;
    const pcm = new Int16Array(arrayBuf);
    if (!pcm.length) return;
    if (onAudio) { try { onAudio(pcm.length / OUT_RATE); } catch {} }
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 0x8000;
    if (player) {
      // Transferred, not copied — the buffer is ours and we are done with it.
      player.port.postMessage({ pcm: f32 }, [f32.buffer]);
      return;
    }
    // Fallback for a browser that would not give us a playback worklet. Same
    // scheduler as before, but with the cold-start cushion raised from 40ms to
    // PREBUF_S, which is what made the first second of a reply chop.
    const buf = outCtx.createBuffer(1, f32.length, OUT_RATE);
    buf.getChannelData(0).set(f32);
    const s = outCtx.createBufferSource();
    s.buffer = buf;
    s.connect(outCtx.destination);
    const now = outCtx.currentTime;
    if (playAt < now) playAt = now + PREBUF_S;
    s.start(playAt);
    playAt += buf.duration;
    setSpeaking(true);
    sources.push(s);
    s.onended = () => {
      sources = sources.filter((x) => x !== s);
      if (!sources.length) setSpeaking(false);
    };
  }

  async function start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (listen) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      micCtx = new AC();
      if (micCtx.state === 'suspended') await micCtx.resume();
      workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await micCtx.audioWorklet.addModule(workletUrl);
    }
    outCtx = new AC({ sampleRate: OUT_RATE });
    if (outCtx.state === 'suspended') await outCtx.resume();

    // Playback runs on the audio thread (see PLAYER_WORKLET). If the browser will
    // not take it, playChunk falls back to main-thread scheduling rather than
    // leaving the session mute.
    try {
      playerUrl = URL.createObjectURL(new Blob([PLAYER_WORKLET], { type: 'application/javascript' }));
      await outCtx.audioWorklet.addModule(playerUrl);
      player = new AudioWorkletNode(outCtx, 'pcm-player', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      });
      player.port.onmessage = (e) => {
        if (e.data && typeof e.data.speaking === 'boolean') setSpeaking(e.data.speaking);
      };
      player.connect(outCtx.destination);
    } catch {
      player = null;
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const qs = new URLSearchParams({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', ...(mode ? { mode } : {}), ...(lang ? { lang } : {}), ...(voice ? { voice } : {}) }).toString();
    ws = new WebSocket(`${proto}//${location.host}/api/assistant/live${qs ? `?${qs}` : ''}`);
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) { playChunk(e.data); return; }
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'ready') onReady && onReady(m);
      else if (m.type === 'transcript') onTranscript && onTranscript(m.role, m.text);
      else if (m.type === 'conversation') onConversation && onConversation(m.id);   // saved to History
      else if (m.type === 'tool') onTool && onTool(m);
      else if (m.type === 'progress') onProgress && onProgress(m);   // a long tool's live progress (multi-chat analysis)
      else if (m.type === 'interrupted') flushPlayback();
      // Nothing more is coming for this turn, so the buffer may play out even if it
      // never reached the cold-start cushion (a two-syllable reply would otherwise
      // be stranded until the next turn pushed it out).
      else if (m.type === 'turn_complete') { if (player) { try { player.port.postMessage({ drain: true }); } catch {} } onTurnComplete && onTurnComplete(); }
      else if (m.type === 'error') onError && onError(m.error);
    };
    ws.onerror = () => onError && onError('Realtime connection failed.');
    ws.onclose = () => { if (!stopped) onClose && onClose(); };

    await new Promise((res, rej) => {
      ws.onopen = res;
      setTimeout(() => rej(new Error('Realtime connection timed out.')), 15000);
    });

    if (!listen) return;
    src = micCtx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(micCtx, 'pcm-down');
    node.port.onmessage = (e) => {
      if (stopped || muted || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(e.data.buffer !== undefined ? e.data.buffer : e.data);
    };
    src.connect(node);
    // The worklet emits nothing downstream, but Chrome will not pull from a node
    // with no sink — a zero-gain connection keeps it running without any output.
    const mute = micCtx.createGain(); mute.gain.value = 0;
    node.connect(mute); mute.connect(micCtx.destination);
  }

  // Mute WITHOUT tearing down the session — for demoing the agent to people in the
  // room whose voices must not become input. Two layers on purpose:
  //   • the captured frames are dropped here, so nothing reaches Google, and
  //   • the mic track is disabled, so the browser's own recording indicator goes
  //     off. Telling someone they are muted while the tab still shows a live mic
  //     is not a promise worth making.
  // The socket stays open, so unmuting resumes instantly with full context.
  function setMuted(v) {
    muted = !!v;
    try { stream && stream.getAudioTracks().forEach((t) => { t.enabled = !muted; }); } catch {}
    return muted;
  }

  function sendText(text) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'text', text }));
  }

  function stop() {
    stopped = true;
    flushPlayback();
    try { node && node.disconnect(); } catch {}
    try { player && player.disconnect(); } catch {}
    try { src && src.disconnect(); } catch {}
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { micCtx && micCtx.close(); } catch {}
    try { outCtx && outCtx.close(); } catch {}
    try { ws && ws.close(); } catch {}
    if (workletUrl) { try { URL.revokeObjectURL(workletUrl); } catch {} }
    if (playerUrl) { try { URL.revokeObjectURL(playerUrl); } catch {} }
    ws = null; node = null; src = null; stream = null; micCtx = null; outCtx = null; player = null;
  }

  return { start, stop, sendText, setMuted, isMuted: () => muted, isSpeaking: () => speaking };
}
