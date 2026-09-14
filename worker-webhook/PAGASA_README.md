# TerraGuard — PAGASA Weather News Monitor (PRIVATE, not for public use)

Automated DOST-PAGASA monitoring on Cloudflare Workers. Not linked from, and
not rendered by, the public website. Discord + authenticated API only.

PAGASA is the authoritative source. This system only retrieves, organizes,
analyzes, classifies, and summarizes official information. Risk labels are
Terra Guard's own and are always emitted as `TERRAGUARD RISK STATUS`.

## Architecture

```
Cron */5  ──▶ runMonitor() ──▶ fetch (per-type fetchers)
                                parse (per-type parsers)
                                hash + dedup (sha256, KV `pagasa:seen:*`)
                                diff (change detector)
                                risk (configurable engine)
                                report NEWS/ALERT
                                Discord (only on new/material change)
                                store (snapshot + events + index in PAGASA_KV)
Crons 23:00/10:00 UTC ──▶ runDaily() ──▶ TERRAGUARD WEATHER DESK (07:00/18:00 PHT)

Single-file worker: `src/pagasa.js` (sections are banner-marked per
origin module: config, fetchers, parsers, normalize, change, risk,
report, discord, store, entry). Edit the section and redeploy — no
build step needed for plain JS.
```

## Setup (one-time)

```bash
cd worker-webhook

# 1. KV for dedup + event store (use a SEPARATE namespace from earthquakes)
wrangler kv namespace create PAGASA_KV --config wrangler-pagasa.toml
# paste id into wrangler-pagasa.toml → id = "..."
wrangler kv namespace create PAGASA_KV --preview --config wrangler-pagasa.toml

# 2. Secrets (never commit)
wrangler secret put DISCORD_WEBHOOK_URL --config wrangler-pagasa.toml
wrangler secret put CRON_SECRET --config wrangler-pagasa.toml
wrangler secret put PAGASA_API_SECRET --config wrangler-pagasa.toml  # optional; falls back to CRON_SECRET

# 3. Deploy
wrangler deploy --config wrangler-pagasa.toml
```

## Notification policy (no 5-minute spam)

A Discord message is sent ONLY when:

- a new advisory appears for a notifying source, or
- `detectChanges()` finds material change: signal up/down, cyclone
  intensity/movement change, rainfall change (escalating), flood
  escalate/downgrade, warning cancelled, advisory ended, risk status moved, or
- affected-area deltas ≥ `SIGNIFICANT_AREA_DELTA` (default 1).

Identical content hashes are dropped silently. The `homepage` source is
context-only (`notifyEnabled: false`) and never notifies.

Static portals (`homepage`, `flood`) are also `statusEnabled: false`, so
their descriptive text can never move the overall TERRAGUARD RISK STATUS or
appear in daily summaries. They are still fetched, parsed, stored, and
readable via the private API. To promote a live PAGASA bulletin URL, override
via `PAGASA_SOURCES_JSON` with `notifyEnabled`/`statusEnabled` set to true —
no code change needed.

Set `SEED_QUIETLY = "1"` before first deploy to store the baseline state
without sending the initial burst of Discord messages.

## Private API (all routes require `Authorization: Bearer <secret>`)

Without the header every path returns `404` — including `/health`-style
probes. There is intentionally no public route.

```
GET /trigger                      run a monitor tick now
GET /trigger-daily                run the daily summary now
GET /api/pagasa/latest            snapshot: overall status + latest event per source
GET /api/pagasa/events?limit=20   recent event index (max 100)
GET /api/pagasa/event?id=<id>     one processed event (risk, changes, areas, report)
GET /api/pagasa/daily?date=YYYY-MM-DD   morning/evening summaries (Manila date)
```

Risk output contract per event:

```json
{ "risk": { "status": "MODERATE", "score": 7, "previousStatus": "ELEVATED", "changed": true } }
```

## Changing sources / tuning risk without code changes

- `PAGASA_SOURCES_JSON` secret: full replacement source list
  (`key`, `type`, `label`, `url`, `notifyEnabled`).
- `RISK_CONFIG_JSON` secret: `{ weights, caps, thresholds, force }` overrides.
- `SIGNIFICANT_AREA_DELTA` var: area-change sensitivity.
- Parser dispatch is by `type`, so a new page shape only needs one new
  `parse*` function plus one `fetch*` wrapper in the matching `src/pagasa.js`
  section — no restructuring.

## Safety rules enforced in code

- Extractive parsing only — missing fields stay `null`/`[]`, never guessed.
- Every report carries `SOURCE: DOST-PAGASA` + the non-official disclaimer.
- Sensational-phrase sanitizer in the report section of `src/pagasa.js`.
- No webhook URLs or secrets in source; no frontend routes added.
