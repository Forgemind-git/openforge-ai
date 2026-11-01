// SQLite — one file in the data volume. Schema is created idempotently at boot.
const path = require('path');
const Database = require('better-sqlite3');
const { DATA_DIR } = require('./config');

const db = new Database(path.join(DATA_DIR, 'openforge.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per user per integration. Secret values live in secret_enc
-- (AES-256-GCM JSON); non-secret config in config (plain JSON).
CREATE TABLE IF NOT EXISTS integrations (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,          -- model | voice | google | whatsapp | telegram
  config     TEXT NOT NULL DEFAULT '{}',
  secret_enc TEXT,
  hook_id    TEXT UNIQUE,            -- public, unguessable id used in webhook URLs
  status     TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('whatsapp','telegram')),
  external_id TEXT NOT NULL,         -- WhatsApp wa_id / Telegram chat id
  name        TEXT,
  last_at     TEXT,
  last_text   TEXT,
  last_inbound_at TEXT,
  unread      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, channel, external_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  external_id TEXT,
  kind        TEXT NOT NULL DEFAULT 'text',
  text        TEXT,
  status      TEXT,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_msg_ext ON chat_messages(chat_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_chat_msg_chat ON chat_messages(chat_id, id);

CREATE TABLE IF NOT EXISTS conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'New conversation',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL DEFAULT '',
  steps           TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Drafts the assistant PREPARED. Nothing is ever sent until the user presses
-- Send / Confirm on one of these.
CREATE TABLE IF NOT EXISTS actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,         -- chat_message | email | email_reply | calendar_event | task
  title       TEXT NOT NULL,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','discarded','failed')),
  result      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at  TEXT
);
`);

module.exports = db;
