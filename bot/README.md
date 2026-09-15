# Cool Gram bot — standalone server (MongoDB + Koyeb)

Same bot logic as the Lovable app, but it stores everything in MongoDB and runs
as its own always-on service.

## Files

- `src/handler.ts` — bot logic, generated from the app route by `npm run sync`
- `src/mongo.ts` — MongoDB data layer (drop-in replacement for the old database calls)
- `src/crons.ts` — boost reminders + 7-day leave check, run hourly
- `src/index.ts` — HTTP server, webhook endpoint, auto `setWebhook` on boot
- `src/migrate.ts` — one-time copy of the old data into MongoDB

## Environment variables

See `.env.example`. Required on Koyeb:

| Variable | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | the @CoolGram_bot token |
| `MONGODB_URI` | your MongoDB Atlas connection string |
| `MONGODB_DB` | `coolgram` |
| `PUBLIC_URL` | the public URL Koyeb gives the service |
| `PORT` | `8000` |

## Deploy on Koyeb

1. Push this repository to GitHub.
2. Koyeb → Create Service → GitHub → pick the repo, work directory `bot`,
   builder **Dockerfile**.
3. Instance: Free/Nano is enough. Port `8000`, health check path `/health`.
4. Add the environment variables above (leave `PUBLIC_URL` empty on the first
   deploy, then set it to the service URL and redeploy).
5. On boot the service registers its own Telegram webhook — nothing else to do.

## Copy the old data

Run once, locally:

```bash
cd bot
npm install
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... MONGODB_URI=... npm run migrate
```

## Keeping the logic in sync

If the bot logic is changed in the Lovable app, regenerate the server copy:

```bash
node bot/tools/sync-handler.mjs
```
