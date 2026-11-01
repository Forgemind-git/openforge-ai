# Open Forge

A self-hosted, open-source AI assistant for your **tasks, calendar, mail and chats** — in one office-style screen.

Open Forge puts your Google Tasks, Google Calendar, Gmail and a unified WhatsApp + Telegram inbox around an assistant called **Forge**. Ask it anything ("what's on my plate today?", "which chats are waiting on me?", "draft a reply to Priya's email") by typing, or press **Talk** and speak to it in real time.

**Forge never sends anything on its own.** When it wants to send a message, an email, add an event or create a task, it prepares a **draft** on the *Drafts to approve* card. Nothing leaves until you press **Send / Confirm** (you can edit the draft first).

It ships with **zero credentials**. Every person on an install brings their own keys:

| What | Used for | Where you get it |
|---|---|---|
| OpenAI **or** Anthropic API key | the chat model + tool calling | platform.openai.com · console.anthropic.com |
| Gemini API key | **Talk** — real-time voice (Gemini Live) | aistudio.google.com/apikey |
| Google OAuth Client ID + Secret | Gmail, Google Calendar, Google Tasks | Google Cloud Console |
| WhatsApp Cloud API phone number ID + token | WhatsApp chats | developers.facebook.com |
| Telegram bot token | Telegram chats | @BotFather |

Keys are entered on the **Settings** page and stored **encrypted** (AES-256-GCM) in the server's database. They are never sent back to the browser.

---

## Features

- **Office view** — Calendar, Mail and Conversations on the left; the animated Forge assistant and chat in the middle; Tasks, Chats and Drafts on the right. Light and dark themes.
- **Chat with tools** — Forge reads your real data through tools (overview of the day, tasks, events, mail search/read, chats) and opens the relevant card on screen.
- **Talk** — live, interruptible voice with Gemini Live, using the same tools. Transcripts are saved to your conversation history.
- **Tasks** — a kanban (Overdue / Today / Upcoming / Done) over all your Google Tasks lists. Drag to re-date, tick to complete, add new.
- **Calendar** — a week view of your primary Google Calendar; add events.
- **Mail** — Gmail inbox with search, a reader and reply.
- **Chats** — one inbox for WhatsApp (Cloud API webhook) and Telegram (bot webhook). Reply from the app. Respects WhatsApp's 24-hour reply window.
- **Drafts to approve** — everything the assistant prepares waits here for your button press.
- **Multi-user** — the first visitor creates the admin account (no default password); the admin adds more people. Everyone's keys and data are separate.
- Phone numbers are masked in the assistant's view and answers.

## Quick start (Docker)

```bash
git clone https://github.com/Forgemind-git/open-forge.git
cd open-forge
cp .env.example .env          # set PUBLIC_URL to the address you will open
docker compose up -d --build
```

Open `http://localhost:3000` (or your `PUBLIC_URL`) and **create the admin account**. Then go to **Settings** and add your keys.

> WhatsApp and Telegram webhooks, and Google sign-in on anything but localhost, need a **public HTTPS** address. Put Open Forge behind a reverse proxy with TLS (see below) and set `PUBLIC_URL` to that address.

### Behind Traefik

`docker-compose.traefik.yml` attaches the container to an existing Traefik network and requests a Let's Encrypt certificate:

```bash
# in .env
PUBLIC_URL=https://openforge.example.com
OPENFORGE_HOST=openforge.example.com
TRAEFIK_NETWORK=traefik          # the external network Traefik watches
TRAEFIK_CERTRESOLVER=letsencrypt # your certificate resolver's name

docker compose -f docker-compose.traefik.yml up -d --build
```

Any other proxy works too (nginx, Caddy): forward everything to port 3000, including **WebSocket upgrades** on `/api/assistant/live` (Talk) and unbuffered responses on `/api/assistant/chat` and `/api/events` (server-sent events).

### Server settings (`.env`)

| Variable | Meaning |
|---|---|
| `PUBLIC_URL` | Public origin, no trailing slash. Builds the OAuth redirect and webhook URLs. If empty, it is derived from the request headers. |
| `OPENFORGE_PORT` | Host port for `docker-compose.yml` (default 3000). |
| `SESSION_SECRET`, `ENCRYPTION_KEY` | Optional. If blank, random values are generated on first boot and stored in the data volume. **Changing `ENCRYPTION_KEY` later makes saved keys unreadable** (everyone re-enters them). |

