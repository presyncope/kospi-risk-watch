import { FRESHNESS, createProvenance } from '../../core/src/index.js';

export const ADAPTER_STATUSES = Object.freeze({
  FRESH: FRESHNESS.FRESH,
  STALE: FRESHNESS.STALE,
  UNAVAILABLE: FRESHNESS.UNAVAILABLE,
  ERROR: FRESHNESS.ERROR,
});

function sanitizePublicAdapterError(error, fallback) {
  if (!error) return null;
  if (typeof error === 'string' && /^adapter_[a-z0-9_]{1,48}$/.test(error)) return error;
  return fallback;
}

export function normalizeAdapterResult({ source, fields = {}, values = {}, observedAt = new Date().toISOString(), freshness = FRESHNESS.FRESH, error = null, message = null, capabilities = {} } = {}) {
  const publicSnapshotError = sanitizePublicAdapterError(error, 'adapter_snapshot_error');
  const normalizedFields = Object.fromEntries(
    Object.entries(fields).map(([name, provenance]) => {
      const publicFieldError = provenance.error
        ? sanitizePublicAdapterError(provenance.error, 'adapter_field_error')
        : publicSnapshotError;
      return [
        name,
        createProvenance({ source: provenance.source ?? source, observedAt: provenance.observedAt ?? observedAt, freshness: provenance.freshness ?? freshness, error: publicFieldError, details: provenance.details ?? null }),
      ];
    }),
  );
  return {
    source: source ?? 'unknown',
    observedAt,
    freshness,
    error: publicSnapshotError,
    message,
    capabilities: {
      mock: capabilities.mock === true,
      liveMarketData: capabilities.liveMarketData === true,
      approvedPublic: capabilities.approvedPublic === true,
      sourceApproval: capabilities.sourceApproval ?? 'unapproved',
      license: capabilities.license ?? 'unspecified',
      readinessAllowed: capabilities.readinessAllowed === true,
    },
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
        capabilities: { sourceApproval: 'unconfigured' },
        fields: {
          kospiDaily: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE },
          historicalMondayDownRate: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE },
          recentMomentum: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE },
          kospi200: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE },
          derivativesCalendar: { source: 'krx-calendar-rules', observedAt, freshness: FRESHNESS.FRESH },
          futuresBasis: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE, details: 'No approved derivatives market source is configured.' },
          futuresOpenInterest: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE, details: 'No approved derivatives market source is configured.' },
          futuresVolume: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE, details: 'No approved derivatives market source is configured.' },
          optionsOpenInterest: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE, details: 'No approved derivatives market source is configured.' },
          optionsVolume: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE, details: 'No approved derivatives market source is configured.' },
          putCallRatio: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE, details: 'No approved derivatives market source is configured.' },
          foreignerNetFutures: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE, details: 'No approved derivatives market source is configured.' },
          holidayCalendar: { source, observedAt, freshness: FRESHNESS.UNAVAILABLE, details: 'No approved holiday calendar source is configured.' },
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
          capabilities: { mock: true, sourceApproval: 'mock-fixture' },
          fields: {
            kospiDaily: { source, observedAt, freshness: FRESHNESS.ERROR, error: 'mock adapter forced failure' },
            historicalMondayDownRate: { source, observedAt, freshness: FRESHNESS.ERROR, error: 'mock adapter forced failure' },
            recentMomentum: { source, observedAt, freshness: FRESHNESS.ERROR, error: 'mock adapter forced failure' },
          },
        });
      }
      const freshness = stale ? FRESHNESS.STALE : FRESHNESS.FRESH;
      return normalizeAdapterResult({
        source,
        observedAt,
        freshness,
        message: 'Deterministic mock data for local development and tests.',
        capabilities: { mock: true, sourceApproval: 'mock-fixture' },
        fields: {
          kospiDaily: { source, observedAt, freshness },
          historicalMondayDownRate: { source, observedAt, freshness, details: 'Derived from mock KOSPI daily history.' },
          recentMomentum: { source, observedAt, freshness, details: 'Derived from mock KOSPI daily history.' },
          kospi200: { source, observedAt, freshness },
          derivativesCalendar: { source: 'krx-calendar-rules', observedAt, freshness: FRESHNESS.FRESH },
          volatility: { source, observedAt, freshness },
          futuresBasis: { source, observedAt, freshness, details: 'Mock fixture; not live market data.' },
          futuresOpenInterest: { source, observedAt, freshness, details: 'Mock fixture; not live market data.' },
          futuresVolume: { source, observedAt, freshness, details: 'Mock fixture; not live market data.' },
          optionsOpenInterest: { source, observedAt, freshness, details: 'Mock fixture; not live market data.' },
          optionsVolume: { source, observedAt, freshness, details: 'Mock fixture; not live market data.' },
          putCallRatio: { source, observedAt, freshness, details: 'Mock fixture; not live market data.' },
          foreignerNetFutures: { source, observedAt, freshness, details: 'Mock fixture; not live market data.' },
          holidayCalendar: { source: 'mock-holiday-calendar', observedAt, freshness, details: 'Mock fixture; not an exchange calendar.' },
        },
        values: {
          historicalMondayDownRate: 0.53,
          recentMomentum: -0.018,
          volatilityZScore: 1.1,
          futuresBasis: -0.42,
          futuresOpenInterest: 192345,
          futuresVolume: 84510,
          optionsOpenInterest: 3189020,
          optionsVolume: 1412230,
          putCallRatio: 1.18,
          foreignerNetFutures: -3240,
          holidayCalendar: 'mock weekday calendar',
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
        capabilities: { sourceApproval: 'placeholder' },
        fields: {
          kospiDaily: { source: 'krx-open-api-placeholder', observedAt, freshness: FRESHNESS.UNAVAILABLE },
          historicalMondayDownRate: { source: 'krx-open-api-placeholder', observedAt, freshness: FRESHNESS.UNAVAILABLE },
          recentMomentum: { source: 'krx-open-api-placeholder', observedAt, freshness: FRESHNESS.UNAVAILABLE },
          futuresBasis: { source: 'krx-open-api-placeholder', observedAt, freshness: FRESHNESS.UNAVAILABLE },
          futuresOpenInterest: { source: 'krx-open-api-placeholder', observedAt, freshness: FRESHNESS.UNAVAILABLE },
          futuresVolume: { source: 'krx-open-api-placeholder', observedAt, freshness: FRESHNESS.UNAVAILABLE },
          optionsOpenInterest: { source: 'krx-open-api-placeholder', observedAt, freshness: FRESHNESS.UNAVAILABLE },
          optionsVolume: { source: 'krx-open-api-placeholder', observedAt, freshness: FRESHNESS.UNAVAILABLE },
          putCallRatio: { source: 'krx-open-api-placeholder', observedAt, freshness: FRESHNESS.UNAVAILABLE },
          foreignerNetFutures: { source: 'krx-open-api-placeholder', observedAt, freshness: FRESHNESS.UNAVAILABLE },
          holidayCalendar: { source: 'krx-open-api-placeholder', observedAt, freshness: FRESHNESS.UNAVAILABLE },
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
