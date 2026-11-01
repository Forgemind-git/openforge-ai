// Google — Gmail, Calendar, Tasks — over each user's OWN OAuth client.
// The user pastes a Client ID + Secret on Settings → Google, whitelists our
// redirect URI in Google Cloud, then presses Connect.
const store = require('../store');

const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
];

function authUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(20000),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(b.error_description || b.error || `Google token error ${res.status}`);
  return b;
}

async function exchangeCode(userId, code, redirectUri) {
  const g = store.get(userId, 'google');
  const t = await tokenRequest({ code, client_id: g.config.clientId, client_secret: g.secret.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  let email = null;
  try {
    const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } });
    email = (await r.json()).email || null;
  } catch { /* email is cosmetic */ }
  store.save(userId, 'google', {
    config: { email, scopes: String(t.scope || '').split(' '), expiresAt: Date.now() + (t.expires_in || 3600) * 1000 },
    secret: { accessToken: t.access_token, refreshToken: t.refresh_token || undefined },
    status: 'connected', lastError: null,
  });
}

class GoogleNotConnected extends Error {}

async function accessToken(userId) {
  const g = store.get(userId, 'google');
  if (!g.secret.refreshToken && !g.secret.accessToken) throw new GoogleNotConnected('Google is not connected. Open Settings → Google and press Connect.');
  if (g.secret.accessToken && g.config.expiresAt > Date.now() + 60000) return g.secret.accessToken;
  if (!g.secret.refreshToken) throw new GoogleNotConnected('Google sign-in expired. Reconnect it in Settings → Google.');
  try {
    const t = await tokenRequest({ client_id: g.config.clientId, client_secret: g.secret.clientSecret, refresh_token: g.secret.refreshToken, grant_type: 'refresh_token' });
    store.save(userId, 'google', { config: { expiresAt: Date.now() + (t.expires_in || 3600) * 1000 }, secret: { accessToken: t.access_token }, status: 'connected', lastError: null });
    return t.access_token;
  } catch (e) {
    // invalid_grant = revoked, or an OAuth app left in "Testing" (7-day refresh tokens).
    store.setStatus(userId, 'google', 'expired', e.message);
    throw new GoogleNotConnected(`Google sign-in expired (${e.message}). Reconnect it in Settings → Google.`);
  }
}

async function api(userId, url, { method = 'GET', body } = {}) {
  const tok = await accessToken(userId);
  const res = await fetch(url, {
    method, headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  if (res.status === 204) return {};
  const b = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = b.error?.message || `Google API error ${res.status}`;
    if (res.status === 403 && /insufficient|scope/i.test(msg)) throw new Error('Google did not grant this permission. Reconnect Google in Settings and tick every box on the consent screen.');
    throw new Error(msg);
  }
  return b;
}

// ── Gmail ──
const header = (msg, name) => (msg.payload?.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

function decodeBody(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  for (const p of part.parts || []) { const t = decodeBody(p); if (t) return t; }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function mailSummary(m) {
  return {
    id: m.id, threadId: m.threadId, from: header(m, 'From'), to: header(m, 'To'), subject: header(m, 'Subject') || '(no subject)',
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null, snippet: m.snippet || '',
    unread: (m.labelIds || []).includes('UNREAD'),
  };
}

async function listMail(userId, { q = 'in:inbox', max = 15 } = {}) {
  const list = await api(userId, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: String(Math.min(max, 30)) })}`);
  const ids = (list.messages || []).map(m => m.id);
  const msgs = await Promise.all(ids.map(id => api(userId, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`)));
  return msgs.map(mailSummary);
}

