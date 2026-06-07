# Data sources and integration limits

This dashboard treats source status as a first-class product feature. A missing, stale, or failing source must be shown to the user and must not be converted into a precise market signal.

## Current adapters

| Adapter | How to enable | Status | Intended use |
| --- | --- | --- | --- |
| `krx-free-source-placeholder` | default | `unavailable` | Safe default when no approved source is configured. |
| `mock-market-data` | `MARKET_DATA_ADAPTER=mock` | `fresh` | Deterministic local development and tests. |
| `mock-market-data` stale mode | `MARKET_DATA_ADAPTER=mock-stale` | `stale` | Data-quality alert testing. |
| `mock-market-data` error mode | `MARKET_DATA_ADAPTER=mock-error` | `error` | Error rendering and degraded-state testing. |
| `yahoo-finance-proxy` | `MARKET_DATA_ADAPTER=yahoo-finance` | `fresh`/`partial`/`error` depending on Yahoo chart responses | Observation-only KOSPI/KOSPI200/USDKRW chart proxy while KRX approval is absent; KOSPI200 is an index proxy, not futures data. |
| `json-http-market-data` | `MARKET_DATA_ADAPTER=json-http` + `MARKET_DATA_URL` | `fresh`/`error` depending on upstream payload | Strict normalized JSON integration boundary for future approved sources and tests. |
| `krx-open-api` | `MARKET_DATA_ADAPTER=krx-open-api` + KRX endpoint URLs + `KRX_OPEN_API_KEY` | `fresh`/`partial`/`error` depending on approved endpoint responses | Direct KRX OPEN API polling boundary for configured service URLs; remains unapproved for `liveReady` until registry approval is added. |

The default runtime still uses `krx-free-source-placeholder`. A provided `KRX_OPEN_API_KEY` alone is not enough: the direct KRX adapter is selected only with `MARKET_DATA_ADAPTER=krx-open-api` and explicit endpoint URLs. This prevents an API key from silently making live-data claims before service approvals, endpoint mapping, and data-rights review are complete.

## Adapter contract

Adapters return normalized snapshots with:

> Defense in depth: the API polling layer normalizes every adapter result before caching or exposing `/api/snapshot`, `/api/dashboard`, or `/api/readiness`. Even a future/custom adapter that bypasses helper functions is reduced to the allowlisted public snapshot shape before response composition.

- `source`: source identifier
- `observedAt`: source observation timestamp
- `freshness`: `fresh`, `stale`, `unavailable`, or `error`
- `fields`: field-level provenance entries such as `kospiDaily`, `kospi200`, `derivativesCalendar`, `volatility`, and derivatives metric fields
- `values`: allowlisted inputs used by pure domain logic; numeric fields must be finite numbers and `holidayCalendar` must be an array of `YYYY-MM-DD` date keys
- `capabilities`: explicit adapter boundary flags (`mock`, `liveMarketData`, `approvedPublic`, `readinessAllowed`, `sourceApproval`, `license`) used as input to the system-owned live-source approval registry
- sanitized public `message`, `details`, and `error`: visible context for operators; thrown adapter exceptions and secret-like provider diagnostics are not exposed verbatim

Backend polling adds:

- `polledAt`: local polling timestamp
- `polling`: active server interval/config metadata, including `forceRefreshLimited` when public force-refresh requests are served from cache to protect free API quotas
- `POST /api/polling`: client-scoped interval normalization for the browser refresh loop; it does not mutate server-wide adapter polling on the public endpoint


## Required derivatives metric contract

The senior-quant coverage panel expects every future approved adapter to either provide or explicitly mark unavailable these fields:

| Field | Meaning | Expected provenance |
| --- | --- | --- |
| `futuresBasis` | Nearest KOSPI200 futures price minus spot/index reference | source, observedAt, freshness, optional details |
| `futuresOpenInterest` | Outstanding KOSPI200 futures contracts | source, observedAt, freshness, optional details |
| `futuresVolume` | Current-session KOSPI200 futures trading volume | source, observedAt, freshness, optional details |
| `optionsOpenInterest` | KOSPI200 options open interest across the monitored expiry set | source, observedAt, freshness, optional details |
| `optionsVolume` | Current-session KOSPI200 options volume | source, observedAt, freshness, optional details |
| `putCallRatio` | Options ratio using the adapter's documented basis | source, observedAt, freshness, optional details |
| `foreignerNetFutures` | Net KOSPI200 futures flow for the foreign-investor category when available | source, observedAt, freshness, optional details |
| `holidayCalendar` | Approved trading-day calendar for expiry and settlement adjustments | source, observedAt, freshness, optional details; value must be a non-empty bounded `["YYYY-MM-DD", ...]` array |

