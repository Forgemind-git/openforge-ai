// GitHub star count for the top bar's star button, kept in the database so the
// number survives restarts and still shows when GitHub is unreachable or
// rate-limits us. One row is added each time the count changes (a small
// history); the newest row for a repo is its current count.
const db = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS github_stars (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  repo       TEXT NOT NULL,
  stars      INTEGER NOT NULL,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_github_stars_repo ON github_stars(repo, id);
`);

const latest = db.prepare('SELECT id, stars, checked_at FROM github_stars WHERE repo = ? ORDER BY id DESC LIMIT 1');
const insert = db.prepare('INSERT INTO github_stars (repo, stars) VALUES (?, ?)');
const touch = db.prepare("UPDATE github_stars SET checked_at = datetime('now') WHERE id = ?");

const REFRESH_MS = 3600e3;
const fetchedAt = new Map();

async function refresh(repo) {
  const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'open-forge-ai' }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) return; // private, missing or rate-limited: keep the stored count
  const n = (await r.json()).stargazers_count;
  if (!Number.isInteger(n)) return;
  const last = latest.get(repo);
  if (last && last.stars === n) touch.run(last.id);
  else insert.run(repo, n);
}

// { stars, starsCheckedAt } — the stored count, refreshed from GitHub at most hourly.
async function getStars(repo) {
  if (Date.now() - (fetchedAt.get(repo) || 0) > REFRESH_MS) {
    fetchedAt.set(repo, Date.now());
    try { await refresh(repo); } catch { /* keep the stored count */ }
  }
  const row = latest.get(repo);
  return row ? { stars: row.stars, starsCheckedAt: `${row.checked_at.replace(' ', 'T')}Z` } : { stars: null, starsCheckedAt: null };
}

module.exports = { getStars };
