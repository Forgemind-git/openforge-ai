// Settings → every user's own credentials. Secrets go in, never come back out:
// the browser only learns whether each one is set (and its last 4 characters).
const express = require('express');
const db = require('../db');
const store = require('../store');
const baseUrl = require('../baseUrl');
const { randomToken } = require('../crypto');
const llm = require('../integrations/llm');
const google = require('../integrations/google');
const msg = require('../integrations/messaging');
const live = require('../assistant/live');

const router = express.Router();
const s = (v) => (typeof v === 'string' ? v.trim() : v);

function view(req) {
  const uid = req.user.id;
  const base = baseUrl(req);
  const model = store.get(uid, 'model');
  const voice = store.get(uid, 'voice');
  const g = store.get(uid, 'google');
  const wa = store.get(uid, 'whatsapp');
  const tg = store.get(uid, 'telegram');
  return {
    model: {
      provider: model.config.provider || null, model: model.config.model || null,
      apiKey: store.mask(model.secret.apiKey), status: model.status, lastError: model.lastError,
      defaults: llm.DEFAULT_MODELS,
    },
    voice: {
      apiKey: store.mask(voice.secret.apiKey), model: voice.config.model || live.DEFAULT_MODEL,
      voice: voice.config.voice || live.DEFAULT_VOICE, language: voice.config.language || 'English',
      voices: live.VOICES, status: voice.status, lastError: voice.lastError,
    },
    google: {
      clientId: g.config.clientId || '', clientSecret: store.mask(g.secret.clientSecret),
      connected: !!g.secret.refreshToken && g.status === 'connected', status: g.status, lastError: g.lastError,
      email: g.config.email || null, scopes: g.config.scopes || [], redirectUri: `${base}/api/google/callback`,
      javascriptOrigin: base,
    },
    whatsapp: {
      phoneNumberId: wa.config.phoneNumberId || '', displayPhone: wa.config.displayPhone || null,
      accessToken: store.mask(wa.secret.accessToken), verifyToken: wa.secret.verifyToken || '',
      appSecret: store.mask(wa.secret.appSecret), status: wa.status, lastError: wa.lastError,
      callbackUrl: wa.hookId ? `${base}/api/webhooks/whatsapp/${wa.hookId}` : null,
      lastEventAt: wa.config.lastEventAt || null,
    },
    telegram: {
      botToken: store.mask(tg.secret.botToken), botUsername: tg.config.botUsername || null,
      webhookUrl: tg.config.webhookUrl || null, status: tg.status, lastError: tg.lastError,
      lastEventAt: tg.config.lastEventAt || null,
    },
  };
}

router.get('/settings', (req, res) => res.json(view(req)));

