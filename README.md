# KOSPI Risk Watch

Personal MVP that helps a single individual investor decide whether to enter/exit a KOSPI200 inverse position, by monitoring Monday downside context, an inverse-signal score, regime/volatility, and KOSPI200 expiry-settlement risk. It is decision-support only: it computes an illustrative signal strength, entry/exit guidance, and a volatility-weighted example sizing, but it does **not** execute automated trading or route orders. The final decision and responsibility rest with the user.

## Scope

This repo implements the first-pass dashboard described in `.omx/plans/prd-kospi-monday-derivatives-dashboard.md`:

- probability card with `computed`, `degraded`, or `unavailable` status
- KOSPI200 expiry-settlement panel using transparent calendar helpers
- UI-adjustable polling interval for free/public data adapters
- source freshness and adapter error visibility
- senior quant readiness score that grades system/data completeness, not market direction
- production readiness panel and `/api/readiness` gate for public operational safety vs live-data blockers
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

Runtime configuration can be supplied either through the shell/systemd environment or a repository-root `.env` file. Copy `.env.example` to `.env` for a local template. Existing shell/systemd values take precedence over `.env`; set `KOSPI_ENV_FILE=/absolute/path/to/file` to load a different file.

| Variable | Values | Purpose |
| --- | --- | --- |
| `PORT` | number | Local server port; defaults to `4173`. |
| `MARKET_DATA_ADAPTER` | `mock`, `mock-stale`, `mock-error`, `yahoo-finance`, `json-http`, `krx-open-api` | Uses deterministic mock snapshots, Yahoo Finance observation proxies, the strict normalized JSON integration adapter, or configured KRX OPEN API endpoint polling. |
| `MARKET_DATA_URL` | URL | Required only for `MARKET_DATA_ADAPTER=json-http`; must return the normalized snapshot contract documented in `docs/data-sources.md`. |
| `MARKET_DATA_SOURCE` | string | Canonical source id for `json-http` or `krx-open-api`; defaults to `json-http-market-data` or `krx-open-api`. |
| `MARKET_DATA_AUTH_HEADER_NAME` / `MARKET_DATA_AUTH_HEADER_VALUE` | strings | Optional environment-only header pair for `json-http`; rejected on plain `http:` URLs. |
| `MARKET_DATA_TIMEOUT_MS` / `MARKET_DATA_MAX_BODY_BYTES` | numbers | Optional timeout/body limits for `json-http`; defaults are 5000 ms and 256 KiB. |
| `YAHOO_FINANCE_KOSPI_SYMBOL` / `YAHOO_FINANCE_KOSPI200_SYMBOL` / `YAHOO_FINANCE_USDKRW_SYMBOL` | Yahoo symbols | Optional symbols for the `yahoo-finance` observation proxy; defaults to `^KS11`, `^KS200`, and `KRW=X`. |
| `YAHOO_FINANCE_INTRADAY_RANGE` / `YAHOO_FINANCE_DAILY_RANGE` | Yahoo ranges | Optional ranges for 1-minute market pulse and daily probability inputs; defaults to `1d` and `6mo`. |
| `KRX_OPEN_API_KEY` | credential string | Required for `MARKET_DATA_ADAPTER=krx-open-api`; sent as `AUTH_KEY` by default. |
| `KRX_OPEN_API_KOSPI_DAILY_URL` | URL | Approved KRX KOSPI daily endpoint; derives KOSPI input freshness, Monday baseline rate, momentum, and volatility. |
| `KRX_OPEN_API_KOSPI200_DAILY_URL` | URL | Approved KRX KOSPI200 daily endpoint; used with futures rows to derive basis. |
| `KRX_OPEN_API_FUTURES_URL` / `KRX_OPEN_API_OPTIONS_URL` | URLs | Approved KRX futures/options endpoint URLs for open interest, volume, basis, and put/call ratio inputs. |
| `KRX_OPEN_API_INVESTOR_FLOW_URL` / `KRX_OPEN_API_HOLIDAY_CALENDAR_URL` | URLs | Optional approved KRX endpoints for foreigner futures flow and holiday-calendar adjustment. |
| `KRX_OPEN_API_COMMON_PARAMS_JSON` / `KRX_OPEN_API_*_PARAMS_JSON` | JSON object strings | Query params appended to every endpoint or a specific endpoint, e.g. an approved `API_ID`. |
| `KRX_OPEN_API_LIVE`, `KRX_OPEN_API_APPROVED_PUBLIC`, `KRX_OPEN_API_READINESS_ALLOWED`, `KRX_OPEN_API_SOURCE_APPROVAL`, `KRX_OPEN_API_LICENSE` | strings/flags | Capability and approval claims; still insufficient for `production-live-ready` until the source/license pair is added to the system-owned approval registry. |

Examples:

```sh
MARKET_DATA_ADAPTER=mock npm run dev
MARKET_DATA_ADAPTER=mock-stale npm run dev
MARKET_DATA_ADAPTER=mock-error npm run dev
MARKET_DATA_ADAPTER=yahoo-finance npm run dev
```

