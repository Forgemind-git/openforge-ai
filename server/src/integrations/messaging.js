// WhatsApp Cloud API + Telegram Bot API, and the unified chat inbox both feed.
const crypto = require('crypto');
const db = require('../db');
const store = require('../store');
const { safeEqual } = require('../crypto');

const GRAPH = 'https://graph.facebook.com/v21.0';

// ── inbox storage ──
function upsertChat(userId, channel, externalId, name) {
  db.prepare(`INSERT INTO chats (user_id, channel, external_id, name) VALUES (?,?,?,?)
              ON CONFLICT (user_id, channel, external_id) DO UPDATE SET name = COALESCE(excluded.name, chats.name)`)
    .run(userId, channel, String(externalId), name || null);
  return db.prepare('SELECT * FROM chats WHERE user_id = ? AND channel = ? AND external_id = ?').get(userId, channel, String(externalId));
}

function recordMessage(chat, { direction, externalId, kind = 'text', text, status, at }) {
  const ts = at || new Date().toISOString();
  const r = db.prepare(`INSERT OR IGNORE INTO chat_messages (chat_id, direction, external_id, kind, text, status, at) VALUES (?,?,?,?,?,?,?)`)
    .run(chat.id, direction, externalId || null, kind, text || '', status || null, ts);
  if (!r.changes) return false; // a webhook re-delivery
  db.prepare(`UPDATE chats SET last_at = ?, last_text = ?, unread = unread + ?, last_inbound_at = CASE WHEN ? = 'in' THEN ? ELSE last_inbound_at END WHERE id = ?`)
    .run(ts, (text || `[${kind}]`).slice(0, 200), direction === 'in' ? 1 : 0, direction, ts, chat.id);
  return true;
}

// ── WhatsApp ──
async function waGraph(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(b.error?.error_user_msg || b.error?.message || `WhatsApp API error ${res.status}`);
  return b;
}

async function waTest(phoneNumberId, accessToken) {
  const b = await waGraph(accessToken, `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`);
  return { displayPhone: b.display_phone_number || null, verifiedName: b.verified_name || null };
}

function waVerifySignature(appSecret, rawBody, sigHeader) {
  if (!appSecret) return true; // optional — README recommends setting it
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody || '').digest('hex');
  return safeEqual(expected, sigHeader || '');
}

function waText(m) {
  switch (m.type) {
    case 'text': return m.text?.body || '';
    case 'button': return m.button?.text || '';
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
    case 'image': case 'video': case 'document': case 'audio': case 'sticker':
      return m[m.type]?.caption || `[${m.type}]`;
    case 'location': return `[location ${m.location?.latitude},${m.location?.longitude}]`;
    default: return `[${m.type}]`;
  }
}

function waIngest(userId, body) {
  let n = 0;
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        const chat = upsertChat(userId, 'whatsapp', m.from, names[m.from]);
        if (recordMessage(chat, { direction: 'in', externalId: m.id, kind: m.type, text: waText(m), at: new Date(Number(m.timestamp) * 1000).toISOString() })) n++;
      }
      for (const s of v.statuses || []) {
        db.prepare(`UPDATE chat_messages SET status = ? WHERE external_id = ? AND direction = 'out'
                    AND chat_id IN (SELECT id FROM chats WHERE user_id = ?)`).run(s.status, s.id, userId);
      }
    }
  }
  return n;
}

async function waSend(userId, to, text) {
  const wa = store.get(userId, 'whatsapp');
  if (!wa.config.phoneNumberId || !wa.secret.accessToken) throw new Error('WhatsApp is not set up. Open Settings → WhatsApp.');
  const b = await waGraph(wa.secret.accessToken, `/${encodeURIComponent(wa.config.phoneNumberId)}/messages`, {
    method: 'POST', body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to), type: 'text', text: { body: text, preview_url: true } },
  });
  return b.messages?.[0]?.id || null;
}

// ── Telegram ──
async function tg(token, method, params) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}), signal: AbortSignal.timeout(20000),
  });
  const b = await res.json().catch(() => ({}));
  if (!b.ok) throw new Error(b.description || `Telegram error ${res.status}`);
  return b.result;
}

function tgIngest(userId, update) {
  const m = update.message || update.edited_message || update.channel_post;
  if (!m) return 0;
  const chatName = m.chat.title || [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || m.chat.username || String(m.chat.id);
  const chat = upsertChat(userId, 'telegram', m.chat.id, chatName);
  const kind = m.text != null ? 'text' : m.photo ? 'image' : m.voice ? 'audio' : m.document ? 'document' : m.sticker ? 'sticker' : 'other';
  const text = m.text ?? m.caption ?? `[${kind}]`;
  return recordMessage(chat, { direction: 'in', externalId: `${m.message_id}${update.edited_message ? '-e' : ''}`, kind, text, at: new Date(m.date * 1000).toISOString() }) ? 1 : 0;
}

async function tgSend(userId, chatId, text) {
  const t = store.get(userId, 'telegram');
  if (!t.secret.botToken) throw new Error('Telegram is not set up. Open Settings → Telegram.');
  const r = await tg(t.secret.botToken, 'sendMessage', { chat_id: chatId, text });
  return String(r.message_id);
}

// ── sending from the inbox (only ever called by a user action) ──
async function sendToChat(userId, chatId, text) {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(Number(chatId), userId);
  if (!chat) throw new Error('That chat was not found.');
  if (!String(text || '').trim()) throw new Error('Type a message first.');
  if (chat.channel === 'whatsapp') {
    // Meta refuses free text more than 24h after the customer last wrote.
    const last = chat.last_inbound_at ? new Date(chat.last_inbound_at).getTime() : 0;
    if (Date.now() - last > 24 * 3600 * 1000) throw new Error('WhatsApp only allows a free-text reply within 24 hours of the person\'s last message. Their window is closed.');
  }
  const extId = chat.channel === 'whatsapp' ? await waSend(userId, chat.external_id, text) : await tgSend(userId, chat.external_id, text);
  recordMessage(chat, { direction: 'out', externalId: extId, text, status: 'sent' });
  return { id: extId };
}

module.exports = { upsertChat, recordMessage, waTest, waVerifySignature, waIngest, waSend, tg, tgIngest, tgSend, sendToChat };
