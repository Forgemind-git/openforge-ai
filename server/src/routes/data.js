// What the office cards read, plus the direct actions a PERSON takes from them
// (tick a task, add an event, reply in a chat). These are user clicks, not the
// assistant — the assistant can only prepare drafts.
const express = require('express');
const db = require('../db');
const store = require('../store');
const bus = require('../bus');
const google = require('../integrations/google');
const msg = require('../integrations/messaging');
const { chatRow } = require('../assistant/tools');
const actions = require('../assistant/actions');

const router = express.Router();

// Wrap async handlers; Google "not connected" becomes a 409 the cards render as a prompt.
const h = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    const status = e instanceof google.GoogleNotConnected ? 409 : (e.status || 400);
    res.status(status).json({ error: e.message, notConnected: e instanceof google.GoogleNotConnected });
  }
};

router.get('/office/status', (req, res) => {
  const k = (kind) => store.get(req.user.id, kind);
  const m = k('model'); const v = k('voice'); const g = k('google'); const w = k('whatsapp'); const t = k('telegram');
  res.json({
    model: !!m.secret.apiKey, modelName: m.config.model || null, provider: m.config.provider || null,
    voice: !!v.secret.apiKey,
    google: !!g.secret.refreshToken && g.status === 'connected', googleExpired: g.status === 'expired',
    whatsapp: !!w.secret.accessToken, telegram: !!t.secret.botToken,
  });
});

// ── tasks ──
router.get('/tasks', h(async (req, res) => res.json(await google.listTasks(req.user.id, { showCompleted: true }))));
router.post('/tasks', h(async (req, res) => {
  if (!String(req.body?.title || '').trim()) return res.status(400).json({ error: 'Give the task a title.' });
  res.status(201).json(await google.createTask(req.user.id, req.body));
}));
router.patch('/tasks/:listId/:taskId', h(async (req, res) => res.json(await google.updateTask(req.user.id, req.params.listId, req.params.taskId, req.body || {}))));
router.delete('/tasks/:listId/:taskId', h(async (req, res) => { await google.deleteTask(req.user.id, req.params.listId, req.params.taskId); res.json({ ok: true }); }));

// ── calendar ──
router.get('/calendar', h(async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  res.json({ events: await google.listEvents(req.user.id, { from, to, max: 150 }) });
}));
router.post('/calendar', h(async (req, res) => {
  if (!String(req.body?.title || '').trim()) return res.status(400).json({ error: 'Give the event a title.' });
  res.status(201).json(await google.createEvent(req.user.id, req.body));
}));

// ── mail ──
router.get('/mail', h(async (req, res) => res.json({ messages: await google.listMail(req.user.id, { q: String(req.query.q || 'in:inbox'), max: Number(req.query.max) || 20 }) })));
router.get('/mail/:id', h(async (req, res) => res.json(await google.readMail(req.user.id, req.params.id))));
router.post('/mail/send', h(async (req, res) => {
  const { to, subject, body, replyToId } = req.body || {};
  if (!String(body || '').trim()) return res.status(400).json({ error: 'The email is empty.' });
  res.json(await google.sendMail(req.user.id, { to, subject, body, replyToId }));
}));

// ── chats ──
router.get('/chats', (req, res) => {
  const rows = db.prepare('SELECT * FROM chats WHERE user_id = ? ORDER BY COALESCE(last_at, \'\') DESC LIMIT 300').all(req.user.id);
  res.json({ chats: rows.map(chatRow) });
});
router.get('/chats/:id/messages', (req, res) => {
  const c = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!c) return res.status(404).json({ error: 'Chat not found.' });
  db.prepare('UPDATE chats SET unread = 0 WHERE id = ?').run(c.id);
  const messages = db.prepare('SELECT id, direction, kind, text, status, at FROM chat_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 200').all(c.id).reverse();
  res.json({ chat: chatRow({ ...c, unread: 0 }), messages });
});
router.post('/chats/:id/send', h(async (req, res) => {
  const r = await msg.sendToChat(req.user.id, req.params.id, String(req.body?.text || ''));
  bus.emit('chats', req.user.id);
  res.json(r);
}));

// ── drafts (prepared by the assistant) ──
router.get('/actions', (req, res) => {
  const rows = db.prepare(`SELECT * FROM actions WHERE user_id = ? AND (status = 'pending' OR decided_at > datetime('now','-1 day')) ORDER BY id DESC LIMIT 50`).all(req.user.id);
  res.json({ actions: rows.map(a => ({ ...a, payload: JSON.parse(a.payload), result: a.result ? JSON.parse(a.result) : null })) });
});
router.post('/actions/:id/confirm', h(async (req, res) => {
  const out = await actions.execute(req.user.id, req.params.id, req.body?.edits);
  bus.emit('chats', req.user.id);
  res.json(out);
}));
router.post('/actions/:id/discard', (req, res) => {
  db.prepare(`UPDATE actions SET status = 'discarded', decided_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'pending'`).run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ── live updates (new chat messages) ──
router.get('/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('event: hello\ndata: {}\n\n');
  const onChats = (uid) => { if (uid === req.user.id) res.write('event: chats\ndata: {}\n\n'); };
  bus.on('chats', onChats);
  const ka = setInterval(() => res.write(': ka\n\n'), 25000);
  req.on('close', () => { clearInterval(ka); bus.off('chats', onChats); });
});

module.exports = router;