`MARKET_DATA_ADAPTER=yahoo-finance` is an observation-only fallback for KOSPI/KOSPI200/USDKRW chart proxies while KRX approval is absent. It labels KOSPI200 as an index proxy, not KOSPI200 futures, keeps derivatives/OI/short-selling metrics unavailable, and cannot unlock `liveReady`.

Example KRX OPEN API shape after service approval and endpoint mapping:

```sh
MARKET_DATA_ADAPTER=krx-open-api \
KRX_OPEN_API_KEY=... \
KRX_OPEN_API_KOSPI_DAILY_URL='https://openapi.krx.co.kr/...' \
KRX_OPEN_API_KOSPI_DAILY_PARAMS_JSON='{"API_ID":"approved-kospi-daily-id"}' \
KRX_OPEN_API_KOSPI200_DAILY_URL='https://openapi.krx.co.kr/...' \
KRX_OPEN_API_FUTURES_URL='https://openapi.krx.co.kr/...' \
KRX_OPEN_API_OPTIONS_URL='https://openapi.krx.co.kr/...' \
npm run dev
```

The direct KRX adapter can populate dashboard fields when approved endpoints respond, but `liveReady` remains false until the configured source/license pair is reviewed and added to `APPROVED_LIVE_SOURCE_REGISTRY`.

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
| `GET /api/dashboard?force=true` | Composed dashboard state: probability, quant readiness, production readiness, derivatives market coverage, expiry-settlement risk, freshness summary, alerts. |
| `GET /api/readiness?force=true` | Public readiness summary: top-level service/readiness flags (`serviceOk`, `status`, `ready`, `liveReady`, `safeToServe`), source status, quant readiness, production readiness, polling metadata, and non-advice notice. |

All adapter outputs are normalized again at the polling boundary before they are cached or exposed through public JSON endpoints, so unsupported fields, unsafe diagnostic text, and provider internals are dropped even if a future adapter bypasses helper-level normalization.

## Senior quant readiness levels

The readiness card evaluates whether the dashboard itself is ready for monitoring work. It does **not** score market direction and does not produce trade guidance.

| Verdict | Meaning |
| --- | --- |
| `operational-shell` | Service, UI controls, guardrails, and calendar logic exist, but required market inputs are unavailable, stale, or mock-only. This is the expected default public state until an approved adapter is configured. |
| `analysis-review-ready` | Deterministic fixture or non-live review inputs are sufficient to review dashboard behavior, but this is not live market readiness. Mock mode can reach this level for verification only. |
| `approved-live-monitor-ready` | Reserved for an explicitly approved free/public, fresh, non-mock adapter that declares live-market-data capabilities and provides KOSPI probability inputs plus every live-critical KOSPI200 derivatives field with provenance. The current default deployment does not claim this state. |

The derivatives coverage panel always renders the required metric slots (basis, futures/options open interest and volume, put/call ratio, foreigner net futures flow, holiday calendar), treats all of them as live-critical for approved live-monitor readiness, and marks unavailable fields explicitly rather than hiding them. Holiday-calendar values are accepted only as a fresh, non-empty bounded `YYYY-MM-DD` date array and are applied to expiry/settlement calculation before any live-ready claim can pass.

## Production readiness levels

The production readiness panel is an operational/data-rights gate, not market direction guidance.

| Status | Meaning |
| --- | --- |
| `production-safe-observation` | Public service and safety guardrails are healthy, but `liveReady` is false because approved live market data or full fresh coverage is missing. This is the expected no-credential deployment state. |
| `production-blocked` | A service/safety requirement is failing, such as unsafe public diagnostics, service failure, or adapter error state. |
| `production-live-ready` | Reserved for registry-approved live source plus fresh probability inputs, full live-critical derivatives metrics, applied holiday-calendar date array, polling metadata, sanitized diagnostics, and guardrails. |

## Data source limits

The MVP is designed around free/public data polling but intentionally does not claim live KRX readiness by default. Without approved endpoint URLs, the default source is `krx-free-source-placeholder` and returns `unavailable` rather than fake live data. The implemented `krx-open-api` adapter must be explicitly selected and configured with approved KRX service URLs. Fresh-looking adapters are still rejected for live readiness unless they declare explicit `liveMarketData`, `approvedPublic`, and `readinessAllowed` capabilities **and** their source/license pair is present in the system-owned live-source approval registry.

KRX planning references captured during requirements/planning:

- KRX OPEN API service list: https://openapi.krx.co.kr/contents/OPP/INFO/service/OPPINFO004.cmd
- KRX OPEN API usage flow: https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO003.jsp
- KRX market-data receiving guidance: https://openapi.krx.co.kr/contents/OPP/DATA/OPPDATA003.jsp
- KOSPI200 futures specification: https://open.krx.co.kr/contents/OPN/01/01040201/OPN01040201.jsp
- KOSPI200 options specification: https://open.krx.co.kr/contents/OPN/01/01040202/OPN01040202.jsp
- Final-settlement risk reference: https://open.krx.co.kr/contents/OPN/01/01040903/OPN01040903.jsp

See `docs/data-sources.md` for adapter boundaries and future integration rules.
