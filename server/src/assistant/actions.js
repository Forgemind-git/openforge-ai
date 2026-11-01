// The ONLY place a prepared draft becomes real — called from the Drafts card
// when the user presses Send / Confirm. The assistant has no path here.
const db = require('../db');
const google = require('../integrations/google');
const msg = require('../integrations/messaging');

async function execute(userId, actionId, edits = {}) {
  const a = db.prepare('SELECT * FROM actions WHERE id = ? AND user_id = ?').get(Number(actionId), userId);
  if (!a) throw Object.assign(new Error('That draft was not found.'), { status: 404 });
  // Claim it first so a double click cannot send twice.
  const claim = db.prepare(`UPDATE actions SET status = 'done', decided_at = datetime('now') WHERE id = ? AND status = 'pending'`).run(a.id);
  if (!claim.changes) throw Object.assign(new Error(`This draft was already ${a.status === 'done' ? 'sent' : a.status}.`), { status: 409 });
  // The user may edit the text before sending.
  const p = { ...JSON.parse(a.payload), ...Object.fromEntries(Object.entries(edits || {}).filter(([k]) => ['text', 'body', 'subject', 'to', 'title', 'start', 'end', 'due', 'notes', 'description', 'location'].includes(k))) };
  try {
    let result;
    switch (a.kind) {
      case 'chat_message': result = await msg.sendToChat(userId, p.chatId, p.text); break;
      case 'email': case 'email_reply': result = await google.sendMail(userId, { to: p.to, subject: p.subject, body: p.body, replyToId: p.replyToId }); break;
      case 'calendar_event': result = await google.createEvent(userId, p); break;
      case 'task': result = await google.createTask(userId, p); break;
      case 'task_done': result = await google.updateTask(userId, p.listId, p.taskId, { status: 'completed' }); break;
      default: throw new Error(`Unknown draft type ${a.kind}`);
    }
    db.prepare('UPDATE actions SET payload = ?, result = ? WHERE id = ?').run(JSON.stringify(p), JSON.stringify(result || {}), a.id);
    return { ok: true, kind: a.kind, result };
  } catch (e) {
    db.prepare(`UPDATE actions SET status = 'failed', result = ? WHERE id = ?`).run(JSON.stringify({ error: e.message }), a.id);
    throw Object.assign(e, { status: 400 });
  }
}

module.exports = { execute };
