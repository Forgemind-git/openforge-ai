# Contributing to Open Forge AI

Thanks for helping! A few ground rules keep the project safe to self-host.

## Run it locally

```bash
cd server && npm install && npm start      # API on :3000, data in server/data
cd web && npm install && npm run dev       # UI on :5173, proxies /api to :3000
cd server && npm test                      # node:test
```

Use **Demo** in the top bar to work on the UI without any keys.

## Rules that must not break

1. **The assistant never acts on its own.** Tools in `server/src/assistant/tools.js` may only *read* or *prepare a draft* (`prepare_*`). Anything that sends, creates or deletes lives in `server/src/assistant/actions.js` and runs only when a person presses Send/Confirm. `server/test/tools.test.js` enforces this — keep it passing.
2. **No credentials in the repo.** Keys are entered per user and stored encrypted. Never commit a `.env`, a token, a test key or a database file.
3. **Never return a secret to the browser.** Settings responses only say whether a secret is set and its last four characters.
4. **Mask phone numbers and email addresses** in anything the assistant reads or says.

## Pull requests

- Keep changes focused; describe what you tested (ideally in a real browser, both themes).
- Match the existing style: plain Express + raw SQL on the server, React function components and the CSS tokens in `web/src/theme.css` on the client.
- New integrations follow the same shape: settings in `routes/settings.js`, a client in `integrations/`, read tools + `prepare_*` tools, and an executor case in `actions.js`.
