import { FRESHNESS, createProvenance, sanitizePublicDiagnosticText } from '../../core/src/index.js';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PUBLIC_ADAPTER_ERROR_CODES = new Set([
  'adapter_snapshot_error',
  'adapter_field_error',
  'adapter_json_http_failed',
  'adapter_polling_failed',
]);

export const ADAPTER_STATUSES = Object.freeze({
  FRESH: FRESHNESS.FRESH,
  STALE: FRESHNESS.STALE,
  UNAVAILABLE: FRESHNESS.UNAVAILABLE,
  ERROR: FRESHNESS.ERROR,
});

function sanitizePublicAdapterError(error, fallback) {
  if (!error) return null;
  if (typeof error === 'string' && PUBLIC_ADAPTER_ERROR_CODES.has(error)) return error;
  return fallback;
}

function sanitizePublicAdapterText(text, fallback = null) {
  return sanitizePublicDiagnosticText(text, fallback);
}

function sanitizeCapabilityText(text, fallback = 'unspecified') {
  const safeText = sanitizePublicAdapterText(text);
  if (!safeText) return fallback;
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(safeText)) return fallback;
  return safeText;
}

const SNAPSHOT_FIELD_NAMES = Object.freeze([
  'kospiDaily',
  'historicalMondayDownRate',
  'recentMomentum',
  'kospi200',
  'derivativesCalendar',
  'volatility',
  'futuresBasis',
  'futuresOpenInterest',
  'futuresVolume',
  'optionsOpenInterest',
  'optionsVolume',
  'putCallRatio',
  'foreignerNetFutures',
  'holidayCalendar',
]);

const SNAPSHOT_FIELD_NAME_SET = new Set(SNAPSHOT_FIELD_NAMES);
const ALLOWED_FRESHNESS = new Set(Object.values(FRESHNESS));

const ADAPTER_VALUE_SCHEMA = Object.freeze({
  historicalMondayDownRate: { type: 'number', min: 0, max: 1 },
  recentMomentum: { type: 'number' },
  volatilityZScore: { type: 'number' },
  futuresBasis: { type: 'number' },
  futuresOpenInterest: { type: 'number' },
  futuresVolume: { type: 'number' },
  optionsOpenInterest: { type: 'number' },
  optionsVolume: { type: 'number' },
  putCallRatio: { type: 'number' },
  foreignerNetFutures: { type: 'number' },
  holidayCalendar: { type: 'date-array', minItems: 1, maxItems: 512 },
});

function unavailableFields(source, observedAt, { freshness = FRESHNESS.UNAVAILABLE, details = null } = {}) {
  return Object.fromEntries(
    SNAPSHOT_FIELD_NAMES.map((name) => [
      name,
      { source: name === 'derivativesCalendar' ? 'krx-calendar-rules' : source, observedAt, freshness, details },
    ]),
  );
}

function normalizeFreshness(value, fallback = FRESHNESS.UNAVAILABLE) {
  return ALLOWED_FRESHNESS.has(value) ? value : fallback;
}

function normalizeFieldFreshness(value) {
  if (value == null) return FRESHNESS.UNAVAILABLE;
  return normalizeFreshness(value, FRESHNESS.UNAVAILABLE);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeSourceName(value, fallback) {
  const safeText = sanitizePublicAdapterText(value);
  if (!safeText) return fallback ?? 'unknown';
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(safeText)) return fallback ?? 'unknown';
  return safeText;
}

function safeObservedAt(value, fallback) {
  if (value == null) return fallback ?? null;
  if (typeof value !== 'string') return fallback ?? null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 40) return fallback ?? null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback ?? null;
}

function normalizeAdapterValues(values = {}) {
  if (!isRecord(values)) return {};
  const normalized = {};
  for (const [key, schema] of Object.entries(ADAPTER_VALUE_SCHEMA)) {
    const value = values[key];
    if (value == null) continue;
    if (schema.type === 'number') {
      if (!Number.isFinite(value)) continue;
      if (schema.min != null && value < schema.min) continue;
      if (schema.max != null && value > schema.max) continue;
      normalized[key] = value;
      continue;
    }
    if (schema.type === 'safe-text') {
      const safeText = sanitizePublicAdapterText(value);
      if (safeText) normalized[key] = safeText;
      continue;
    }
    if (schema.type === 'date-array') {
      if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) continue;
      const dateKeys = [];
      let valid = true;
      for (const item of value) {
        if (typeof item !== 'string') {
          valid = false;
          break;
        }
        const trimmed = item.trim();
        const parsed = new Date(`${trimmed}T00:00:00Z`);
        if (!DATE_KEY_PATTERN.test(trimmed)
          || !Number.isFinite(parsed.getTime())
          || parsed.toISOString().slice(0, 10) !== trimmed) {
          valid = false;
          break;
        }
        dateKeys.push(trimmed);
      }
      if (valid) normalized[key] = [...new Set(dateKeys)];
    }
  }
  return normalized;
}

