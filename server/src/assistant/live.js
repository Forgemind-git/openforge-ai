// Talk mode — Gemini Live, proxied so the user's Gemini key stays on the server
// and the tools run here as the signed-in user.
//
//   browser mic ──PCM16 16k──> us ──realtimeInput──> Gemini Live
//                                   toolCall ──> tools.run(user, args)
//   browser speaker <──PCM16 24k── us <──native audio──┘
//
// Same tool list as typed chat, so the same rule holds: Gemini can read and can
// PREPARE drafts, but nothing is ever sent without the user pressing a button.
const WebSocket = require('ws');
const { WebSocketServer } = require('ws');
const db = require('../db');
const store = require('../store');
const { userFromToken } = require('../auth');
const { COOKIE_NAME } = require('../config');
const { TOOLS, TOOL_BY_NAME, TOOL_LABELS, systemPrompt } = require('./tools');

const PATH = '/api/assistant/live';
const GEMINI_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';
const VOICES = ['Charon', 'Kore', 'Puck', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];
const DEFAULT_VOICE = 'Kore';

// JSON-schema → the OpenAPI subset Gemini takes. Unknown keys are dropped: one
// unrecognised key makes Gemini refuse the whole setup.
function toGeminiSchema(s) {
  if (!s || typeof s !== 'object') return undefined;
  const out = {};
  if (s.type) out.type = String(s.type).toUpperCase();
  if (s.description) out.description = String(s.description);
  if (Array.isArray(s.enum)) out.enum = s.enum.map(String);
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties) { out.properties = {}; for (const [k, v] of Object.entries(s.properties)) out.properties[k] = toGeminiSchema(v); }
  if (Array.isArray(s.required) && s.required.length) out.required = s.required;
  return out;
}

function declarations() {
  return TOOLS.map(({ name, description, input_schema }) => {
    const d = { name, description };
    if (input_schema?.properties && Object.keys(input_schema.properties).length) d.parameters = toGeminiSchema(input_schema);
    return d;
  });
}

function instruction(user, conf, tz) {
  return [
    systemPrompt(user, { tz }), '',
    'THIS IS A LIVE VOICE CONVERSATION. You are speaking out loud:',
    `• Speak in ${conf.language || 'English'}. One to three short sentences per reply. No markdown, lists, ids or links.`,
    '• Calling a tool is silent: never say its name. Say at most one short "checking" line, then the answer.',
    '• When you say you will open something, call open_view in that same moment — the screen moves as you speak.',
    '• Never read out a phone number or an email address. Say the person\'s name.',
    '• Drafts are only drafts: after preparing one, say it is waiting on the Drafts card for them to send.',
    '• If the user talks over you, stop and listen.',
  ].join('\n');
}

const GREETING_CUE = '(The user just switched on voice. Greet them by first name and ask what they would like to do — one short sentence. Do not list your abilities.)';

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch { return false; }
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    let url; try { url = new URL(req.url, 'http://x'); } catch { return; }
    if (url.pathname !== PATH) return;
    const refuse = (code, text) => { try { socket.write(`HTTP/1.1 ${code} ${text}\r\n\r\n`); } catch { /* gone */ } socket.destroy(); };
    if (!originAllowed(req)) return refuse(403, 'Forbidden');
    const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
    const user = userFromToken(m && decodeURIComponent(m[1]));
    if (!user) return refuse(401, 'Unauthorized');
    const tz = url.searchParams.get('tz') || 'UTC';
    wss.handleUpgrade(req, socket, head, (ws) => bridge(ws, user, tz));
  });
}

