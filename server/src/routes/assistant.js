// Typed chat with the assistant: SSE over a POST. Events:
//   conversation {id} · step {phase,tool,label,panels,focus} · message {content,steps} · error {error} · done
const express = require('express');
const db = require('../db');
const store = require('../store');
const llm = require('../integrations/llm');
const { TOOLS, TOOL_BY_NAME, TOOL_LABELS, systemPrompt } = require('../assistant/tools');

const router = express.Router();
const HISTORY_TURNS = 20;

router.get('/assistant/conversations', (req, res) => {
  res.json({ conversations: db.prepare('SELECT id, title, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 60').all(req.user.id) });
});
router.get('/assistant/conversations/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found.' });
  const messages = db.prepare('SELECT id, role, content, steps, created_at FROM messages WHERE conversation_id = ? ORDER BY id').all(c.id)
    .map(m => ({ ...m, steps: JSON.parse(m.steps || '[]') }));
  res.json({ conversation: c, messages });
});
router.delete('/assistant/conversations/:id', (req, res) => {
  db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

router.post('/assistant/chat', async (req, res) => {
  const text = String(req.body?.message || '').trim().slice(0, 8000);
  if (!text) return res.status(400).json({ error: 'Type a message.' });
  const model = store.get(req.user.id, 'model');
  if (!model.secret.apiKey || !model.config.provider) {
    // A fresh install's normal state, not a failure: answer in-stream.
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Add your OpenAI or Anthropic key in Settings → Model first.' })}\n\nevent: done\ndata: {}\n\n`);
    return res.end();
  }

  let convId = Number(req.body?.conversationId) || null;
  if (convId && !db.prepare('SELECT 1 FROM conversations WHERE id = ? AND user_id = ?').get(convId, req.user.id)) convId = null;
  if (!convId) convId = Number(db.prepare('INSERT INTO conversations (user_id, title) VALUES (?, ?)').run(req.user.id, text.slice(0, 60)).lastInsertRowid);
  const history = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?').all(convId, HISTORY_TURNS).reverse()
    .filter(m => m.content);
  db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)').run(convId, 'user', text);

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client left */ } };
  send('conversation', { id: convId });

  const steps = [];
  const runTool = async (name, args) => {
    const tool = TOOL_BY_NAME[name];
    if (!tool) throw new Error(`Unknown tool ${name}`);
    const label = TOOL_LABELS[name] || name;
    const focus = tool.focus ? tool.focus(args) : null;
    send('step', { phase: 'start', tool: name, label, panels: tool.panels, focus });
    try {
      const out = await tool.run(req.user, args || {});
      steps.push({ tool: name, label, status: 'ok', panels: tool.panels, focus });
      send('step', { phase: 'done', tool: name, label, panels: tool.panels, focus, drafts: !!tool.drafts });
      return out;
    } catch (e) {
      steps.push({ tool: name, label, status: 'error', error: e.message });
      send('step', { phase: 'error', tool: name, label, error: e.message });
      throw e;
    }
  };

  try {
    const out = await llm.runAgent({
      provider: model.config.provider, apiKey: model.secret.apiKey, model: model.config.model || llm.DEFAULT_MODELS[model.config.provider][0],
      system: systemPrompt(req.user, { tz: String(req.body?.tz || '') }), history: [...history, { role: 'user', content: text }],
      tools: TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })), runTool,
    });
    const content = out.text || '(no answer)';
    db.prepare('INSERT INTO messages (conversation_id, role, content, steps) VALUES (?,?,?,?)').run(convId, 'assistant', content, JSON.stringify(steps));
    db.prepare(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`).run(convId);
    send('message', { content, steps, usage: out.usage });
  } catch (e) {
    if (e.status === 401) store.setStatus(req.user.id, 'model', 'error', e.message);
    send('error', { error: e.message });
  }
  send('done', {});
  res.end();
});

module.exports = router;
