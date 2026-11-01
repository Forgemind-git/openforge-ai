# Security policy

Please **do not open a public issue** for security problems. Email **contact@forgemind.in** with the details and steps to reproduce; we will reply as soon as we can and credit you once it is fixed.

What we care about most: anything that lets one user read another user's data or keys, lets the assistant send or change something without a person pressing a button, exposes a stored secret to the browser, or lets someone forge WhatsApp/Telegram webhooks.

## Hardening an install

- Serve it only over HTTPS and set `PUBLIC_URL`.
- Back up the data volume including `.encryption_key`, and keep backups private.
- Set the WhatsApp **App secret** in Settings so webhook signatures are checked.
- Leave `DEMO_LOGIN_*` blank on any install that holds real keys.
