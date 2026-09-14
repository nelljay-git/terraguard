# TerraGuard — PHIVOLCS Volcano Monitor (PRIVATE, not for public use)

Same pattern as the PAGASA worker: single file `src/volcano.js`, cron-driven,
Discord only on meaningful change, bearer/`?key=`-gated private API. Nothing
is rendered by the public website.

PHIVOLCS is the authoritative source. Alert Levels are always quoted verbatim
as `Alert Level N`; the risk label is Terra Guard's own (`TERRAGUARD RISK
STATUS`). Default level mapping: 0→LOW, 1→ELEVATED, 2→MODERATE, 3→HIGH,
4/5→CRITICAL (override via `VOLCANO_RISK_JSON`).

## How it tracks volcanoes

1. The **LAVA hub** (`wovodat.../bulletin/list-of-bulletin`) gives the live
   alert ticker for Taal, Kanlaon, Bulusan, Pinatubo, Mayon plus the latest
   bulletin link (`bid`) per observatory.
2. Each English bulletin article (`&lang=en`) is fetched and parsed:
   volcano, Alert Level, trend (e.g. Decreased Unrest), issued date,
   earthquake count, SO₂ flux, plume, ground deformation, PDZ radius,
   hazards. Filipino editions are skipped (English carries the same data).
3. Per-volcano dedup on `(volcano, bid, content-hash)`. Category sources
   share the same dedup, so hub + category overlap never double-notifies.

## Notify policy

- Alert Level raised/lowered → VOLCANO ALERT
- Escalation keywords appear (eruption, ashfall, lava, pyroclastic) → ALERT
- First sighting of a volcano → NEWS (or ALERT if HIGH/CRITICAL)
- Routine same-level daily bulletin → stored silently (API-readable).
  Set `VOLCANO_DAILY_BRIEF=1` to also get a NEWS message for these.

## Images on Discord

Each post prefers the volcano-specific **PHIVOLCS bulletin map**
(`img/bulletinMap/<OBS>YYYY-MM-DD.jpg`, discovered from the article and
HEAD-verified), falling back to the JMA Himawari full disk, then to no
image. Footer credits whichever imagery shipped. Disable all images with
`VOLCANO_SATELLITE = "0"`.

## Setup

Dashboard-paste method (same as your weather worker):

1. Workers & Pages → **Create** → import/paste `src/volcano.js`
2. **Settings → Bindings → Add binding → KV namespace**:
   Variable `VOLCANO_KV` → new namespace (e.g. `terraguard-volcano`)
3. **Settings → Variables → Secrets**: `DISCORD_WEBHOOK_URL`, `CRON_SECRET`
4. **Settings → Triggers → Add Cron Trigger**: `*/10 * * * *`

Or via CLI: `wrangler deploy --config wrangler-volcano.toml` (after filling
the KV id and secrets).

## Private API (`?key=<secret>` or Bearer header; else 404)

```
/trigger                  run a monitor tick now
/api/volcano/latest       alert levels + latest bulletin per volcano
/api/volcano/events?limit=20
/api/volcano/event?id=<id>
```
