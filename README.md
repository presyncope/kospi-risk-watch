# KOSPI Risk Watch

Local/internal MVP for monitoring KOSPI Monday downside context and KOSPI200 expiry-settlement risk. It is an observation-only dashboard: no automated trading, no order routing, no position sizing, and no investment advice.

## Scope

This repo implements the first-pass dashboard described in `.omx/plans/prd-kospi-monday-derivatives-dashboard.md`:

- probability card with `computed`, `degraded`, or `unavailable` status
- KOSPI200 expiry-settlement panel using transparent calendar helpers
- UI-adjustable polling interval for free/public data adapters
- source freshness and adapter error visibility
- informational alerts gated by data quality
- persistent non-advice/no-auto-trading guardrails

Non-goals for this pass:

- no live trading or brokerage integration
- no production/public deployment hardening
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
| `POST /api/polling` | Update polling interval; core logic clamps interval to safe bounds. |
| `GET /api/snapshot?force=true` | Adapter snapshot with freshness, field provenance, values, and polling metadata. |
| `GET /api/dashboard?force=true` | Composed dashboard state: probability, expiry-settlement risk, freshness summary, alerts. |

## Data source limits

The MVP is designed around free/public data polling but intentionally does not claim live KRX connectivity. Without an approved and implemented adapter, the default source is `krx-free-source-placeholder` and returns `unavailable` rather than fake live data.

KRX planning references captured during requirements/planning:

- KRX OPEN API service list: https://openapi.krx.co.kr/contents/OPP/INFO/service/OPPINFO004.cmd
- KRX OPEN API usage flow: https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO003.jsp
- KRX market-data receiving guidance: https://openapi.krx.co.kr/contents/OPP/DATA/OPPDATA003.jsp
- KOSPI200 futures specification: https://open.krx.co.kr/contents/OPN/01/01040201/OPN01040201.jsp
- KOSPI200 options specification: https://open.krx.co.kr/contents/OPN/01/01040202/OPN01040202.jsp
- Final-settlement risk reference: https://open.krx.co.kr/contents/OPN/01/01040903/OPN01040903.jsp

See `docs/data-sources.md` for adapter boundaries and future integration rules.
