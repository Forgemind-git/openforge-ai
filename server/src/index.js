// OpenForge AI — API server + the built web app, one process.
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { PORT, GITHUB_REPO } = require('./config');
require('./db');
const { getStars } = require('./stars');
const auth = require('./auth');
const live = require('./assistant/live');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind one reverse proxy (Traefik / nginx)

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'", 'wss:', 'ws:'],
      'media-src': ["'self'", 'blob:'],
      'worker-src': ["'self'", 'blob:'],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.get('/health', (req, res) => res.json({ ok: true }));

// Star count for the top bar's GitHub button. Fetched here (not by the browser)
// at most hourly, so visitors never hit GitHub's anonymous rate limit, and stored
// in the database (see stars.js). A repo never seen public reports stars: null.
app.get('/api/meta', async (req, res) => {
  const repo = /^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPO) ? GITHUB_REPO : null;
  const { stars, starsCheckedAt } = repo ? await getStars(repo) : { stars: null, starsCheckedAt: null };
  res.json({ repo, url: repo ? `https://github.com/${repo}` : null, stars, starsCheckedAt });
});

// Public (no session): OAuth return + webhooks. Mounted BEFORE the JSON parser,
// because the WhatsApp signature is computed over the raw body.
app.use('/api', require('./routes/public'));

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, validate: { xForwardedForHeader: false } }));
app.use('/api/auth', auth.router);
app.use('/api', auth.requireAuth, require('./routes/settings'));
app.use('/api', auth.requireAuth, require('./routes/assistant'));
app.use('/api', auth.requireAuth, require('./routes/data'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// The web app (built by Vite into ../public).
const pub = path.join(__dirname, '..', 'public');
if (fs.existsSync(pub)) {
  app.use(express.static(pub, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (/\/assets\//.test(p)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
  app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const server = http.createServer(app);
live.attach(server);
server.listen(PORT, () => console.log(`[openforge-ai] listening on :${PORT}`));