If a field is unavailable, the adapter should still include field provenance with `freshness: "unavailable"` and a short reason. Domain code will not synthesize a metric value from missing data. Numeric metric values must be finite JavaScript numbers; non-finite numbers, numeric-looking strings, and other non-numeric values are treated as unavailable. `holidayCalendar` is the only non-numeric derivatives value and is accepted only as a non-empty bounded array of ISO date keys; strings, empty arrays, oversized arrays, and invalid dates are dropped. All listed fields are currently live-critical: missing, stale, or invalid critical fields keep derivatives status below approved live-monitor readiness.

## Readiness scoring contract

`quantReadiness` grades system/data completeness only. It combines system-owned source approval, probability status, live-critical derivatives coverage, expiry-calendar availability, polling visibility, and observation-only guardrails. The expiry check separates transparent rule-based monthly expiry logic from holiday-adjusted live readiness: a rule-only calendar stays in `watch` until fresh holiday-calendar provenance is present and the normalized `holidayCalendar` date array is applied to expiry/settlement calculation. Mock fixtures can demonstrate `analysis-review-ready` rendering but must remain labelled mock/not-live; default unavailable or unapproved fresh adapters remain `operational-shell`. `approved-live-monitor-ready` requires an approved free/public live adapter from the central registry plus fresh probability inputs and every live-critical derivatives metric.

## Production readiness and approved-source gate

`productionReadiness` is separate from `quantReadiness`:

- `production-safe-observation` means the service, diagnostics, polling metadata, and non-advice guardrails are safe to publish, while live-market readiness is still blocked by data rights or missing fresh fields.
- `production-blocked` means an operational safety requirement is failing, such as unsafe public diagnostics, adapter error state, service failure, or missing public readiness metadata.
- `production-live-ready` is reserved for the full approved live-source path: source registry approval, fresh probability inputs, full live-critical derivatives coverage, applied holiday calendar, polling metadata, sanitized diagnostics, and observation-only guardrails.

The API exposes this through `GET /api/readiness` and includes the same object in `GET /api/dashboard`. The readiness endpoint also mirrors `status`, `ready`, `liveReady`, and `safeToServe` at the top level so machine consumers do not confuse HTTP/service availability (`ok`/`serviceOk`) with approved live-market readiness. `safeToServe` is true only when the canonical production status is `production-safe-observation` or `production-live-ready`; adapter errors, missing polling metadata, unsafe diagnostics, or service failures keep it false. Public deployment can therefore be production-safe while honestly showing `liveReady: false` until credentials, KRX/service approvals, endpoint mapping, and registry approval exist.

## Yahoo Finance observation proxy

`MARKET_DATA_ADAPTER=yahoo-finance` enables a no-key fallback for the screen's market-pulse layer. It fetches Yahoo chart JSON for:

- KOSPI daily history (`^KS11` by default) to compute `historicalMondayDownRate`, `recentMomentum`, and `volatilityZScore`.
- KOSPI 1-minute bars (`^KS11`) for current downside context.
- KOSPI200 1-minute bars (`^KS200`) as an index proxy only.
- USD/KRW 1-minute bars (`KRW=X`) for macro/Fx context.