export function normalizeAdapterResult({ source, fields = {}, values = {}, observedAt = new Date().toISOString(), freshness = FRESHNESS.UNAVAILABLE, error = null, message = null, capabilities = {} } = {}) {
  const publicSnapshotError = sanitizePublicAdapterError(error, 'adapter_snapshot_error');
  const normalizedSnapshotFreshness = normalizeFreshness(freshness, FRESHNESS.UNAVAILABLE);
  const safeSnapshotSource = safeSourceName(source, 'unknown');
  const safeSnapshotObservedAt = safeObservedAt(observedAt, new Date().toISOString());
  const fieldEntries = isRecord(fields) ? Object.entries(fields) : [];
  const normalizedFields = Object.fromEntries(
    fieldEntries.flatMap(([name, provenance]) => {
      if (!SNAPSHOT_FIELD_NAME_SET.has(name) || !isRecord(provenance)) return [];
      const publicFieldError = provenance.error
        ? sanitizePublicAdapterError(provenance.error, 'adapter_field_error')
        : publicSnapshotError;
      const fieldFreshness = normalizeFieldFreshness(provenance.freshness);
      return [[
        name,
        createProvenance({
          source: safeSourceName(provenance.source, safeSnapshotSource),
          observedAt: safeObservedAt(provenance.observedAt, safeSnapshotObservedAt),
          freshness: fieldFreshness,
          error: publicFieldError,
          details: sanitizePublicAdapterText(provenance.details, 'adapter_field_detail_hidden'),
        }),
      ]];
    }),
  );
  return {
    source: safeSnapshotSource,
    observedAt: safeSnapshotObservedAt,
    freshness: normalizedSnapshotFreshness,
    error: publicSnapshotError,
    message: sanitizePublicAdapterText(message, 'adapter_message_hidden'),
    capabilities: {
      mock: capabilities.mock === true,
      liveMarketData: capabilities.liveMarketData === true,
      approvedPublic: capabilities.approvedPublic === true,
      sourceApproval: sanitizeCapabilityText(capabilities.sourceApproval, 'unapproved'),
      license: sanitizeCapabilityText(capabilities.license, 'unspecified'),
      readinessAllowed: capabilities.readinessAllowed === true,
    },
    fields: normalizedFields,
    values: normalizeAdapterValues(values),
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
          ...unavailableFields(source, observedAt),
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
          holidayCalendar: ['2026-06-03'],
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
        message: 'KRX OPEN API credentials are present, but approved service endpoints are not configured; adapter remains unavailable.',
        capabilities: { sourceApproval: 'placeholder' },
        fields: unavailableFields('krx-open-api-placeholder', observedAt),
        values: {},
      });
    },
  };
}

function envFlag(value) {
  return ['1', 'true', 'yes', 'y'].includes(String(value ?? '').trim().toLowerCase());
}

function configuredHeadersFromEnv(env = process.env) {
  const name = env.MARKET_DATA_AUTH_HEADER_NAME?.trim();
  const value = env.MARKET_DATA_AUTH_HEADER_VALUE?.trim();
  return name && value ? { [name]: value } : {};
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hasConfiguredHeaders(headers) {
  if (!headers) return false;
  if (typeof Headers === 'function' && headers instanceof Headers) return Array.from(headers.keys()).length > 0;
  if (headers instanceof Map) return headers.size > 0;
  if (Array.isArray(headers)) return headers.length > 0;
  if (isRecord(headers)) return Object.keys(headers).length > 0;
  return false;
}

function normalizeJsonSnapshotPayload(payload, { source, observedAtFallback, capabilities }) {
  if (!isRecord(payload)) throw new Error('adapter_invalid_json_payload');
  if (!isRecord(payload.fields)) throw new Error('adapter_invalid_json_fields');
  if (payload.values != null && !isRecord(payload.values)) throw new Error('adapter_invalid_json_values');
  const fields = {};
  for (const [name, provenance] of Object.entries(payload.fields)) {
    if (!SNAPSHOT_FIELD_NAME_SET.has(name)) continue;
    if (!isRecord(provenance)) throw new Error(`adapter_invalid_json_field_${name}`);
    fields[name] = provenance;
  }
  const observedAt = typeof payload.observedAt === 'string' && payload.observedAt.trim()
    ? payload.observedAt
    : observedAtFallback;
  return normalizeAdapterResult({
    source,
    observedAt,
    freshness: payload.freshness == null ? FRESHNESS.UNAVAILABLE : normalizeFreshness(payload.freshness, FRESHNESS.UNAVAILABLE),
    error: payload.error,
    message: payload.message,
    capabilities: { ...(isRecord(payload.capabilities) ? payload.capabilities : {}), ...capabilities },
    fields,
    values: payload.values ?? {},
  });
}

async function readResponseText(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('adapter_json_body_too_large');
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) throw new Error('adapter_json_body_too_large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  if (typeof response.text === 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('adapter_json_body_too_large');
    return text;
  }
  throw new Error('adapter_response_body_unreadable');
}

