# KOSPI Risk Watch

Public personal MVP for monitoring KOSPI Monday downside context and KOSPI200 expiry-settlement risk. It is an observation-only dashboard: no automated trading, no order routing, no position sizing, and no investment advice.

## Scope

This repo implements the first-pass dashboard described in `.omx/plans/prd-kospi-monday-derivatives-dashboard.md`:

- probability card with `computed`, `degraded`, or `unavailable` status
- KOSPI200 expiry-settlement panel using transparent calendar helpers
- UI-adjustable polling interval for free/public data adapters
- source freshness and adapter error visibility
- senior quant readiness score that grades system/data completeness, not market direction
- derivatives market coverage panel for futures/options metric availability
- informational alerts gated by data quality
- persistent non-advice/no-auto-trading guardrails

Non-goals for this pass:

- no live trading or brokerage integration
- no production-grade deployment hardening beyond the current nginx/systemd publication path
- no paid or closed data source dependency
- no first-pass backtest/research workbench
- no complex machine learning model

## Requirements

- Node.js 22 or newer
- No npm package install is required for the current dependency-light implementation

## Run locally

```sh
npm run dev
```

The server listens on `http://localhost:4173` by default and serves both the API and dashboard UI.

Optional environment variables:

| Variable | Values | Purpose |
| --- | --- | --- |
| `PORT` | number | Local server port; defaults to `4173`. |
| `MARKET_DATA_ADAPTER` | `mock`, `mock-stale`, `mock-error` | Uses deterministic mock snapshots for local development and tests. |
| `KRX_OPEN_API_KEY` | credential string | Reserved for a future approved KRX adapter; current MVP still returns an unavailable placeholder. |

Examples:

```sh
MARKET_DATA_ADAPTER=mock npm run dev
MARKET_DATA_ADAPTER=mock-stale npm run dev
MARKET_DATA_ADAPTER=mock-error npm run dev
```

## Verify

```sh
npm run verify
```

`verify` runs:

1. `npm run lint` — checks trailing whitespace and blocks prohibited recommendation wording in executable/source files.
2. `npm run typecheck` — parses JavaScript modules with Node.
3. `npm test` — runs core, backend, static UI, and mocked UI-render tests.

## API endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Local service health and non-advice notice. |
| `GET /api/polling` | Current polling configuration. |
| `POST /api/polling` | Normalize the caller's UI refresh interval; this public endpoint is client-scoped and does not mutate the server-wide adapter polling cadence. |
| `GET /api/snapshot?force=true` | Adapter snapshot with freshness, field provenance, values, and polling metadata. |
| `GET /api/dashboard?force=true` | Composed dashboard state: probability, quant readiness, derivatives market coverage, expiry-settlement risk, freshness summary, alerts. |


## Senior quant readiness levels

The readiness card evaluates whether the dashboard itself is ready for monitoring work. It does **not** score market direction and does not produce trade guidance.

| Verdict | Meaning |
| --- | --- |
| `operational-shell` | Service, UI controls, guardrails, and calendar logic exist, but required market inputs are unavailable, stale, or mock-only. This is the expected default public state until an approved adapter is configured. |
| `analysis-review-ready` | Deterministic fixture or non-live review inputs are sufficient to review dashboard behavior, but this is not live market readiness. Mock mode can reach this level for verification only. |
| `approved-live-monitor-ready` | Reserved for an explicitly approved free/public, fresh, non-mock adapter that declares live-market-data capabilities and provides KOSPI probability inputs plus every live-critical KOSPI200 derivatives field with provenance. The current default deployment does not claim this state. |

The derivatives coverage panel always renders the required metric slots (basis, futures/options open interest and volume, put/call ratio, foreigner net futures flow, holiday calendar), treats all of them as live-critical for approved live-monitor readiness, and marks unavailable fields explicitly rather than hiding them.

## Data source limits

The MVP is designed around free/public data polling but intentionally does not claim live KRX connectivity. Without an approved and implemented adapter, the default source is `krx-free-source-placeholder` and returns `unavailable` rather than fake live data. Fresh-looking future adapters are still rejected for live readiness unless they declare explicit `liveMarketData`, `approvedPublic`, and `readinessAllowed` capabilities **and** their source/license pair is present in the system-owned live-source approval registry.

KRX planning references captured during requirements/planning:

- KRX OPEN API service list: https://openapi.krx.co.kr/contents/OPP/INFO/service/OPPINFO004.cmd
- KRX OPEN API usage flow: https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO003.jsp
- KRX market-data receiving guidance: https://openapi.krx.co.kr/contents/OPP/DATA/OPPDATA003.jsp
- KOSPI200 futures specification: https://open.krx.co.kr/contents/OPN/01/01040201/OPN01040201.jsp
- KOSPI200 options specification: https://open.krx.co.kr/contents/OPN/01/01040202/OPN01040202.jsp
- Final-settlement risk reference: https://open.krx.co.kr/contents/OPN/01/01040903/OPN01040903.jsp

See `docs/data-sources.md` for adapter boundaries and future integration rules.