This adapter intentionally leaves actual KOSPI200 futures basis, futures/options open interest, options volume, put/call ratio, foreigner futures flow, holiday-calendar source data, and short-selling data unavailable. It declares no approved-live capability and cannot unlock `production-live-ready`.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `YAHOO_FINANCE_KOSPI_SYMBOL` | KOSPI proxy symbol; defaults to `^KS11`. |
| `YAHOO_FINANCE_KOSPI200_SYMBOL` | KOSPI200 index proxy symbol; defaults to `^KS200`. |
| `YAHOO_FINANCE_USDKRW_SYMBOL` | FX context symbol; defaults to `KRW=X`. |
| `YAHOO_FINANCE_INTRADAY_RANGE` | 1-minute chart range; defaults to `1d`. Yahoo generally caps 1-minute requests to a short recent window. |
| `YAHOO_FINANCE_DAILY_RANGE` | Daily history range for probability inputs; defaults to `6mo`. |
| `YAHOO_FINANCE_TIMEOUT_MS` / `YAHOO_FINANCE_MAX_BODY_BYTES` | Fetch timeout/body cap; defaults are 5000 ms and 768 KiB. |

## Normalized JSON HTTP adapter

For integration testing or a future approved upstream normalizer, `MARKET_DATA_ADAPTER=json-http` enables a strict adapter that fetches a normalized snapshot from `MARKET_DATA_URL`.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `MARKET_DATA_SOURCE` | Canonical source id used in public snapshots; defaults to `json-http-market-data`. |
| `MARKET_DATA_TIMEOUT_MS` | Fetch timeout; defaults to 5000 ms. |
| `MARKET_DATA_MAX_BODY_BYTES` | Response body cap; defaults to 256 KiB. |
| `MARKET_DATA_AUTH_HEADER_NAME` / `MARKET_DATA_AUTH_HEADER_VALUE` | Optional header pair kept in environment only. |
| `MARKET_DATA_LIVE`, `MARKET_DATA_APPROVED_PUBLIC`, `MARKET_DATA_READINESS_ALLOWED` | Adapter capability flags; still insufficient for live readiness without the source registry. |
| `MARKET_DATA_SOURCE_APPROVAL`, `MARKET_DATA_LICENSE` | Approval/license claims that must match the system-owned registry before live readiness. |

The adapter accepts only a JSON object with `fields` as an object and optional `values` as an object. Top-level and field-level freshness must be explicitly valid; missing or invalid freshness is normalized to `unavailable`. Field keys are whitelisted to the known product fields, and field provenance `source`, `observedAt`, `details`, plus adapter capability strings are sanitized or replaced with safe fallbacks before public exposure. Public values are whitelisted to the known numeric/calendar keys used by this product; unknown keys, non-finite values, out-of-range baseline rates, unsafe text, numeric-looking strings, and invalid holiday-calendar arrays are dropped before `/api/snapshot` or `/api/dashboard` can expose them. Invalid JSON, non-object payloads, oversized or over-`Content-Length` bodies, failed HTTP status, timeouts, or provider errors produce `freshness: "error"` with stable public codes. Adapter messages/details are sanitized to hide credentials, private hosts, URLs, stack traces, and raw provider diagnostics. If an auth header is configured, plain `http:` upstream URLs are rejected before any fetch is attempted.

## KRX OPEN API adapter

`MARKET_DATA_ADAPTER=krx-open-api` enables a direct KRX OPEN API polling adapter. KRX OPEN API service pages require login/auth-key application, API service search/spec review, API utilization application, and administrator approval before service use. Public market-data distribution may also require a separate market-data ordering/license process depending on use.

Required and optional environment variables:

