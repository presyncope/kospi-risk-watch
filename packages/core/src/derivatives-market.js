import { FRESHNESS } from './freshness.js';
import { MAX_HOLIDAY_DATES, isValidDateKey } from './expiry.js';

export const DERIVATIVES_MARKET_STATUS = Object.freeze({
  AVAILABLE: 'available',
  STALE: 'stale',
  PARTIAL: 'partial',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
});

export const DERIVATIVES_MARKET_METRICS = Object.freeze([
  {
    key: 'futuresBasis',
    label: 'Futures basis',
    unit: 'pt',
    valueType: 'number',
    description: 'Nearest KOSPI200 futures price minus spot/index reference.',
    requiredForLive: true,
  },
  {
    key: 'futuresOpenInterest',
    label: 'Futures open interest',
    unit: 'contracts',
    valueType: 'number',
    description: 'Outstanding KOSPI200 futures contracts for the monitored contract set.',
    requiredForLive: true,
  },
  {
    key: 'futuresVolume',
    label: 'Futures volume',
    unit: 'contracts',
    valueType: 'number',
    description: 'Current-session KOSPI200 futures trading volume for liquidity context.',
    requiredForLive: true,
  },
  {
    key: 'optionsOpenInterest',
    label: 'Options open interest',
    unit: 'contracts',
    valueType: 'number',
    description: 'Outstanding KOSPI200 options contracts across the monitored expiry set.',
    requiredForLive: true,
  },
  {
    key: 'optionsVolume',
    label: 'Options volume',
    unit: 'contracts',
    valueType: 'number',
    description: 'Current-session KOSPI200 options trading volume for activity context.',
    requiredForLive: true,
  },
  {
    key: 'putCallRatio',
    label: 'Put/call ratio',
    unit: 'ratio',
    valueType: 'number',
    description: 'Options activity or open-interest ratio, depending on adapter provenance.',
    requiredForLive: true,
  },
  {
    key: 'foreignerNetFutures',
    label: 'Foreigner net futures flow',
    unit: 'contracts',
    valueType: 'number',
    description: 'Net KOSPI200 futures flow from the foreign-investor category when an adapter provides it.',
    requiredForLive: true,
  },
  {
    key: 'holidayCalendar',
    label: 'Holiday calendar',
    unit: 'calendar',
    valueType: 'calendar',
    description: 'Approved trading-day calendar used to move expiry or settlement dates around holidays.',
    requiredForLive: true,
  },
]);

function hasInvalidMetricValue(definition, value) {
  if (value == null) return false;
  if (definition.valueType === 'number') return !Number.isFinite(value);
  if (definition.valueType === 'calendar') return !Array.isArray(value) || value.length === 0 || value.length > MAX_HOLIDAY_DATES || !value.every(isValidDateKey);
  return false;
}

function metricStatus({ definition, provenance, value }) {
  const freshness = provenance?.freshness ?? FRESHNESS.UNAVAILABLE;
  if (freshness === FRESHNESS.ERROR) return DERIVATIVES_MARKET_STATUS.ERROR;
  if (hasInvalidMetricValue(definition, value)) return DERIVATIVES_MARKET_STATUS.UNAVAILABLE;
  if (freshness === FRESHNESS.UNAVAILABLE || value == null) return DERIVATIVES_MARKET_STATUS.UNAVAILABLE;
  if (freshness === FRESHNESS.STALE) return DERIVATIVES_MARKET_STATUS.STALE;
  return DERIVATIVES_MARKET_STATUS.AVAILABLE;
}

function displayMetricValue(definition, value) {
  if (value == null) return 'Unavailable';
  if (hasInvalidMetricValue(definition, value)) return 'Unavailable';
  if (definition.valueType === 'calendar') {
    return value.length === 1 ? '1 holiday date' : `${value.length} holiday dates`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'Unavailable';
    const formatted = Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(2);
    return definition.unit && definition.unit !== 'ratio' ? `${formatted} ${definition.unit}` : formatted;
  }
  return String(value);
}

