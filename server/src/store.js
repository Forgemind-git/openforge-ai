// Per-user integration settings. Secrets are encrypted as one JSON blob;
// the plain `config` column only ever holds non-secret values.
const db = require('./db');
const { encrypt, decrypt, randomToken } = require('./crypto');

const KINDS = ['model', 'voice', 'google', 'whatsapp', 'telegram'];

function parse(s, fb) { try { return JSON.parse(s); } catch { return fb; } }

function get(userId, kind) {
  const r = db.prepare('SELECT * FROM integrations WHERE user_id = ? AND kind = ?').get(userId, kind);
  if (!r) return { config: {}, secret: {}, hookId: null, status: null, lastError: null, updatedAt: null };
  return {
    config: parse(r.config, {}),
    secret: parse(decrypt(r.secret_enc) || '{}', {}),
    hookId: r.hook_id, status: r.status, lastError: r.last_error, updatedAt: r.updated_at,
  };
}

// Merge semantics: a key passed as undefined keeps its stored value, null removes it.
function save(userId, kind, { config, secret, status, lastError, ensureHook } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown integration ${kind}`);
  const cur = get(userId, kind);
  const merge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b || {})) {
      if (v === undefined) continue;
      if (v === null || v === '') delete out[k]; else out[k] = v;
    }
    return out;
  };
  const nextConfig = merge(cur.config, config);
  const nextSecret = merge(cur.secret, secret);
  const hookId = cur.hookId || (ensureHook ? randomToken(15) : null);
  db.prepare(`
    INSERT INTO integrations (user_id, kind, config, secret_enc, hook_id, status, last_error, updated_at)
    VALUES (@u, @k, @c, @s, @h, @st, @le, datetime('now'))
    ON CONFLICT (user_id, kind) DO UPDATE SET config=@c, secret_enc=@s, hook_id=COALESCE(integrations.hook_id, @h),
      status=@st, last_error=@le, updated_at=datetime('now')
  `).run({
    u: userId, k: kind, c: JSON.stringify(nextConfig),
    s: Object.keys(nextSecret).length ? encrypt(JSON.stringify(nextSecret)) : null,
    h: hookId,
    st: status === undefined ? cur.status : status,
    le: lastError === undefined ? cur.lastError : lastError,
  });
  return get(userId, kind);
}

function setStatus(userId, kind, status, lastError = null) {
  db.prepare(`UPDATE integrations SET status = ?, last_error = ?, updated_at = datetime('now') WHERE user_id = ? AND kind = ?`)
    .run(status, lastError, userId, kind);
}

function clear(userId, kind) {
  db.prepare('DELETE FROM integrations WHERE user_id = ? AND kind = ?').run(userId, kind);
}

function byHook(kind, hookId) {
  const r = db.prepare('SELECT user_id FROM integrations WHERE kind = ? AND hook_id = ?').get(kind, String(hookId || ''));
  return r ? { userId: r.user_id, ...get(r.user_id, kind) } : null;
}

// What the browser may see about a secret: whether it is set, and its last 4.
const mask = (v) => (v ? { set: true, last4: String(v).slice(-4) } : { set: false });

module.exports = { KINDS, get, save, setStatus, clear, byHook, mask };