function bridge(client, user, tz) {
  const send = (o) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(o)); };
  const v = store.get(user.id, 'voice');
  if (!v.secret.apiKey) { send({ type: 'error', error: 'Add your Gemini API key in Settings → Voice to use Talk.' }); client.close(); return; }
  const conf = { model: v.config.model || DEFAULT_MODEL, voice: VOICES.includes(v.config.voice) ? v.config.voice : DEFAULT_VOICE, language: v.config.language || 'English' };

  // Transcript → a normal conversation, so voice sessions show in History.
  const hist = { id: null, user: '', bot: '', steps: [] };
  const flush = (role) => {
    const k = role === 'user' ? 'user' : 'bot';
    const text = hist[k].replace(/\s+/g, ' ').trim(); hist[k] = '';
    const steps = role === 'assistant' ? hist.steps.splice(0) : [];
    if (!text && !steps.length) return;
    try {
      if (!hist.id) {
        hist.id = Number(db.prepare('INSERT INTO conversations (user_id, title) VALUES (?, ?)').run(user.id, role === 'user' ? `🎙 ${text.slice(0, 56)}` : '🎙 Voice conversation').lastInsertRowid);
        send({ type: 'conversation', id: hist.id });
      }
      db.prepare('INSERT INTO messages (conversation_id, role, content, steps) VALUES (?,?,?,?)').run(hist.id, role, text, JSON.stringify(steps));
      db.prepare(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`).run(hist.id);
    } catch (e) { console.warn('[live] transcript save failed:', e.message); }
  };

  let closed = false;
  const upstream = new WebSocket(`${GEMINI_WS}?key=${encodeURIComponent(v.secret.apiKey)}`);
  const shut = () => {
    if (closed) return; closed = true;
    flush('user'); flush('assistant');
    try { upstream.close(); } catch { /* */ }
    try { client.close(); } catch { /* */ }
  };

  upstream.on('open', () => {
    upstream.send(JSON.stringify({
      setup: {
        model: `models/${conf.model}`,
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: conf.voice } } } },
        systemInstruction: { parts: [{ text: instruction(user, conf, tz) }] },
        tools: [{ functionDeclarations: declarations() }],
        inputAudioTranscription: {}, outputAudioTranscription: {},
      },
    }));
  });

  const runTool = async (fc) => {
    const tool = TOOL_BY_NAME[fc.name];
    const args = fc.args || {};
    const label = TOOL_LABELS[fc.name] || fc.name;
    const focus = tool?.focus ? tool.focus(args) : null;
    send({ type: 'tool', phase: 'start', tool: fc.name, label, panels: tool?.panels || [], focus });
    try {
      if (!tool) throw new Error(`Unknown tool ${fc.name}`);
      const out = await tool.run(user, args);
      hist.steps.push({ tool: fc.name, label, status: 'ok', panels: tool.panels, focus });
      send({ type: 'tool', phase: 'done', tool: fc.name, label, panels: tool.panels, focus, drafts: !!tool.drafts });
      return { id: fc.id, name: fc.name, response: { result: out } };
    } catch (e) {
      hist.steps.push({ tool: fc.name, label, status: 'error', error: e.message });
      send({ type: 'tool', phase: 'error', tool: fc.name, label, error: e.message });
      return { id: fc.id, name: fc.name, response: { error: String(e.message).slice(0, 300) } };
    }
  };

  upstream.on('message', async (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    try {
      if (m.setupComplete) {
        send({ type: 'ready', model: conf.model, voice: conf.voice });
        upstream.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: GREETING_CUE }] }], turnComplete: true } }));
        return;
      }
      if (m.toolCall) {
        const functionResponses = [];
        for (const fc of m.toolCall.functionCalls || []) functionResponses.push(await runTool(fc));
        if (!closed && upstream.readyState === WebSocket.OPEN && functionResponses.length) upstream.send(JSON.stringify({ toolResponse: { functionResponses } }));
        return;
      }
      const sc = m.serverContent;
      if (sc) {
        if (sc.interrupted) send({ type: 'interrupted' });
        if (sc.inputTranscription?.text) { if (hist.bot) flush('assistant'); hist.user += sc.inputTranscription.text; send({ type: 'transcript', role: 'user', text: sc.inputTranscription.text }); }
        if (sc.outputTranscription?.text) { if (hist.user) flush('user'); hist.bot += sc.outputTranscription.text; send({ type: 'transcript', role: 'assistant', text: sc.outputTranscription.text }); }
        for (const p of sc.modelTurn?.parts || []) {
          const d = p.inlineData;
          if (d?.data && /audio\/pcm/.test(d.mimeType || '') && client.readyState === WebSocket.OPEN) client.send(Buffer.from(d.data, 'base64'));
        }
        if (sc.turnComplete) { send({ type: 'turn_complete' }); flush('assistant'); }
      }
      if (m.goAway) send({ type: 'error', error: 'The voice session is ending — press Talk again to continue.' });
    } catch (e) { console.error('[live] message handling failed:', e.message); }
  });
  upstream.on('error', (err) => { send({ type: 'error', error: err.message }); shut(); });
  upstream.on('close', (code, reason) => {
    const why = reason && reason.toString();
    if (why && !closed) send({ type: 'error', error: `Gemini closed the session: ${why}` });
    shut();
  });

  client.on('message', (data, isBinary) => {
    if (upstream.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      upstream.send(JSON.stringify({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: Buffer.from(data).toString('base64') } } }));
      return;
    }
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.type === 'text' && m.text) {
      hist.user += String(m.text);
      upstream.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: String(m.text).slice(0, 4000) }] }], turnComplete: true } }));
    }
  });
  client.on('close', shut);
  client.on('error', shut);
}

module.exports = { attach, PATH, VOICES, DEFAULT_VOICE, DEFAULT_MODEL, toGeminiSchema, declarations };
