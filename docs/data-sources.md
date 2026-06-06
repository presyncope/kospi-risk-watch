# Data sources and integration limits

This dashboard treats source status as a first-class product feature. A missing, stale, or failing source must be shown to the user and must not be converted into a precise market signal.

## Current adapters

| Adapter | How to enable | Status | Intended use |
| --- | --- | --- | --- |
| `krx-free-source-placeholder` | default | `unavailable` | Safe default when no approved source is configured. |
| `mock-market-data` | `MARKET_DATA_ADAPTER=mock` | `fresh` | Deterministic local development and tests. |
| `mock-market-data` stale mode | `MARKET_DATA_ADAPTER=mock-stale` | `stale` | Data-quality alert testing. |
| `mock-market-data` error mode | `MARKET_DATA_ADAPTER=mock-error` | `error` | Error rendering and degraded-state testing. |

A provided `KRX_OPEN_API_KEY` currently selects only a placeholder. It documents where a later approved KRX adapter should attach, but it still returns `unavailable` in this MVP.

## Adapter contract

Adapters return normalized snapshots with:

- `source`: source identifier
- `observedAt`: source observation timestamp
- `freshness`: `fresh`, `stale`, `unavailable`, or `error`
- `fields`: field-level provenance entries such as `kospiDaily`, `kospi200`, `derivativesCalendar`, `volatility`, and derivatives metric fields
- `values`: numeric inputs used by pure domain logic
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
| `holidayCalendar` | Approved trading-day calendar for expiry and settlement adjustments | source, observedAt, freshness, optional details |

If a field is unavailable, the adapter should still include field provenance with `freshness: "unavailable"` and a short reason. Domain code will not synthesize a metric value from missing data. Numeric metric values must be finite JavaScript numbers; non-finite numbers, numeric-looking strings, and other non-numeric values are treated as unavailable. All listed fields are currently live-critical: missing, stale, or invalid critical fields keep derivatives status below approved live-monitor readiness.

## Readiness scoring contract

`quantReadiness` grades system/data completeness only. It combines system-owned source approval, probability status, live-critical derivatives coverage, expiry-calendar availability, polling visibility, and observation-only guardrails. The expiry check separates transparent rule-based monthly expiry logic from holiday-adjusted live readiness: a rule-only calendar stays in `watch` until fresh holiday-calendar provenance is present. Mock fixtures can demonstrate `analysis-review-ready` rendering but must remain labelled mock/not-live; default unavailable or unapproved fresh adapters remain `operational-shell`. `approved-live-monitor-ready` requires an approved free/public live adapter from the central registry plus fresh probability inputs and every live-critical derivatives metric.

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
