# TerraGuard — Cloudflare Worker Cron (private Discord webhook)

Automated `EARTHQUAKE ALERT` to Discord — no public HTTP access.

### Why Workers (not Pages)
Cloudflare **Pages Functions do NOT support Cron Triggers**. You need a **Worker** with `scheduled()` handler. Public `fetch()` on this Worker returns `404` → scanners/probers get nothing. Only Cloudflare's scheduler can run it.

### Setup (one-time)
```bash
cd worker-webhook
npm i -g wrangler # if not installed

# 1. Create KV for dedup (copy the `id` it prints)
wrangler kv namespace create WEBHOOK_KV
# paste id into wrangler.toml → id = "..."
wrangler kv namespace create WEBHOOK_KV --preview

# 2. Secrets (never commit)
wrangler secret put DISCORD_WEBHOOK_URL
# paste: https://discord.com/api/webhooks/1546330478221598761/...

wrangler secret put CRON_SECRET
# paste a random string (e.g. openssl rand -hex 32)

# 3. Deploy
wrangler deploy
```

### Verify
- Cloudflare Dashboard → Workers & Pages → `terraguard-webhook-cron` → Triggers → should show `*/2 * * * *`
- Logs → should see `[cron] sent ...` or `[cron] duplicate ...` every 2 min
- Manual trigger (optional, requires secret):
```
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://terraguard-webhook-cron.YOUR_SUBDOMAIN.workers.dev/trigger
```
Without `Authorization` header → `404 Not Found` (intentional).

### Security
- `fetch()` returns `404` for all paths except `/trigger` with valid `Bearer CRON_SECRET`
- `scheduled()` has no HTTP surface — only Cloudflare can invoke it
- No webhook URL in client bundle (only in Worker secrets)

### Tuning (USGS only)
- `wrangler.toml` → `[triggers] crons = ["*/5 * * * *"]` for 5-min interval
- `MIN_MAGNITUDE = "0"` to send every PH quake, or `"6.0"` for only strong
- `USGS_MIN_LAT/MAX_LAT/MIN_LNG/MAX_LNG` in `wrangler.toml:12` — default Philippines box `4.5–21.5, 116–127`. Set to `-90/90/-180/180` for global USGS.
- `USGS_FEED = "significant_day.geojson"` to only send significant quakes
- Template is in `src/index.ts:sendDiscordWebhook()` — same emoji layout as Details.tsx button, source `USGS`, time `UST` from USGS epoch

### Pages vs Worker separation
- Pages (`/`) stays on Cloudflare Pages — no change
- Worker (`terraguard-webhook-cron`) runs independently — no route overlap
