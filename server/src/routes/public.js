// Public endpoints: the Google OAuth return, and the two chat webhooks.
// Each webhook URL carries an unguessable per-user hook id; WhatsApp is also
// checked against the user's verify token (+ app secret signature if set) and
// Telegram against the secret token we registered with setWebhook.
const express = require('express');
const db = require('../db');
const store = require('../store');
const baseUrl = require('../baseUrl');
const { safeEqual } = require('../crypto');
const google = require('../integrations/google');
const msg = require('../integrations/messaging');
const bus = require('../bus');

const router = express.Router();

const page = (title, text, ok) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font-family:system-ui,sans-serif;background:#f1f1f0;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="background:#fff;border-radius:16px;padding:28px 32px;max-width:420px;box-shadow:0 8px 24px rgba(0,0,0,.06)">
<h2 style="margin:0 0 8px;color:${ok ? '#16a34a' : '#dc2626'}">${title}</h2><p style="color:#4d4d55;line-height:1.5">${text}</p>
<a href="/#/settings" style="color:#dc2626;font-weight:700">Back to Open Forge AI</a></div>
<script>try{window.opener&&window.opener.postMessage({type:'openforge:google',ok:${ok ? 'true' : 'false'}},location.origin);setTimeout(()=>window.close(),${ok ? 900 : 4000})}catch(e){}</script>`;
const esc = (v) => String(v || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

router.get('/google/callback', async (req, res) => {
  const { state, code, error } = req.query;
  const row = state && db.prepare('SELECT * FROM oauth_states WHERE state = ?').get(String(state));
  if (row) db.prepare('DELETE FROM oauth_states WHERE state = ?').run(String(state));
  if (!row || Date.now() - row.created_at > 15 * 60000) return res.status(400).type('html').send(page('Link expired', 'That sign-in link expired. Press Connect again in Settings → Google.', false));
  if (error) return res.status(400).type('html').send(page('Google said no', `Google returned: ${esc(error)}`, false));
  try {
    await google.exchangeCode(row.user_id, String(code), `${baseUrl(req)}/api/google/callback`);
    res.type('html').send(page('Google connected', 'Gmail, Calendar and Tasks are connected. You can close this window.', true));
  } catch (e) {
    store.setStatus(row.user_id, 'google', 'error', e.message);
    res.status(400).type('html').send(page('Could not connect', esc(e.message), false));
  }
});

// ── WhatsApp Cloud API ──
router.get('/webhooks/whatsapp/:hook', (req, res) => {
  const wa = store.byHook('whatsapp', req.params.hook);
  if (!wa) return res.sendStatus(404);
  if (req.query['hub.mode'] === 'subscribe' && safeEqual(req.query['hub.verify_token'], wa.secret.verifyToken)) {
    return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
  }
  res.sendStatus(403);
});

router.post('/webhooks/whatsapp/:hook', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => {
  const wa = store.byHook('whatsapp', req.params.hook);
  if (!wa) return res.sendStatus(404);
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!msg.waVerifySignature(wa.secret.appSecret, raw, req.headers['x-hub-signature-256'])) return res.sendStatus(401);
  let body; try { body = JSON.parse(raw.toString('utf8')); } catch { return res.sendStatus(400); }
  res.sendStatus(200); // answer Meta fast; work after
  try {
    const n = msg.waIngest(wa.userId, body);
    store.save(wa.userId, 'whatsapp', { config: { lastEventAt: new Date().toISOString() } });
    if (n) bus.emit('chats', wa.userId);
  } catch (e) { console.error('[whatsapp] ingest failed:', e.message); }
});

// ── Telegram ──
router.post('/webhooks/telegram/:hook', express.json({ limit: '1mb' }), (req, res) => {
  const t = store.byHook('telegram', req.params.hook);
  if (!t) return res.sendStatus(404);
  if (!safeEqual(req.headers['x-telegram-bot-api-secret-token'], t.secret.webhookSecret)) return res.sendStatus(401);
  res.sendStatus(200);
  try {
    const n = msg.tgIngest(t.userId, req.body || {});
    store.save(t.userId, 'telegram', { config: { lastEventAt: new Date().toISOString() } });
    if (n) bus.emit('chats', t.userId);
  } catch (e) { console.error('[telegram] ingest failed:', e.message); }
});

module.exports = router;