export function createJsonHttpMarketDataAdapter({
  url,
  source = 'json-http-market-data',
  headers = {},
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
  maxBodyBytes = 256 * 1024,
  capabilities = {},
} = {}) {
  if (!url) return createUnavailableAdapter('json-http-unconfigured');
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return createUnavailableAdapter('json-http-invalid-url');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) return createUnavailableAdapter('json-http-invalid-url');
  if (parsedUrl.protocol === 'http:' && hasConfiguredHeaders(headers)) return createUnavailableAdapter('json-http-insecure-auth-url');
  return {
    source,
    async getSnapshot() {
      const observedAt = new Date().toISOString();
      if (typeof fetchImpl !== 'function') {
        return normalizeAdapterResult({
          source,
          observedAt,
          freshness: FRESHNESS.ERROR,
          error: 'adapter_json_http_failed',
          message: 'Configured JSON market data source cannot be fetched in this runtime.',
          capabilities: { sourceApproval: 'unapproved' },
          fields: unavailableFields(source, observedAt, { freshness: FRESHNESS.ERROR, details: 'Fetch runtime is unavailable.' }),
          values: {},
        });
      }
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetchImpl(parsedUrl.href, { headers, signal: controller?.signal });
        if (!response?.ok) throw new Error('adapter_http_status_error');
        const text = await readResponseText(response, maxBodyBytes);
        const payload = JSON.parse(text);
        return normalizeJsonSnapshotPayload(payload, { source, observedAtFallback: observedAt, capabilities });
      } catch {
        return normalizeAdapterResult({
          source,
          observedAt,
          freshness: FRESHNESS.ERROR,
          error: 'adapter_json_http_failed',
          message: 'Configured JSON market data source could not be polled; details are hidden from the public dashboard.',
          capabilities: { sourceApproval: 'error' },
          fields: unavailableFields(source, observedAt, { freshness: FRESHNESS.ERROR, details: 'Configured JSON market data source polling failed.' }),
          values: {},
        });
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
}

export function createAdapterFromEnv(env = process.env) {
  if (env.MARKET_DATA_ADAPTER === 'mock') return createMockMarketDataAdapter();
  if (env.MARKET_DATA_ADAPTER === 'mock-stale') return createMockMarketDataAdapter({ stale: true });
  if (env.MARKET_DATA_ADAPTER === 'mock-error') return createMockMarketDataAdapter({ fail: true });
  if (env.MARKET_DATA_ADAPTER === 'json-http') {
    return createJsonHttpMarketDataAdapter({
      url: env.MARKET_DATA_URL,
      source: env.MARKET_DATA_SOURCE || 'json-http-market-data',
      headers: configuredHeadersFromEnv(env),
      timeoutMs: parsePositiveNumber(env.MARKET_DATA_TIMEOUT_MS, 5_000),
      maxBodyBytes: parsePositiveNumber(env.MARKET_DATA_MAX_BODY_BYTES, 256 * 1024),
      capabilities: {
        liveMarketData: envFlag(env.MARKET_DATA_LIVE),
        approvedPublic: envFlag(env.MARKET_DATA_APPROVED_PUBLIC),
        readinessAllowed: envFlag(env.MARKET_DATA_READINESS_ALLOWED),
        sourceApproval: env.MARKET_DATA_SOURCE_APPROVAL ?? 'unapproved',
        license: env.MARKET_DATA_LICENSE ?? 'unspecified',
      },
    });
  }
  return createKrxFreeSourcePlaceholder({ apiKey: env.KRX_OPEN_API_KEY });
}
