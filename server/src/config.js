// Runtime configuration. OpenForge AI ships with NO credentials: the two server
// secrets (session signing + at-rest encryption) come from the environment, or
// are generated on first boot into the data volume. Every third-party key
// (OpenAI / Anthropic / Gemini / Google / WhatsApp / Telegram) is entered by each
// user on the Settings page and stored encrypted in the database.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

function fileSecret(name) {
  const p = path.join(DATA_DIR, name);
  try {
    const v = fs.readFileSync(p, 'utf8').trim();
    if (v.length >= 32) return v;
  } catch { /* first boot */ }
  const v = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(p, v, { mode: 0o600 });
  return v;
}

const env = (k) => (process.env[k] || '').trim();

module.exports = {
  PORT: Number(env('PORT') || 3000),
  DATA_DIR,
  // Used to build webhook + OAuth redirect URLs. Without it they are derived
  // from the incoming request (X-Forwarded-Proto / Host).
  PUBLIC_URL: env('PUBLIC_URL').replace(/\/+$/, ''),
  SESSION_SECRET: env('SESSION_SECRET') || fileSecret('.session_secret'),
  ENCRYPTION_KEY: env('ENCRYPTION_KEY') || fileSecret('.encryption_key'),
  COOKIE_NAME: 'openforge_session',
  // OFF unless both are set. Seeds this account at boot and SHOWS the email and
  // password on the sign-in page — only for a public demo install, never production.
  DEMO_LOGIN_EMAIL: env('DEMO_LOGIN_EMAIL'),
  DEMO_LOGIN_PASSWORD: env('DEMO_LOGIN_PASSWORD'),
  // The GitHub repo the top bar's star button points at ("owner/name"); set to
  // "none" to hide it. Its star count is fetched by the server and cached.
  GITHUB_REPO: env('OPENFORGE_GITHUB_REPO') || 'Forgemind-git/openforge-ai',
  NODE_ENV: env('NODE_ENV') || 'development',
};