// ── model ──
router.put('/settings/model', async (req, res) => {
  const { provider, apiKey, model } = req.body || {};
  if (!['openai', 'anthropic'].includes(provider)) return res.status(400).json({ error: 'Pick OpenAI or Anthropic.' });
  const cur = store.get(req.user.id, 'model');
  const switching = cur.config.provider && cur.config.provider !== provider;
  const key = s(apiKey) || (switching ? null : cur.secret.apiKey);
  if (!key) return res.status(400).json({ error: `Paste your ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key.` });
  let models = [];
  try { models = await llm.listModels(provider, key); }
  catch (e) { return res.status(400).json({ error: `That key did not work — ${e.message}` }); }
  const chosen = s(model) || llm.DEFAULT_MODELS[provider][0];
  store.save(req.user.id, 'model', { config: { provider, model: chosen }, secret: { apiKey: key }, status: 'connected', lastError: null });
  res.json({ ...view(req), models });
});
router.get('/settings/model/models', async (req, res) => {
  const m = store.get(req.user.id, 'model');
  if (!m.secret.apiKey) return res.json({ models: [] });
  try { res.json({ models: await llm.listModels(m.config.provider, m.secret.apiKey) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── voice (Gemini Live) ──
router.put('/settings/voice', async (req, res) => {
  const { apiKey, model, voice, language } = req.body || {};
  const cur = store.get(req.user.id, 'voice');
  const key = s(apiKey) || cur.secret.apiKey;
  if (!key) return res.status(400).json({ error: 'Paste your Gemini API key.' });
  if (s(apiKey)) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error?.message || `HTTP ${r.status}`); }
    } catch (e) { return res.status(400).json({ error: `That Gemini key did not work — ${e.message}` }); }
  }
  store.save(req.user.id, 'voice', {
    config: { model: s(model) || live.DEFAULT_MODEL, voice: live.VOICES.includes(voice) ? voice : live.DEFAULT_VOICE, language: s(language) || 'English' },
    secret: { apiKey: key }, status: 'connected', lastError: null,
  });
  res.json(view(req));
});

// ── Google ──
router.put('/settings/google', (req, res) => {
  const { clientId, clientSecret } = req.body || {};
  if (!s(clientId) || !/\.apps\.googleusercontent\.com$/.test(s(clientId))) return res.status(400).json({ error: 'The Client ID ends in .apps.googleusercontent.com — paste the whole value.' });
  const cur = store.get(req.user.id, 'google');
  if (!s(clientSecret) && !cur.secret.clientSecret) return res.status(400).json({ error: 'Paste the Client Secret too.' });
  const changedClient = cur.config.clientId && cur.config.clientId !== s(clientId);
  store.save(req.user.id, 'google', {
    config: { clientId: s(clientId), ...(changedClient ? { email: null, scopes: null, expiresAt: null } : {}) },
    secret: { clientSecret: s(clientSecret) || undefined, ...(changedClient ? { accessToken: null, refreshToken: null } : {}) },
    status: changedClient ? 'saved' : (cur.status || 'saved'),
  });
  res.json(view(req));
});
router.post('/settings/google/connect', (req, res) => {
  const g = store.get(req.user.id, 'google');
  if (!g.config.clientId || !g.secret.clientSecret) return res.status(400).json({ error: 'Save your Client ID and Secret first.' });
  db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(Date.now() - 15 * 60000);
  const state = randomToken(24);
  db.prepare('INSERT INTO oauth_states (state, user_id, created_at) VALUES (?,?,?)').run(state, req.user.id, Date.now());
  res.json({ url: google.authUrl({ clientId: g.config.clientId, redirectUri: `${baseUrl(req)}/api/google/callback`, state }) });
});
router.post('/settings/google/disconnect', (req, res) => {
  store.save(req.user.id, 'google', { config: { email: null, scopes: null, expiresAt: null }, secret: { accessToken: null, refreshToken: null }, status: 'saved', lastError: null });
  res.json(view(req));
});

// ── WhatsApp Cloud API ──
router.put('/settings/whatsapp', async (req, res) => {
  const { phoneNumberId, accessToken, verifyToken, appSecret } = req.body || {};
  const cur = store.get(req.user.id, 'whatsapp');
  const token = s(accessToken) || cur.secret.accessToken;
  if (!s(phoneNumberId) || !/^\d{6,}$/.test(s(phoneNumberId))) return res.status(400).json({ error: 'The Phone number ID is the long number from WhatsApp → API Setup (not the phone number itself).' });
  if (!token) return res.status(400).json({ error: 'Paste the access token.' });
  let info;
  try { info = await msg.waTest(s(phoneNumberId), token); }
  catch (e) { return res.status(400).json({ error: `Meta refused those details — ${e.message}` }); }
  store.save(req.user.id, 'whatsapp', {
    config: { phoneNumberId: s(phoneNumberId), displayPhone: info.displayPhone, verifiedName: info.verifiedName },
    secret: { accessToken: token, verifyToken: s(verifyToken) || cur.secret.verifyToken || randomToken(18), appSecret: s(appSecret) || undefined },
    status: 'connected', lastError: null, ensureHook: true,
  });
  res.json(view(req));
});
router.delete('/settings/whatsapp', (req, res) => { store.clear(req.user.id, 'whatsapp'); res.json(view(req)); });

// ── Telegram ──
router.put('/settings/telegram', async (req, res) => {
  const { botToken } = req.body || {};
  const cur = store.get(req.user.id, 'telegram');
  const token = s(botToken) || cur.secret.botToken;
  if (!token || !/^\d+:[\w-]{20,}$/.test(token)) return res.status(400).json({ error: 'A bot token looks like 123456789:AA… — get it from @BotFather.' });
  let me;
  try { me = await msg.tg(token, 'getMe'); }
  catch (e) { return res.status(400).json({ error: `Telegram refused that token — ${e.message}` }); }
  const saved = store.save(req.user.id, 'telegram', {
    config: { botUsername: me.username }, secret: { botToken: token, webhookSecret: cur.secret.webhookSecret || randomToken(24) },
    status: 'saved', ensureHook: true,
  });
  const url = `${baseUrl(req)}/api/webhooks/telegram/${saved.hookId}`;
  try {
    await msg.tg(token, 'setWebhook', { url, secret_token: saved.secret.webhookSecret, allowed_updates: ['message', 'edited_message', 'channel_post'], drop_pending_updates: false });
    store.save(req.user.id, 'telegram', { config: { webhookUrl: url }, status: 'connected', lastError: null });
  } catch (e) {
    store.save(req.user.id, 'telegram', { status: 'error', lastError: `Could not register the webhook: ${e.message}` });
  }
  res.json(view(req));
});
router.delete('/settings/telegram', async (req, res) => {
  const t = store.get(req.user.id, 'telegram');
  if (t.secret.botToken) { try { await msg.tg(t.secret.botToken, 'deleteWebhook', {}); } catch { /* best effort */ } }
  store.clear(req.user.id, 'telegram');
  res.json(view(req));
});

// Clear any single integration.
router.delete('/settings/:kind', (req, res) => {
  if (!['model', 'voice', 'google'].includes(req.params.kind)) return res.status(404).json({ error: 'Unknown setting.' });
  store.clear(req.user.id, req.params.kind);
  res.json(view(req));
});

module.exports = router;
