# TerraGuard — All-Hazard Monitor (ONE worker)

Merges `pagasa.js` + `volcano.js` + `haze.js` into **`src/terraguard.js`**
so the free tier only sees one worker and one cron set. Zero logic
changes: each monitor lives in its own scope (`Weather`, `Volcano`,
`Haze`) with a single unified entry for fetch + scheduled.

## What changed vs running three workers

- **Cron**: one tick (`*/10 * * * *`) runs all three monitors; the two
  daily crons still fire only the PAGASA daily summary. Weather checks
  slow from 5 to 10 minutes — the only behavioral trade-off.
- **Webhooks**: `DISCORD_WEBHOOK_URL` serves weather/haze/everything by
  default; **`VOLCANO_DISCORD_WEBHOOK_URL` gives volcano its own channel**;
  `HAZE_DISCORD_WEBHOOK_URL` optionally splits haze off too.
- **KV**: bind the three existing namespaces to keep all history
  (recommended — no re-baseline burst), or one `TERRAGUARD_KV` to start
  fresh. Missing bindings degrade per-monitor (`X: KV not bound, skipped`)
  instead of 500ing the whole tick.
- **Routes**: everything the three workers had, under one roof —
  `/trigger` (all), `/trigger-weather`, `/trigger-volcano`,
  `/trigger-haze`, `/trigger-daily`, `/api/pagasa/*`, `/api/volcano/*`,
  `/api/haze/*`. Auth: per-monitor secret → `CRON_SECRET` fallback,
  header or `?key=`. Anything else → 404.

## Migrate (dashboard method)

1. Create worker `terraguard-monitor`, paste `src/terraguard.js`, Deploy.
2. Bindings → KV: add `PAGASA_KV`, `VOLCANO_KV`, `HAZE_KV` (same
   namespaces the old workers use — history carries over, no duplicate
   baseline burst).
3. Variables → Secrets: `DISCORD_WEBHOOK_URL` (existing weather webhook),
   `VOLCANO_DISCORD_WEBHOOK_URL` (volcano's own — create a second webhook
   in Discord if you want a separate channel), `CRON_SECRET` (`123` keeps
   your current URLs working).
4. Triggers: `*/10 * * * *`, `0 23 * * *`, `0 10 * * *`.
5. Verify: `/trigger?key=123` should report mostly `duplicate` (history
   intact), then delete the three old workers to free the cron slots.

Rebuilding: the file is generated — `Weather`/`Volcano`/`Haze` sections
are verbatim copies of the three sources. Fix bugs in the single files
first, then re-run the merge (see build script pattern in git history).
