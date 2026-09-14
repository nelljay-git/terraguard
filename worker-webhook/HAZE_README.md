# TerraGuard — Transboundary Haze Monitor (PRIVATE, not for public use)

Single file `src/haze.js`, same pattern as the weather/volcano workers:
cron-driven, Discord only on meaningful change, bearer/`?key=`-gated
private API, nothing on the public website.

## Sources (official ASMC only)

- **asmc-home** (`asmc.asean.org/home/`) — daily situation text: hotspot
  counts per area, smoke density, station AQI levels, winds (incl. a
  Philippines line), ASMC Alert Level.
- **asmc-alerts** (`asmc.asean.org/asmc-alerts/`) — alert activation table
  (date, Level 1/2/3, sub-region, description). Enriches the home record;
  new rows trigger notifications.

DENR-EMB domestic AQI is intentionally NOT included: `air.emb.gov.ph`
serves no server-side data or public feed (verified Sept 2026 — the page
is a JS shell). If EMB publishes a feed, add it via `HAZE_SOURCES_JSON`.

## Notify policy

- ASMC Alert Level up/down → HAZE ALERT
- New alert activation row → ALERT
- Philippines newly mentioned with haze → ALERT
- Deterioration wording → ALERT
- First sighting → NEWS (or ALERT if HIGH/CRITICAL)
- Routine daily refresh, same level → stored silently

Risk: ASMC level 0→LOW, 1→ELEVATED, 2→MODERATE, 3→HIGH, bumped one tier
when PH is explicitly in the haze picture, forced HIGH on Hazardous
readings (override via `HAZE_RISK_JSON`).

## Satellite image on Discord

Every Discord post carries the latest JMA Himawari-9 true-color full-disk
image (official, 10-min slots, auto-resolved with fallback to older slots,
20-min cache). Footer credits `🛰️ JMA Himawari imagery`. If JMA is
unreachable the message still sends, just without the image. Disable with
the `HAZE_SATELLITE = "0"` var.

## Setup (dashboard-paste method)

1. Create worker, paste `src/haze.js`, Deploy
2. Bindings → KV `HAZE_KV` → new namespace (e.g. `terraguard-haze`)
3. Secrets: `DISCORD_WEBHOOK_URL`, `CRON_SECRET`
4. Cron trigger: `*/30 * * * *`

## Private API

```
/trigger                 run a check now
/api/haze/latest         current situation + risk
/api/haze/events?limit=20
/api/haze/event?id=<id>
```