Data (SQLite database + generated secrets) lives in the `openforge-data` volume at `/data`. Back that up.

## Setting up each integration

### 1. Model — OpenAI or Anthropic
Settings → **Model**: pick the provider, paste your API key, choose a model (the list is fetched from the provider with your key). Saving tests the key.

### 2. Voice — Gemini Live
Settings → **Voice**: paste a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). Pick a voice and the Live model (default `gemini-3.1-flash-live-preview`; any Gemini model that supports the Live API works). Press **Talk** on the main screen — the browser asks for the microphone (needs HTTPS).

### 3. Google — Gmail, Calendar, Tasks
Each user uses **their own** Google Cloud OAuth client:

1. Open [Google Cloud Console](https://console.cloud.google.com/), create (or pick) a project.
2. **APIs & Services → Library** — enable **Gmail API**, **Google Calendar API** and **Google Tasks API**.
3. **OAuth consent screen** — choose *External*, fill in the app name and your email. Add the scopes when asked (or let the sign-in request them): `gmail.readonly`, `gmail.send`, `calendar.events`, `tasks`, plus `openid`/`email`/`profile`.
   - While the app is in **Testing**, add yourself under *Test users*. Note Google expires refresh tokens of Testing-mode apps after **7 days** — publish the app (or press *Reconnect* weekly).
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   - **Authorized redirect URI:** copy it from Settings → Google. It is `PUBLIC_URL/api/google/callback`, e.g. `https://openforge.example.com/api/google/callback`.
5. Copy the **Client ID** and **Client secret** into Settings → Google, press **Save client**, then **Connect Google** and approve every permission.

### 4. WhatsApp — Cloud API
1. At [developers.facebook.com](https://developers.facebook.com/apps) create a *Business* app and add **WhatsApp**.
2. WhatsApp → **API Setup**: copy the **Phone number ID**. The temporary token there lasts 24 hours — for a permanent one create a **System User** in Meta Business Settings, give it the app and the WhatsApp account, and generate a token with `whatsapp_business_messaging` (and `whatsapp_business_management`).
3. Settings → **WhatsApp**: paste the phone number ID and token; optionally a verify token of your choice and the app secret (App settings → Basic) so every webhook's signature is checked. Press **Save & test**.
4. Copy the **Callback URL** and **Verify token** shown, paste them into WhatsApp → **Configuration → Webhook**, press *Verify and save*, then **subscribe to `messages`**.

Messages people send to your number now appear in **Chats**. WhatsApp only allows a free-text reply within **24 hours** of the person's last message; outside that window Meta requires an approved template (not covered by Open Forge).

### 5. Telegram — bot
1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, copy the token.
2. Settings → **Telegram**: paste it and press **Save & register webhook**. Open Forge calls `setWebhook` for you (with a secret token so only Telegram can post to it).
3. For group chats, disable privacy mode with `/setprivacy` in BotFather.

## How the "never sends on its own" rule is enforced
The assistant's tool list (`server/src/assistant/tools.js`) contains only **read** tools and `prepare_*` tools. A `prepare_*` tool only inserts a row into the `actions` table. The code that actually sends (`server/src/assistant/actions.js`) is reachable only from `POST /api/actions/:id/confirm` — the button on the Drafts card — and claims the draft atomically so a double click cannot send twice. `server/test/tools.test.js` fails if a tool that acts directly is added.

## Development

```bash
cd server && npm install && npm start      # API on :3000 (data in server/data)
cd web && npm install && npm run dev       # UI on :5173, proxies /api to :3000
cd server && npm test
```

Stack: Node 20 + Express + better-sqlite3 + ws · React 18 + Vite · lucide icons · Plus Jakarta Sans. No SDKs — OpenAI, Anthropic, Google, Meta and Telegram are called over plain HTTPS.

## Security notes
- Third-party keys are encrypted at rest with AES-256-GCM; the browser only ever sees whether a key is set and its last four characters.
- Sessions are httpOnly cookies. The Talk WebSocket checks the cookie and the page origin.
- Webhook URLs contain an unguessable per-user id; WhatsApp deliveries are checked against the app-secret signature when one is set, Telegram deliveries against the registered secret token.
- Gmail access uses `gmail.readonly` + `gmail.send` only (no delete/modify).

## License
[MIT](LICENSE)
