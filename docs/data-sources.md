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
- `fields`: field-level provenance entries such as `kospiDaily`, `kospi200`, `derivativesCalendar`, and `volatility`
- `values`: numeric inputs used by pure domain logic
- `message` and `error`: visible context for operators

Backend polling adds:

- `polledAt`: local polling timestamp
- `polling`: active interval/config metadata

## Future KRX/free-source adapter rules

A future authorized adapter should follow these constraints:

1. Use only approved free/public credentials and documented endpoints.
2. Keep credentials in environment variables; never commit secrets.
3. Normalize every field with `source`, `observedAt`, `freshness`, and optional `error` details.
4. Prefer `unavailable` or `error` over inferred live values when data cannot be fetched or parsed.
5. Preserve the UI polling controls and backend interval clamps.
6. Do not add order execution, brokerage, public production deployment, or advice-oriented output.
7. Add adapter tests with mocked responses before enabling the adapter in local runtime paths.

## Realtime caveats

The product language uses best-effort polling, not exchange-grade realtime delivery. Free/public APIs can have approval steps, service windows, quotas, endpoint changes, and delayed update cadence. The dashboard must display source freshness so users can distinguish fresh data from stale, unavailable, or error states.

## Probability caveat

The probability card is an explainable monitoring estimate. It exposes status, confidence, missing inputs, source freshness, and contribution notes. It must not hide degraded data quality behind a precise-looking number.
