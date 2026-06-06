import { FRESHNESS, createProvenance } from '../../core/src/index.js';

export const ADAPTER_STATUSES = Object.freeze({
  FRESH: FRESHNESS.FRESH,
  STALE: FRESHNESS.STALE,
  UNAVAILABLE: FRESHNESS.UNAVAILABLE,
  ERROR: FRESHNESS.ERROR,
});

export function normalizeAdapterResult({ source, fields = {}, values = {}, observedAt = new Date().toISOString(), freshness = FRESHNESS.FRESH, error = null, message = null } = {}) {
  const normalizedFields = Object.fromEntries(
    Object.entries(fields).map(([name, provenance]) => [
      name,
      createProvenance({ source: provenance.source ?? source, observedAt: provenance.observedAt ?? observedAt, freshness: provenance.freshness ?? freshness, error: provenance.error ?? error, details: provenance.details ?? null }),
    ]),
  );
  return {
    source: source ?? 'unknown',
    observedAt,
    freshness,
    error,
    message,
    fields: normalizedFields,
    values,
  };
}

export function createUnavailableAdapter(source = 'unconfigured') {
  return {
    source,
    async getSnapshot() {
      const observedAt = new Date().toISOString();
      return normalizeAdapterResult({
        source,
        observedAt,
        freshness: FRESHNESS.UNAVAILABLE,
        error: null,
        message: 'No approved free/public market data source is configured.',
        fields: {
          kospiDaily: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE },
          kospi200: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE },
          derivativesCalendar: { source: 'krx-calendar-rules', observedAt, freshness: FRESHNESS.FRESH },
        },
        values: {},
      });
    },
  };
}

export function createMockMarketDataAdapter({ source = 'mock-market-data', stale = false, fail = false } = {}) {
  return {
    source,
    async getSnapshot() {
      const observedAt = stale ? new Date(Date.now() - 60 * 60_000).toISOString() : new Date().toISOString();
      if (fail) {
        return normalizeAdapterResult({
          source,
          observedAt,
          freshness: FRESHNESS.ERROR,
          error: 'mock adapter forced failure',
          message: 'Mock adapter error for testing.',
          fields: {
            kospiDaily: { source, observedAt, freshness: FRESHNESS.ERROR, error: 'mock adapter forced failure' },
          },
        });
      }
      const freshness = stale ? FRESHNESS.STALE : FRESHNESS.FRESH;
      return normalizeAdapterResult({
        source,
        observedAt,
        freshness,
        message: 'Deterministic mock data for local development and tests.',
        fields: {
          kospiDaily: { source, observedAt, freshness },
          kospi200: { source, observedAt, freshness },
          derivativesCalendar: { source: 'krx-calendar-rules', observedAt, freshness: FRESHNESS.FRESH },
          volatility: { source, observedAt, freshness },
        },
        values: {
          historicalMondayDownRate: 0.53,
          recentMomentum: -0.018,
          volatilityZScore: 1.1,
        },
      });
    },
  };
}

export function createKrxFreeSourcePlaceholder({ apiKey = process.env.KRX_OPEN_API_KEY } = {}) {
  if (!apiKey) return createUnavailableAdapter('krx-free-source-placeholder');
  return {
    source: 'krx-open-api-placeholder',
    async getSnapshot() {
      const observedAt = new Date().toISOString();
      return normalizeAdapterResult({
        source: 'krx-open-api-placeholder',
        observedAt,
        freshness: FRESHNESS.UNAVAILABLE,
        message: 'KRX OPEN API integration is not implemented in the MVP scaffold; approved credentials require a later adapter implementation.',
        fields: {
          kospiDaily: { source: 'krx-open-api-placeholder', observedAt, freshness: FRESHNESS.UNAVAILABLE },
        },
        values: {},
      });
    },
  };
}

export function createAdapterFromEnv(env = process.env) {
  if (env.MARKET_DATA_ADAPTER === 'mock') return createMockMarketDataAdapter();
  if (env.MARKET_DATA_ADAPTER === 'mock-stale') return createMockMarketDataAdapter({ stale: true });
  if (env.MARKET_DATA_ADAPTER === 'mock-error') return createMockMarketDataAdapter({ fail: true });
  return createKrxFreeSourcePlaceholder({ apiKey: env.KRX_OPEN_API_KEY });
}