| Variable | Purpose |
| --- | --- |
| `KRX_OPEN_API_KEY` | KRX OPEN API credential sent as the `AUTH_KEY` header by default. |
| `KRX_OPEN_API_AUTH_HEADER_NAME` | Optional header name override; defaults to `AUTH_KEY`. |
| `KRX_OPEN_API_KOSPI_DAILY_URL` | Approved KOSPI daily index endpoint URL. Used to derive `kospiDaily`, `historicalMondayDownRate`, `recentMomentum`, and volatility. |
| `KRX_OPEN_API_KOSPI200_DAILY_URL` | Approved KOSPI200 daily index endpoint URL. Used with futures rows to derive `futuresBasis`. |
| `KRX_OPEN_API_FUTURES_URL` | Approved KOSPI200 futures endpoint URL. Used for futures open interest, volume, and futures price. |
| `KRX_OPEN_API_OPTIONS_URL` | Approved KOSPI200 options endpoint URL. Used for options open interest, volume, and put/call ratio. |
| `KRX_OPEN_API_INVESTOR_FLOW_URL` | Approved investor-flow endpoint URL. Used for foreign-investor KOSPI200 futures flow when present. |
| `KRX_OPEN_API_HOLIDAY_CALENDAR_URL` | Approved holiday/trading-calendar endpoint URL. Used to apply expiry/settlement holiday adjustment. |
| `KRX_OPEN_API_COMMON_PARAMS_JSON` | Optional JSON object appended to every endpoint URL; defaults to `{ "reqType": "json" }`. |
| `KRX_OPEN_API_*_PARAMS_JSON` | Optional per-endpoint JSON query params, e.g. `KRX_OPEN_API_KOSPI_DAILY_PARAMS_JSON='{"API_ID":"..."}'`. |
| `KRX_OPEN_API_TIMEOUT_MS` / `KRX_OPEN_API_MAX_BODY_BYTES` | Optional fetch timeout/body cap; defaults are 5000 ms and 512 KiB. |
| `KRX_OPEN_API_LIVE`, `KRX_OPEN_API_APPROVED_PUBLIC`, `KRX_OPEN_API_READINESS_ALLOWED` | Adapter capability flags. They are necessary but still insufficient for `liveReady` without registry approval. |
| `KRX_OPEN_API_SOURCE_APPROVAL`, `KRX_OPEN_API_LICENSE` | Approval/license identifiers that must match `APPROVED_LIVE_SOURCE_REGISTRY` before live readiness can unlock. |

The adapter accepts KRX-style JSON table payloads with row arrays nested anywhere within the response object. It uses conservative aliases for date, close, price, volume, open-interest, option side, investor type, and net-flow columns. It computes:

- `historicalMondayDownRate` from Monday KOSPI closes versus the previous trading row.
- `recentMomentum` and `volatilityZScore` from recent KOSPI closes.
- `futuresBasis` from the configured futures price minus KOSPI200 spot/index reference.
- Futures/options open interest and volume by summing configured endpoint rows.
- `putCallRatio` from option side and volume rows.
- `foreignerNetFutures` from the foreign-investor futures-flow row.
- `holidayCalendar` from configured holiday/trading-calendar date rows.

If a configured endpoint fails or does not provide a parseable field, that field remains explicitly `unavailable`; if every configured endpoint fails, the adapter returns a sanitized `error` snapshot. Provider exceptions, secrets, URLs with private diagnostics, and unsupported fields are not exposed verbatim.

## Future KRX/free-source adapter rules

A future authorized adapter should follow these constraints:

1. Use only approved free/public credentials and documented endpoints.
2. Keep credentials in environment variables; never commit secrets.
3. Declare explicit capabilities: `liveMarketData: true`, `approvedPublic: true`, `readinessAllowed: true`, a documented `sourceApproval`, and a `license` string; the source/license pair must also be registered in `APPROVED_LIVE_SOURCE_REGISTRY` before the adapter can unlock live readiness.
4. Normalize every field with `source`, `observedAt`, `freshness`, and optional sanitized `error` details.
5. Prefer `unavailable` or `error` over inferred live values when data cannot be fetched or parsed; adapter error strings exposed to public JSON should be stable codes rather than raw provider exceptions.
6. Preserve the UI polling controls, backend interval clamps, and force-refresh rate limiting.
7. Do not add order execution, brokerage, production-grade hardening claims, or advice-oriented output.
8. Add adapter tests with mocked responses before enabling the adapter in local runtime paths.

## Realtime caveats

The product language uses best-effort polling, not exchange-grade realtime delivery. Free/public APIs can have approval steps, service windows, quotas, endpoint changes, and delayed update cadence. The dashboard must display source freshness so users can distinguish fresh data from stale, unavailable, or error states.

## Probability caveat

The probability card is an explainable monitoring estimate. It exposes status, confidence, missing inputs, source freshness, and contribution notes. It must not hide degraded data quality behind a precise-looking number: stale required KOSPI daily or baseline-rate inputs suppress the headline numeric probability until fresh again. `historicalMondayDownRate` and `recentMomentum` require explicit field provenance; optional volatility requires separate `volatility` provenance. Optional adjustment values with missing or degraded provenance are ignored and reported as degraded rather than silently used.