function unavailableReason(definition, provenance, value) {
  if (provenance?.error) return provenance.error;
  if (!provenance) return 'Adapter did not provide this metric.';
  if (provenance.freshness === FRESHNESS.UNAVAILABLE) return provenance.details ?? 'Source marks this metric unavailable.';
  if (value == null) return 'Metric value is missing even though provenance exists.';
  if (hasInvalidMetricValue(definition, value)) {
    return definition.valueType === 'calendar'
      ? 'Metric value is not a valid holiday calendar date array.'
      : 'Metric value is not finite numeric.';
  }
  return provenance.details ?? null;
}

function buildMetric(definition, snapshot = {}) {
  const provenance = snapshot.fields?.[definition.key] ?? null;
  const value = snapshot.values?.[definition.key] ?? null;
  const status = metricStatus({ definition, provenance, value });
  const publicValue = status === DERIVATIVES_MARKET_STATUS.AVAILABLE || status === DERIVATIVES_MARKET_STATUS.STALE
    ? value
    : null;
  return {
    ...definition,
    status,
    value: publicValue,
    displayValue: displayMetricValue(definition, publicValue),
    source: provenance?.source ?? snapshot.source ?? 'unconfigured',
    observedAt: provenance?.observedAt ?? null,
    freshness: provenance?.freshness ?? FRESHNESS.UNAVAILABLE,
    reason: status === DERIVATIVES_MARKET_STATUS.AVAILABLE || status === DERIVATIVES_MARKET_STATUS.STALE
      ? provenance?.details ?? null
      : unavailableReason(definition, provenance, value),
  };
}

function statusCounts(metrics) {
  return {
    total: metrics.length,
    available: metrics.filter((metric) => metric.status === DERIVATIVES_MARKET_STATUS.AVAILABLE).length,
    stale: metrics.filter((metric) => metric.status === DERIVATIVES_MARKET_STATUS.STALE).length,
    unavailable: metrics.filter((metric) => metric.status === DERIVATIVES_MARKET_STATUS.UNAVAILABLE).length,
    error: metrics.filter((metric) => metric.status === DERIVATIVES_MARKET_STATUS.ERROR).length,
  };
}

function coverageFromMetrics(metrics) {
  const counts = statusCounts(metrics);
  const requiredMetrics = metrics.filter((metric) => metric.requiredForLive);
  const required = statusCounts(requiredMetrics);
  return {
    ...counts,
    required,
    ratio: counts.total === 0 ? 0 : Number(((counts.available + counts.stale * 0.5) / counts.total).toFixed(2)),
    requiredRatio: required.total === 0 ? 0 : Number((required.available / required.total).toFixed(2)),
  };
}

function contextStatus(coverage) {
  if (coverage.error > 0 && coverage.available === 0 && coverage.stale === 0) return DERIVATIVES_MARKET_STATUS.ERROR;
  if (coverage.required.total > 0
    && coverage.required.available === coverage.required.total
    && coverage.required.stale === 0
    && coverage.required.error === 0
    && coverage.required.unavailable === 0) return DERIVATIVES_MARKET_STATUS.AVAILABLE;
  if (coverage.available > 0 || coverage.stale > 0) return DERIVATIVES_MARKET_STATUS.PARTIAL;
  return DERIVATIVES_MARKET_STATUS.UNAVAILABLE;
}

export function buildDerivativesMarketContext({ snapshot = {}, expirySettlement = {} } = {}) {
  const metrics = DERIVATIVES_MARKET_METRICS.map((definition) => buildMetric(definition, snapshot));
  const coverage = coverageFromMetrics(metrics);
  const status = contextStatus(coverage);
  const unavailableLabels = metrics
    .filter((metric) => metric.status === DERIVATIVES_MARKET_STATUS.UNAVAILABLE || metric.status === DERIVATIVES_MARKET_STATUS.ERROR)
    .map((metric) => metric.label);
  return {
    status,
    summary: `${coverage.available}/${coverage.total} derivatives market metrics available; ${coverage.required.available}/${coverage.required.total} live-critical metrics fresh; expiry calendar status is ${expirySettlement.riskLevel ?? 'unknown'}.`,
    coverage,
    metrics,
    blockers: unavailableLabels.length ? unavailableLabels.map((label) => `${label} is unavailable from the configured adapter.`) : [],
  };
}
