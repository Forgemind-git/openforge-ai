// Reads the morning brief out loud and tells the page which line is being heard,
// so the Forge AI logo can move to the card that line is about.
//
//   live   — Gemini Live in mode 'narrate' (no microphone, no tools). The whole
//            script goes up as ONE message, so it is read as one continuous take.
//            The session streams back audio and a transcript of what it said; the
//            transcript's word count, lined up with the audio received, tells us
//            which script word is playing right now.
//   browser — the browser's own speech synthesis, one line at a time; the next
//            line starts when the previous one has finished speaking.
//
// narrate(lines, { live, onLine(i), onProgress(i, frac), onMode(mode), onDone() }) → { stop() }
import { createGeminiLive, canPlayLive } from './geminiLive';

const wordCount = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const PACE = 2.6;   // spoken words per second, before we have measured any

function lineStarts(lines) {
  const out = []; let at = 0;
  for (const l of lines) { out.push(at); at += wordCount(l); }
  return { starts: out, total: at };
}

export function narrate(lines, { live = false, onLine, onProgress, onMode, onDone } = {}) {
  const run = { stopped: false, timer: 0, raf: 0, session: null };
  let current = -1;
  const show = (i, frac) => {
    if (run.stopped) return;
    if (i !== current) { current = i; onLine && onLine(i); }
    onProgress && onProgress(i, Math.max(0, Math.min(1, frac)));
  };
  const finish = () => {
    if (run.stopped) return;
    run.stopped = true;
    clearTimeout(run.timer); cancelAnimationFrame(run.raf);
    try { run.session?.stop(); } catch { /* closed */ }
    onDone && onDone();
  };

  // ── the browser voice ──
  function browser() {
    onMode && onMode('browser');
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    let i = 0;
    const next = () => {
      if (run.stopped) return;
      if (i >= lines.length) { finish(); return; }
      const k = i; i += 1;
      const est = Math.max(2.2, wordCount(lines[k]) / PACE + 0.4);   // seconds, for the progress bar
      const t0 = performance.now();
      const tick = () => { if (run.stopped || current !== k) return; show(k, (performance.now() - t0) / 1000 / est); run.raf = requestAnimationFrame(tick); };
      show(k, 0); run.raf = requestAnimationFrame(tick);
      let moved = false;
      // Next line after this one finished speaking — but never sooner than a reading
      // pace allows, so a browser with no voice installed still walks the tour.
      const go = () => {
        if (moved) return; moved = true; clearTimeout(run.timer);
        const minMs = est * 600 - (performance.now() - t0);
        run.timer = setTimeout(next, Math.max(350, minMs));
      };
      if (synth) {
        try {
          const u = new SpeechSynthesisUtterance(lines[k]);
          u.rate = 1.03;
          u.onend = go; u.onerror = go;
          synth.speak(u);
        } catch { /* no voice: the timer below moves on */ }
      }
      // Safety net: some browsers never fire onend (or have no voice at all).
      run.timer = setTimeout(go, (est + (synth ? 6 : 0)) * 1000);
    };
    try { synth?.cancel(); } catch { /* */ }
    next();
  }

  // ── the live Gemini voice ──
  function geminiLive() {
    onMode && onMode('live');
    const { starts, total } = lineStarts(lines);
    const heard = [[0, 0]];          // [words said so far, audio seconds received by then]
    let audio = 0;                   // seconds of audio received
    let playStart = null;            // wall clock when the first audio began to play
    let complete = false; let gotAudio = false;

    // Which script word is playing at audio time `t` (seconds into the take).
    const wordAt = (t) => {
      for (let j = 1; j < heard.length; j++) {
        const [w1, a1] = heard[j]; const [w0, a0] = heard[j - 1];
        if (t <= a1) return a1 > a0 ? w0 + ((t - a0) / (a1 - a0)) * (w1 - w0) : w1;
      }
      const [wl, al] = heard[heard.length - 1];
      if (complete) return audio > al ? wl + ((t - al) / (audio - al)) * Math.max(0, total - wl) : total;
      return wl + (t - al) * PACE;
    };
    const tick = () => {
      if (run.stopped) return;
      const t = (performance.now() - playStart) / 1000;
      const w = wordAt(t);
      let i = 0; while (i + 1 < lines.length && w >= starts[i + 1]) i += 1;
      const end = i + 1 < lines.length ? starts[i + 1] : total;
      show(i, (w - starts[i]) / Math.max(1, end - starts[i]));
      if (complete && t >= audio + 0.4) { finish(); return; }
      run.raf = requestAnimationFrame(tick);
    };
    const fallBack = () => {
      if (gotAudio || run.stopped) return;
      try { run.session?.stop(); } catch { /* */ }
      run.session = null; browser();
    };
    run.session = createGeminiLive({
      mode: 'narrate', listen: false,
      onReady: () => { show(0, 0); run.session.sendText(lines.join('\n')); run.timer = setTimeout(fallBack, 8000); },
      onAudio: (sec) => {
        if (!gotAudio) { gotAudio = true; clearTimeout(run.timer); playStart = performance.now() + 250; run.raf = requestAnimationFrame(tick); }
        audio += sec;
      },
      onTranscript: (role, text) => {
        if (role !== 'assistant') return;
        const n = wordCount(text);
        if (n) heard.push([heard[heard.length - 1][0] + n, audio]);
      },
      onTurnComplete: () => { complete = true; },
      onError: () => fallBack(),
      onClose: () => { if (!gotAudio) fallBack(); else complete = true; },
    });
    run.session.start().catch(fallBack);
  }

  if (live && canPlayLive()) geminiLive(); else browser();

  return {
    stop() {
      run.stopped = true;
      clearTimeout(run.timer); cancelAnimationFrame(run.raf);
      try { run.session?.stop(); } catch { /* */ }
      try { window.speechSynthesis?.cancel(); } catch { /* */ }
    },
  };
}
