# Make it yours — extending OpenForge AI

OpenForge AI is a **base variant**: a working, self-hosted assistant with a small, readable codebase, meant as a kick-starter. Fork it and grow it into your own Jarvis — a personal assistant, or one for your business that knows your CRM, orders, bookings, inventory or support desk.

Out of the box it does Google Tasks, Calendar and Gmail, WhatsApp + Telegram chats, typed chat with OpenAI or Anthropic, and live voice with Gemini. Everything below is the map for changing that.

> **Keep the one rule.** The assistant may *read* anything you give it, but it never *acts* on its own: every write is a **draft** the user approves on the *Drafts to approve* card. The tests in `server/test/tools.test.js` enforce this. Keep it — it is what makes it safe to connect an assistant to real accounts.

## Where things live

| You want to… | Edit |
|---|---|
| Give the assistant a new ability (read data) | `server/src/assistant/tools.js` — add a **read tool** |
| Let it prepare a new kind of action | `tools.js` (a `prepare_*` tool) + `server/src/assistant/actions.js` (what happens on Send) |
| Connect a new service (CRM, Shopify, Notion, Slack, your own API…) | a new file in `server/src/integrations/` |
| Store a user's key for that service | `server/src/routes/settings.js` + `web/src/pages/Settings.jsx` (keys are saved encrypted via `store.js`) |
| Change its personality, rules or name | `systemPrompt()` at the bottom of `tools.js` |
| Change the model provider or default models | `server/src/integrations/llm.js` |
| Change the voice (Talk) | `server/src/assistant/live.js` (server) and `web/src/lib/geminiLive.js` (browser) |
| Add a card / screen | `web/src/pages/Office.jsx` (the rails) and `web/src/pages/Sheets.jsx` (the full-size panels) |
| Change colours, fonts, logo | `web/src/theme.css`, `web/public/` (logo, favicon, `forge-ai-blink.gif`) |
| Change the demo data | `web/src/lib/demo.js` |
| Change what the morning brief says, or add a card to its tour | `web/src/lib/brief.js` (the script — one step per card); the tour itself is `web/src/components/MorningBrief.jsx` |
| Change the morning brief's live voice delivery | `server/src/assistant/narrate.js` |

## 1. Add a read tool

A tool is an object in the `TOOLS` array of `server/src/assistant/tools.js`. The same list is used by the typed chat and by voice.

```js
{
  name: 'list_orders',
  description: 'Recent orders from the shop, newest first. Use for questions about sales, orders or a customer\'s purchase.',
  input_schema: { type: 'object', properties: { customer: { type: 'string' }, limit: { type: 'number' } } },
  panels: [],                     // card ids to light up while it runs (calendar, tasks, mail, chats, drafts)
  async run(user, { customer, limit = 10 }) {
    return shop.listOrders(user.id, { customer, limit });   // your integration
  },
},
```

Then:
- add a short progress label in `TOOL_LABELS` (shown while it runs, e.g. `list_orders: 'Checking orders'`);
- add the name to the `READ` set in `server/test/tools.test.js` — the test fails for any tool that is neither a known read tool nor a `prepare_*` draft, on purpose;
- mention the new data in `systemPrompt()` so the model knows it exists.

Write a clear `description`: it is what the model reads to decide when to call the tool.

## 2. Add a new kind of draft (an action the user approves)

1. In `tools.js`, add a `prepare_*` tool marked `drafts: true` that calls `prepare(user.id, '<kind>', '<title>', payload)`. It only stores the draft.
2. In `server/src/assistant/actions.js`, add a `case '<kind>':` to `execute()` that does the real work. This runs **only** when the user presses Send / Confirm.
3. If the draft needs its own icon or editable fields on the Drafts card, see `draftIcon()` and the `editable` map in `web/src/pages/Sheets.jsx`.

## 3. Add an integration

Put the API calls in a new file, e.g. `server/src/integrations/shop.js`, and read the user's key with the helpers in `server/src/store.js` (look at how `google.js` and `messaging.js` do it). Keys entered in Settings are encrypted with AES-256-GCM and never sent back to the browser — keep it that way, and never commit a key or put one in `.env.example`.

For a service that calls *you* (webhooks), add the route in `server/src/routes/public.js` and give each user an unguessable URL the way WhatsApp and Telegram do (`hook_id`).

## 4. Run it while you work

```bash
cd server && npm install && npm start       # API on :3000 (data in server/data); restart it after server changes
cd web && npm install && npm run dev        # web app on :5173 with hot reload, proxies /api to :3000
cd server && npm test                       # the safety tests
```

Then rebuild the container with `./deploy.sh` (or `./deploy.sh update` after a `git pull`).

## Ideas

- **Business assistant:** CRM leads and follow-ups, today's orders and refunds, low-stock alerts, support tickets — with replies drafted for approval.
- **Personal assistant:** notes (Notion / Obsidian), bills and reminders, travel bookings, smart-home status.
- **Team assistant:** add users from Settings → Account; each person brings their own keys and sees only their own data.

Built something with it? Open an issue or a pull request — see [CONTRIBUTING.md](../CONTRIBUTING.md).