async function readMail(userId, id) {
  const m = await api(userId, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
  return { ...mailSummary(m), messageId: header(m, 'Message-ID'), body: decodeBody(m.payload).slice(0, 20000) };
}

function encodeHeader(v) { return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`; }

async function sendMail(userId, { to, subject, body, replyToId }) {
  let threadId; let inReply = '';
  if (replyToId) {
    const orig = await readMail(userId, replyToId);
    threadId = orig.threadId;
    inReply = orig.messageId;
    if (!subject) subject = /^re:/i.test(orig.subject) ? orig.subject : `Re: ${orig.subject}`;
    if (!to) to = orig.from;
  }
  if (!to) throw new Error('No recipient.');
  const lines = [
    `To: ${to}`, `Subject: ${encodeHeader(subject || '')}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit',
    ...(inReply ? [`In-Reply-To: ${inReply}`, `References: ${inReply}`] : []), '', body || '',
  ];
  const raw = Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
  const r = await api(userId, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: { raw, ...(threadId ? { threadId } : {}) } });
  return { id: r.id, threadId: r.threadId };
}

// ── Calendar ──
function eventSummary(e) {
  return {
    id: e.id, title: e.summary || '(no title)', start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date,
    allDay: !!e.start?.date, location: e.location || '', link: e.htmlLink, meet: e.hangoutLink || null,
    attendees: (e.attendees || []).length, description: (e.description || '').slice(0, 600),
  };
}
async function listEvents(userId, { from, to, max = 50 } = {}) {
  const timeMin = new Date(from || Date.now() - 864e5).toISOString();
  const timeMax = new Date(to || Date.now() + 14 * 864e5).toISOString();
  const b = await api(userId, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: String(max) })}`);
  return (b.items || []).filter(e => e.status !== 'cancelled').map(eventSummary);
}
async function createEvent(userId, { title, start, end, allDay, description, location, timeZone }) {
  const body = { summary: title, description: description || undefined, location: location || undefined };
  if (allDay) { body.start = { date: String(start).slice(0, 10) }; body.end = { date: String(end || start).slice(0, 10) }; }
  else {
    const s = new Date(start); const e = end ? new Date(end) : new Date(s.getTime() + 30 * 60000);
    if (isNaN(s)) throw new Error('The event needs a valid start time.');
    body.start = { dateTime: s.toISOString(), ...(timeZone ? { timeZone } : {}) };
    body.end = { dateTime: e.toISOString(), ...(timeZone ? { timeZone } : {}) };
  }
  return eventSummary(await api(userId, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', body }));
}

// ── Tasks ──
async function taskLists(userId) {
  const b = await api(userId, 'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=20');
  return (b.items || []).map(l => ({ id: l.id, title: l.title }));
}
async function listTasks(userId, { showCompleted = true } = {}) {
  const lists = await taskLists(userId);
  const out = [];
  for (const l of lists.slice(0, 8)) {
    const b = await api(userId, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(l.id)}/tasks?${new URLSearchParams({ maxResults: '100', showCompleted: String(showCompleted), showHidden: String(showCompleted) })}`);
    for (const t of b.items || []) {
      if (!t.title) continue;
      out.push({ id: t.id, listId: l.id, list: l.title, title: t.title, notes: t.notes || '', due: t.due ? t.due.slice(0, 10) : null, status: t.status, completed: t.completed || null, updated: t.updated });
    }
  }
  return { lists, tasks: out };
}
async function createTask(userId, { title, notes, due, listId }) {
  const lid = listId || (await taskLists(userId))[0]?.id || '@default';
  const body = { title, ...(notes ? { notes } : {}), ...(due ? { due: `${String(due).slice(0, 10)}T00:00:00.000Z` } : {}) };
  const t = await api(userId, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(lid)}/tasks`, { method: 'POST', body });
  return { id: t.id, listId: lid, title: t.title, due: t.due ? t.due.slice(0, 10) : null };
}
async function updateTask(userId, listId, taskId, patch) {
  const body = {};
  if (patch.status === 'completed') { body.status = 'completed'; }
  if (patch.status === 'needsAction') { body.status = 'needsAction'; body.completed = null; }
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.due !== undefined) body.due = patch.due ? `${String(patch.due).slice(0, 10)}T00:00:00.000Z` : null;
  return api(userId, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body });
}
async function deleteTask(userId, listId, taskId) {
  return api(userId, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

module.exports = {
  SCOPES, authUrl, exchangeCode, accessToken, GoogleNotConnected,
  listMail, readMail, sendMail, listEvents, createEvent, taskLists, listTasks, createTask, updateTask, deleteTask,
};
