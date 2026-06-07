import { FRESHNESS, createProvenance, sanitizePublicDiagnosticText } from '../../core/src/index.js';
import { createCompositeMarketDataAdapter, createEcosMacroProvider, createFredMacroProvider } from './macro.js';
import { createKisFuturesProvider } from './kis.js';

export { createCompositeMarketDataAdapter, createEcosMacroProvider, createFredMacroProvider } from './macro.js';
export { createKisFuturesProvider } from './kis.js';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PUBLIC_ADAPTER_ERROR_CODES = new Set([
  'adapter_snapshot_error',
  'adapter_field_error',
  'adapter_json_http_failed',
  'adapter_krx_open_api_failed',
  'adapter_yahoo_finance_failed',
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
  'kospiIntraday',
  'historicalMondayDownRate',
  'recentMomentum',
  'kospi200',
  'kospi200Intraday',
  'usdKrwIntraday',
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
  'vix',
  'usEquity',
  'us10y',
  'bokBaseRate',
  'usdKrw',
  'ktb3y',
  'kisFutures',
]);

const SNAPSHOT_FIELD_NAME_SET = new Set(SNAPSHOT_FIELD_NAMES);
const ALLOWED_FRESHNESS = new Set(Object.values(FRESHNESS));

const ADAPTER_VALUE_SCHEMA = Object.freeze({
  historicalMondayDownRate: { type: 'number', min: 0, max: 1 },
  recentMomentum: { type: 'number' },
  lastDailyChangePct: { type: 'number' },
  volatilityZScore: { type: 'number' },
  vixLevel: { type: 'number' },
  usEquityChangePct: { type: 'number' },
  us10yYield: { type: 'number' },
  bokBaseRate: { type: 'number' },
  usdKrwRate: { type: 'number' },
  ktb3yYield: { type: 'number' },
  futuresBasis: { type: 'number' },
  futuresOpenInterest: { type: 'number' },
  futuresVolume: { type: 'number' },
  optionsOpenInterest: { type: 'number' },
  optionsVolume: { type: 'number' },
  putCallRatio: { type: 'number' },
  foreignerNetFutures: { type: 'number' },
  holidayCalendar: { type: 'date-array', minItems: 1, maxItems: 512 },
  marketPulse: { type: 'market-pulse' },
});

const MARKET_PULSE_INSTRUMENT_KEYS = new Set(['kospi', 'kospi200', 'usdKrw', 'kospi200Futures']);

function normalizeMarketPulseInstrument(value) {
  if (!isRecord(value) || !MARKET_PULSE_INSTRUMENT_KEYS.has(value.key)) return null;
  const bars = Array.isArray(value.bars)
    ? value.bars.slice(-400).flatMap((bar) => {
      if (!isRecord(bar)) return [];
      const time = safeObservedAt(bar.time, null);
      const close = typeof bar.close === 'number' && Number.isFinite(bar.close) ? bar.close : null;
      const volume = typeof bar.volume === 'number' && Number.isFinite(bar.volume) && bar.volume >= 0 ? bar.volume : null;
      return time && close != null ? [{ time, close, volume }] : [];
    })
    : [];
  const normalized = {
    key: value.key,
    label: sanitizePublicAdapterText(value.label, value.key),
    symbol: sanitizePublicAdapterText(value.symbol, value.key),
    role: sanitizePublicAdapterText(value.role, 'market-proxy'),
    observedAt: safeObservedAt(value.observedAt, null),
    last: Number.isFinite(value.last) ? value.last : null,
    previousClose: Number.isFinite(value.previousClose) ? value.previousClose : null,
    changePct: Number.isFinite(value.changePct) ? value.changePct : null,
    momentum5mPct: Number.isFinite(value.momentum5mPct) ? value.momentum5mPct : null,
    momentum20mPct: Number.isFinite(value.momentum20mPct) ? value.momentum20mPct : null,
    rangePct: Number.isFinite(value.rangePct) ? value.rangePct : null,
    bars,
  };
  return normalized.last == null && bars.length === 0 ? null : normalized;
}

function normalizeMarketPulseValue(value) {
  if (!isRecord(value)) return undefined;
  const instruments = Array.isArray(value.instruments)
    ? value.instruments.map(normalizeMarketPulseInstrument).filter(Boolean)
    : [];
  if (instruments.length === 0) return undefined;
  return {
    status: normalizeFreshness(value.status, FRESHNESS.UNAVAILABLE),
    source: sanitizePublicAdapterText(value.source, 'yahoo-finance-proxy'),
    label: sanitizePublicAdapterText(value.label, 'Unofficial delayed market proxy; not KOSPI200 futures.'),
    observedAt: safeObservedAt(value.observedAt, null),
    primaryKey: MARKET_PULSE_INSTRUMENT_KEYS.has(value.primaryKey) ? value.primaryKey : instruments[0].key,
    instruments,
  };
}

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
    if (schema.type === 'market-pulse') {
      const marketPulse = normalizeMarketPulseValue(value);
      if (marketPulse) normalized[key] = marketPulse;
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
          lastDailyChangePct: -0.92,
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

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
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

function appendQueryParams(url, params = {}) {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    parsed.searchParams.set(key, String(value));
  }
  return parsed.href;
}

function normalizeDateKey(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const key = digits.length === 8
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : raw.slice(0, 10);
  const parsed = new Date(`${key}T00:00:00Z`);
  if (!DATE_KEY_PATTERN.test(key) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== key) return null;
  return key;
}

function parseNumberLike(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'nan') return null;
  const normalized = trimmed.replace(/,/g, '').replace(/%$/, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactKey(key) {
  return String(key ?? '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
}

function valueByAliases(row, aliases) {
  if (!isRecord(row)) return null;
  const direct = aliases.find((alias) => row[alias] != null);
  if (direct) return row[direct];
  const compactAliases = aliases.map(compactKey);
  for (const [key, value] of Object.entries(row)) {
    if (compactAliases.includes(compactKey(key))) return value;
  }
  return null;
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  const arrays = [];
  const visit = (value, depth = 0) => {
    if (depth > 4 || value == null) return;
    if (Array.isArray(value)) {
      const rows = value.filter(isRecord);
      if (rows.length) arrays.push(rows);
      return;
    }
    if (isRecord(value)) {
      for (const child of Object.values(value)) visit(child, depth + 1);
    }
  };
  visit(payload);
  arrays.sort((a, b) => b.length - a.length);
  return arrays[0] ?? [];
}

const DATE_ALIASES = ['TRD_DD', 'BAS_DD', 'basDd', 'trdDd', 'date', 'tradeDate', '일자', '기준일'];
const CLOSE_ALIASES = ['CLSPRC_IDX', 'IDX_CLSPRC', 'CLSPRC', 'close', 'closePrice', '종가', '지수종가'];
const FUTURES_PRICE_ALIASES = ['CLSPRC', 'SETL_PRC', 'close', 'settlementPrice', '종가', '정산가격'];
const OPEN_INTEREST_ALIASES = ['OPN_INT_QTY', 'OPEN_INTEREST', 'openInterest', '미결제약정', '미결제약정수량'];
const VOLUME_ALIASES = ['ACC_TRDVOL', 'TRD_QTY', 'volume', 'tradingVolume', '거래량'];
const INVESTOR_ALIASES = ['INVST_TP_NM', 'INVESTOR_NM', 'investorType', '투자자구분', '투자자'];
const NET_FLOW_ALIASES = ['NET_BUY_QTY', 'NET_TRD_QTY', 'netFlow', '순매매' + '수량', '순거래량'];
const OPTION_SIDE_ALIASES = ['RGHT_TP_NM', 'PUT_CALL', 'optionType', 'cp', '권리구분', '콜풋구분'];

function buildDailySeries(rows) {
  return rows
    .map((row) => ({
      date: normalizeDateKey(valueByAliases(row, DATE_ALIASES)),
      close: parseNumberLike(valueByAliases(row, CLOSE_ALIASES)),
    }))
    .filter((row) => row.date && Number.isFinite(row.close))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function mondayDownRate(series) {
  let mondayCount = 0;
  let downCount = 0;
  for (let index = 1; index < series.length; index += 1) {
    const row = series[index];
    const previous = series[index - 1];
    const day = new Date(`${row.date}T00:00:00Z`).getUTCDay();
    if (day !== 1) continue;
    mondayCount += 1;
    if (row.close < previous.close) downCount += 1;
  }
  return mondayCount > 0 ? downCount / mondayCount : null;
}

function recentMomentum(series, lookback = 5) {
  if (series.length < 2) return null;
  const last = series.at(-1);
  const prior = series[Math.max(0, series.length - 1 - lookback)];
  if (!Number.isFinite(last.close) || !Number.isFinite(prior.close) || prior.close === 0) return null;
  return last.close / prior.close - 1;
}

function volatilityZScore(series) {
  if (series.length < 4) return null;
  const returns = [];
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1].close;
    const current = series[index].close;
    if (previous > 0 && Number.isFinite(current)) returns.push(Math.abs(current / previous - 1));
  }
  if (returns.length < 3) return null;
  const last = returns.at(-1);
  const history = returns.slice(0, -1);
  const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
  const variance = history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / history.length;
  const std = Math.sqrt(variance);
  return std > 0 ? (last - mean) / std : 0;
}

function sumRows(rows, aliases) {
  return rows.reduce((sum, row) => {
    const value = parseNumberLike(valueByAliases(row, aliases));
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function firstNumeric(rows, aliases) {
  for (const row of rows) {
    const value = parseNumberLike(valueByAliases(row, aliases));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function optionSide(row) {
  const raw = String(valueByAliases(row, OPTION_SIDE_ALIASES) ?? '').toLowerCase();
  if (raw.includes('put') || raw.includes('풋') || raw === 'p') return 'put';
  if (raw.includes('call') || raw.includes('콜') || raw === 'c') return 'call';
  return null;
}

function putCallRatio(rows) {
  let putVolume = 0;
  let callVolume = 0;
  for (const row of rows) {
    const volume = parseNumberLike(valueByAliases(row, VOLUME_ALIASES));
    if (!Number.isFinite(volume)) continue;
    const side = optionSide(row);
    if (side === 'put') putVolume += volume;
    if (side === 'call') callVolume += volume;
  }
  return callVolume > 0 ? putVolume / callVolume : null;
}

function foreignerNetFutures(rows) {
  for (const row of rows) {
    const investor = String(valueByAliases(row, INVESTOR_ALIASES) ?? '').toLowerCase();
    if (!investor.includes('foreign') && !investor.includes('외국')) continue;
    const value = parseNumberLike(valueByAliases(row, NET_FLOW_ALIASES));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function holidayDates(rows) {
  const dates = rows
    .map((row) => normalizeDateKey(valueByAliases(row, DATE_ALIASES)))
    .filter(Boolean);
  return [...new Set(dates)];
}

async function fetchKrxJsonEndpoint({ url, apiKey, authHeaderName, params, fetchImpl, timeoutMs, maxBodyBytes }) {
  const endpointUrl = appendQueryParams(url, params);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(endpointUrl, {
      headers: {
        [authHeaderName]: apiKey,
        accept: 'application/json',
      },
      signal: controller?.signal,
    });
    if (!response?.ok) throw new Error('adapter_krx_http_status_error');
    const text = await readResponseText(response, maxBodyBytes);
    return JSON.parse(text);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function markField(fields, name, { source, observedAt, freshness = FRESHNESS.FRESH, details = null }) {
  fields[name] = { source, observedAt, freshness, details };
}

function krxUnavailableSnapshot({ source, observedAt, message, freshness = FRESHNESS.UNAVAILABLE, error = null, capabilities = {} }) {
  return normalizeAdapterResult({
    source,
    observedAt,
    freshness,
    error,
    message,
    capabilities,
    fields: unavailableFields(source, observedAt, { freshness, details: message }),
    values: {},
  });
}

function yahooChartUrl(symbol, { range, interval }) {
  const encoded = encodeURIComponent(symbol);
  return appendQueryParams(`https://query1.finance.yahoo.com/v8/finance/chart/${encoded}`, { range, interval });
}

async function fetchYahooChart({ symbol, range, interval, fetchImpl, timeoutMs, maxBodyBytes }) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(yahooChartUrl(symbol, { range, interval }), {
      headers: { accept: 'application/json', 'user-agent': 'kospi-risk-watch/0.1 observation-only' },
      signal: controller?.signal,
    });
    if (!response?.ok) throw new Error('adapter_yahoo_http_status_error');
    const text = await readResponseText(response, maxBodyBytes);
    const payload = JSON.parse(text);
    const result = payload?.chart?.result?.[0];
    if (!isRecord(result)) throw new Error('adapter_yahoo_chart_result_missing');
    return result;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function yahooCloseSeries(result) {
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const closes = quote.close;
  if (!Array.isArray(closes)) return [];
  const volumes = Array.isArray(quote.volume) ? quote.volume : [];
  return timestamps
    .map((timestamp, index) => {
      const close = closes[index];
      if (!Number.isFinite(timestamp) || !Number.isFinite(close)) return null;
      const volume = Number.isFinite(volumes[index]) ? volumes[index] : null;
      return { time: new Date(timestamp * 1000).toISOString(), close, volume };
    })
    .filter(Boolean);
}

function yahooDailySeries(result) {
  return yahooCloseSeries(result)
    .map((row) => ({ date: row.time.slice(0, 10), close: row.close }))
    .filter((row) => row.date && Number.isFinite(row.close))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function pctChange(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) && previous !== 0
    ? (current / previous - 1) * 100
    : null;
}

function momentumPct(bars, lookback) {
  if (bars.length < 2) return null;
  const last = bars.at(-1);
  const prior = bars[Math.max(0, bars.length - 1 - lookback)];
  return pctChange(last?.close, prior?.close);
}

function rangePct(bars, reference) {
  if (!Number.isFinite(reference) || reference === 0 || bars.length === 0) return null;
  const closes = bars.map((bar) => bar.close).filter(Number.isFinite);
  if (closes.length === 0) return null;
  return ((Math.max(...closes) - Math.min(...closes)) / reference) * 100;
}

function roundMetric(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function yahooInstrumentFromResult({ key, label, symbol, role, result }) {
  const allBars = yahooCloseSeries(result);
  const bars = allBars.slice(-400);
  const last = bars.at(-1)?.close ?? result?.meta?.regularMarketPrice ?? null;
  const previousClose = result?.meta?.chartPreviousClose ?? result?.meta?.previousClose ?? null;
  return {
    key,
    label,
    symbol,
    role,
    observedAt: bars.at(-1)?.time ?? null,
    last: Number.isFinite(last) ? last : null,
    previousClose: Number.isFinite(previousClose) ? previousClose : null,
    changePct: roundMetric(pctChange(last, previousClose)),
    momentum5mPct: roundMetric(momentumPct(bars, 5)),
    momentum20mPct: roundMetric(momentumPct(bars, 20)),
    rangePct: roundMetric(rangePct(bars, previousClose)),
    bars,
  };
}

function yahooErrorSnapshot({ source, observedAt, capabilities }) {
  return normalizeAdapterResult({
    source,
    observedAt,
    freshness: FRESHNESS.ERROR,
    error: 'adapter_yahoo_finance_failed',
    message: 'Yahoo Finance proxy data could not be polled; details are hidden from the public dashboard.',
    capabilities,
    fields: unavailableFields(source, observedAt, {
      freshness: FRESHNESS.ERROR,
      details: 'Yahoo Finance proxy polling failed.',
    }),
    values: {},
  });
}

export function createYahooFinanceMarketDataAdapter({
  source = 'yahoo-finance-proxy',
  symbols = {},
  intradayRange = '1d',
  dailyRange = '6mo',
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
  maxBodyBytes = 768 * 1024,
} = {}) {
  const configuredSymbols = {
    kospi: symbols.kospi || '^KS11',
    kospi200: symbols.kospi200 || '^KS200',
    usdKrw: symbols.usdKrw || 'KRW=X',
  };
  const capabilities = {
    liveMarketData: false,
    approvedPublic: false,
    readinessAllowed: false,
    sourceApproval: 'yahoo-finance-proxy',
    license: 'unapproved',
  };

  return {
    source,
    async getSnapshot() {
      const observedAt = new Date().toISOString();
      if (typeof fetchImpl !== 'function') return yahooErrorSnapshot({ source, observedAt, capabilities });

      const requests = {
        kospiDaily: fetchYahooChart({ symbol: configuredSymbols.kospi, range: dailyRange, interval: '1d', fetchImpl, timeoutMs, maxBodyBytes }),
        kospiIntraday: fetchYahooChart({ symbol: configuredSymbols.kospi, range: intradayRange, interval: '1m', fetchImpl, timeoutMs, maxBodyBytes }),
        kospi200Intraday: fetchYahooChart({ symbol: configuredSymbols.kospi200, range: intradayRange, interval: '1m', fetchImpl, timeoutMs, maxBodyBytes }),
        usdKrwIntraday: fetchYahooChart({ symbol: configuredSymbols.usdKrw, range: intradayRange, interval: '1m', fetchImpl, timeoutMs, maxBodyBytes }),
      };
      const entries = await Promise.all(Object.entries(requests).map(async ([key, request]) => {
        try {
          return [key, await request];
        } catch {
          return [key, null];
        }
      }));
      const results = Object.fromEntries(entries);
      const successfulResults = Object.values(results).filter(Boolean);
      if (successfulResults.length === 0) return yahooErrorSnapshot({ source, observedAt, capabilities });

      const fields = unavailableFields(source, observedAt, {
        freshness: FRESHNESS.UNAVAILABLE,
        details: 'Yahoo Finance proxy does not provide this KRX derivatives metric.',
      });
      const values = {};

      const kospiSeries = yahooDailySeries(results.kospiDaily);
      if (kospiSeries.length >= 2) {
        markField(fields, 'kospiDaily', { source, observedAt, details: 'Yahoo Finance KOSPI daily proxy; unofficial and not exchange-approved.' });
        const baseline = mondayDownRate(kospiSeries);
        if (Number.isFinite(baseline)) {
          values.historicalMondayDownRate = baseline;
          markField(fields, 'historicalMondayDownRate', { source, observedAt, details: 'Computed from Yahoo Finance KOSPI daily proxy Monday closes.' });
        }
        const momentum = recentMomentum(kospiSeries);
        if (Number.isFinite(momentum)) {
          values.recentMomentum = momentum;
          markField(fields, 'recentMomentum', { source, observedAt, details: 'Computed from recent Yahoo Finance KOSPI daily proxy closes.' });
        }
        const volZ = volatilityZScore(kospiSeries);
        if (Number.isFinite(volZ)) {
          values.volatilityZScore = volZ;
          markField(fields, 'volatility', { source, observedAt, details: 'Computed from Yahoo Finance KOSPI daily proxy return volatility.' });
        }
        const dailyChange = pctChange(kospiSeries.at(-1)?.close, kospiSeries.at(-2)?.close);
        if (Number.isFinite(dailyChange)) values.lastDailyChangePct = roundMetric(dailyChange, 4);
      }

      const instruments = [];
      if (results.kospiIntraday) {
        const instrument = yahooInstrumentFromResult({
          key: 'kospi',
          label: 'KOSPI 지수',
          symbol: configuredSymbols.kospi,
          role: 'downside-probability-input',
          result: results.kospiIntraday,
        });
        instruments.push(instrument);
        markField(fields, 'kospiIntraday', { source, observedAt: instrument.observedAt ?? observedAt, details: 'Yahoo Finance 1-minute KOSPI proxy.' });
      }
      if (results.kospi200Intraday) {
        const instrument = yahooInstrumentFromResult({
          key: 'kospi200',
          label: 'KOSPI200 지수 프록시',
          symbol: configuredSymbols.kospi200,
          role: 'index-proxy-not-futures',
          result: results.kospi200Intraday,
        });
        instruments.push(instrument);
        markField(fields, 'kospi200', { source, observedAt: instrument.observedAt ?? observedAt, details: 'Yahoo Finance KOSPI200 index proxy; not KOSPI200 futures.' });
        markField(fields, 'kospi200Intraday', { source, observedAt: instrument.observedAt ?? observedAt, details: 'Yahoo Finance 1-minute KOSPI200 index proxy; not KOSPI200 futures.' });
      }
      if (results.usdKrwIntraday) {
        const instrument = yahooInstrumentFromResult({
          key: 'usdKrw',
          label: 'USD/KRW',
          symbol: configuredSymbols.usdKrw,
          role: 'macro-fx-context',
          result: results.usdKrwIntraday,
        });
        instruments.push(instrument);
        markField(fields, 'usdKrwIntraday', { source, observedAt: instrument.observedAt ?? observedAt, details: 'Yahoo Finance 1-minute USD/KRW proxy.' });
      }

      if (instruments.length > 0) {
        values.marketPulse = {
          status: FRESHNESS.FRESH,
          source,
          label: 'Yahoo Finance 1-minute proxy; KOSPI200 is an index proxy, not KOSPI200 futures.',
          observedAt: instruments.find((instrument) => instrument.key === 'kospi200')?.observedAt ?? instruments[0].observedAt ?? observedAt,
          primaryKey: instruments.some((instrument) => instrument.key === 'kospi200') ? 'kospi200' : instruments[0].key,
          instruments,
        };
      }

      markField(fields, 'derivativesCalendar', { source: 'krx-calendar-rules', observedAt, details: 'Rule-based KOSPI200 expiry calendar is available.' });
      const freshness = fields.kospiDaily?.freshness === FRESHNESS.FRESH || instruments.length > 0 ? FRESHNESS.FRESH : FRESHNESS.UNAVAILABLE;
      return normalizeAdapterResult({
        source,
        observedAt,
        freshness,
        message: 'Yahoo Finance proxy was polled for KOSPI/KOSPI200 observation; derivatives/OI/short-selling metrics remain unavailable.',
        capabilities,
        fields,
        values,
      });
    },
  };
}

export function createKrxOpenApiMarketDataAdapter({
  apiKey,
  endpoints = {},
  endpointParams = {},
  commonParams = { reqType: 'json' },
  source = 'krx-open-api',
  authHeaderName = 'AUTH_KEY',
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
  maxBodyBytes = 512 * 1024,
  capabilities = {},
} = {}) {
  if (!apiKey) return createUnavailableAdapter('krx-open-api-unconfigured-key');
  const configuredEntries = Object.entries(endpoints).filter(([, url]) => typeof url === 'string' && url.trim());
  if (configuredEntries.length === 0) {
    return createUnavailableAdapter('krx-open-api-unconfigured-endpoints');
  }
  return {
    source,
    async getSnapshot() {
      const observedAt = new Date().toISOString();
      if (typeof fetchImpl !== 'function') {
        return krxUnavailableSnapshot({
          source,
          observedAt,
          freshness: FRESHNESS.ERROR,
          error: 'adapter_krx_open_api_failed',
          message: 'KRX OPEN API source cannot be fetched in this runtime.',
          capabilities: { sourceApproval: 'error' },
        });
      }
      const payloads = {};
      const failed = [];
      await Promise.all(configuredEntries.map(async ([key, url]) => {
        try {
          payloads[key] = await fetchKrxJsonEndpoint({
            url,
            apiKey,
            authHeaderName,
            params: { ...commonParams, ...(endpointParams[key] ?? {}) },
            fetchImpl,
            timeoutMs,
            maxBodyBytes,
          });
        } catch {
          failed.push(key);
        }
      }));

      if (Object.keys(payloads).length === 0) {
        return krxUnavailableSnapshot({
          source,
          observedAt,
          freshness: FRESHNESS.ERROR,
          error: 'adapter_krx_open_api_failed',
          message: 'Configured KRX OPEN API endpoints could not be polled; details are hidden from the public dashboard.',
          capabilities: { sourceApproval: 'error' },
        });
      }

      const fields = unavailableFields(source, observedAt, {
        freshness: FRESHNESS.UNAVAILABLE,
        details: 'KRX OPEN API endpoint did not provide this normalized field.',
      });
      const values = {};
      const kospiRows = extractRows(payloads.kospiDaily);
      const kospiSeries = buildDailySeries(kospiRows);
      if (kospiSeries.length >= 2) {
        markField(fields, 'kospiDaily', { source, observedAt, details: 'Derived from configured KRX KOSPI daily endpoint.' });
        const baseline = mondayDownRate(kospiSeries);
        if (Number.isFinite(baseline)) {
          values.historicalMondayDownRate = baseline;
          markField(fields, 'historicalMondayDownRate', { source, observedAt, details: 'Computed from Monday KOSPI closes in the configured KRX daily endpoint.' });
        }
        const momentum = recentMomentum(kospiSeries);
        if (Number.isFinite(momentum)) {
          values.recentMomentum = momentum;
          markField(fields, 'recentMomentum', { source, observedAt, details: 'Computed from recent KOSPI closes in the configured KRX daily endpoint.' });
        }
        const volZ = volatilityZScore(kospiSeries);
        if (Number.isFinite(volZ)) {
          values.volatilityZScore = volZ;
          markField(fields, 'volatility', { source, observedAt, details: 'Computed from recent KOSPI return volatility in the configured KRX daily endpoint.' });
        }
        const dailyChange = pctChange(kospiSeries.at(-1)?.close, kospiSeries.at(-2)?.close);
        if (Number.isFinite(dailyChange)) values.lastDailyChangePct = roundMetric(dailyChange, 4);
      }

      const kospi200Series = buildDailySeries(extractRows(payloads.kospi200Daily));
      const kospi200Spot = kospi200Series.at(-1)?.close ?? null;
      if (Number.isFinite(kospi200Spot)) {
        markField(fields, 'kospi200', { source, observedAt, details: 'Latest KOSPI200 spot/index reference from configured KRX endpoint.' });
      }

      const futuresRows = extractRows(payloads.futures);
      const futuresOpenInterest = sumRows(futuresRows, OPEN_INTEREST_ALIASES);
      const futuresVolume = sumRows(futuresRows, VOLUME_ALIASES);
      const futuresPrice = firstNumeric(futuresRows, FUTURES_PRICE_ALIASES);
      if (futuresOpenInterest > 0) {
        values.futuresOpenInterest = futuresOpenInterest;
        markField(fields, 'futuresOpenInterest', { source, observedAt, details: 'Summed from configured KRX futures endpoint rows.' });
      }
      if (futuresVolume > 0) {
        values.futuresVolume = futuresVolume;
        markField(fields, 'futuresVolume', { source, observedAt, details: 'Summed from configured KRX futures endpoint rows.' });
      }
      if (Number.isFinite(futuresPrice) && Number.isFinite(kospi200Spot)) {
        values.futuresBasis = futuresPrice - kospi200Spot;
        markField(fields, 'futuresBasis', { source, observedAt, details: 'Nearest configured futures price minus KOSPI200 spot/index reference.' });
      }

      const optionsRows = extractRows(payloads.options);
      const optionsOpenInterest = sumRows(optionsRows, OPEN_INTEREST_ALIASES);
      const optionsVolume = sumRows(optionsRows, VOLUME_ALIASES);
      const ratio = putCallRatio(optionsRows);
      if (optionsOpenInterest > 0) {
        values.optionsOpenInterest = optionsOpenInterest;
        markField(fields, 'optionsOpenInterest', { source, observedAt, details: 'Summed from configured KRX options endpoint rows.' });
      }
      if (optionsVolume > 0) {
        values.optionsVolume = optionsVolume;
        markField(fields, 'optionsVolume', { source, observedAt, details: 'Summed from configured KRX options endpoint rows.' });
      }
      if (Number.isFinite(ratio)) {
        values.putCallRatio = ratio;
        markField(fields, 'putCallRatio', { source, observedAt, details: 'Computed from configured KRX options endpoint side and volume rows.' });
      }

      const flow = foreignerNetFutures(extractRows(payloads.investorFlow));
      if (Number.isFinite(flow)) {
        values.foreignerNetFutures = flow;
        markField(fields, 'foreignerNetFutures', { source, observedAt, details: 'Parsed from configured KRX futures investor-flow endpoint.' });
      }

      const holidays = holidayDates(extractRows(payloads.holidayCalendar));
      if (holidays.length > 0) {
        values.holidayCalendar = holidays;
        markField(fields, 'holidayCalendar', { source, observedAt, details: 'Parsed from configured KRX holiday calendar endpoint.' });
      }

      markField(fields, 'derivativesCalendar', { source: 'krx-calendar-rules', observedAt, details: 'Rule-based KOSPI200 expiry calendar is available.' });
      const producedFreshFields = Object.values(fields).filter((field) => field.freshness === FRESHNESS.FRESH).length;
      const freshness = producedFreshFields > 1 ? FRESHNESS.FRESH : FRESHNESS.UNAVAILABLE;
      return normalizeAdapterResult({
        source,
        observedAt,
        freshness,
        error: failed.length === configuredEntries.length ? 'adapter_krx_open_api_failed' : null,
        message: failed.length
          ? 'Configured KRX OPEN API source returned partial data; unavailable fields remain explicit.'
          : 'Configured KRX OPEN API source was polled and normalized.',
        capabilities,
        fields,
        values,
      });
    },
  };
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

function macroProvidersFromEnv(env) {
  const timeoutMs = parsePositiveNumber(env.MACRO_TIMEOUT_MS, 5_000);
  const providers = [];
  const fred = createFredMacroProvider({
    apiKey: env.FRED_API_KEY,
    series: { vix: env.FRED_VIX_SERIES, usEquity: env.FRED_US_EQUITY_SERIES, us10y: env.FRED_US10Y_SERIES },
    timeoutMs,
  });
  if (fred) providers.push(fred);
  const ecos = createEcosMacroProvider({
    apiKey: env.ECOS_API_KEY,
    stats: {
      bokBaseRate: parseJsonObject(env.ECOS_BASE_RATE_JSON, null) ?? undefined,
      usdKrwRate: parseJsonObject(env.ECOS_USDKRW_JSON, null) ?? undefined,
      ktb3yYield: parseJsonObject(env.ECOS_KTB3Y_JSON, null) ?? undefined,
    },
    timeoutMs,
  });
  if (ecos) providers.push(ecos);
  const kis = createKisFuturesProvider({
    appKey: env.KIS_APP_KEY,
    appSecret: env.KIS_APP_SECRET,
    futuresCode: env.KIS_FUTURES_CODE,
    baseUrl: env.KIS_BASE_URL || undefined,
    minutesTrId: env.KIS_MINUTES_TR_ID || undefined,
    priceTrId: env.KIS_PRICE_TR_ID || undefined,
    custType: env.KIS_CUST_TYPE || undefined,
    minutesParams: parseJsonObject(env.KIS_MINUTES_PARAMS_JSON),
    priceParams: parseJsonObject(env.KIS_PRICE_PARAMS_JSON),
    timeoutMs,
  });
  if (kis) providers.push(kis);
  return providers;
}

function withMacro(base, env) {
  const providers = macroProvidersFromEnv(env);
  return providers.length ? createCompositeMarketDataAdapter({ base, providers }) : base;
}

export function createAdapterFromEnv(env = process.env) {
  if (env.MARKET_DATA_ADAPTER === 'mock') return createMockMarketDataAdapter();
  if (env.MARKET_DATA_ADAPTER === 'mock-stale') return createMockMarketDataAdapter({ stale: true });
  if (env.MARKET_DATA_ADAPTER === 'mock-error') return createMockMarketDataAdapter({ fail: true });
  if (env.MARKET_DATA_ADAPTER === 'yahoo-finance') {
    return withMacro(createYahooFinanceMarketDataAdapter({
      source: env.MARKET_DATA_SOURCE || 'yahoo-finance-proxy',
      symbols: {
        kospi: env.YAHOO_FINANCE_KOSPI_SYMBOL || '^KS11',
        kospi200: env.YAHOO_FINANCE_KOSPI200_SYMBOL || '^KS200',
        usdKrw: env.YAHOO_FINANCE_USDKRW_SYMBOL || 'KRW=X',
      },
      intradayRange: env.YAHOO_FINANCE_INTRADAY_RANGE || '1d',
      dailyRange: env.YAHOO_FINANCE_DAILY_RANGE || '6mo',
      timeoutMs: parsePositiveNumber(env.YAHOO_FINANCE_TIMEOUT_MS, parsePositiveNumber(env.MARKET_DATA_TIMEOUT_MS, 5_000)),
      maxBodyBytes: parsePositiveNumber(env.YAHOO_FINANCE_MAX_BODY_BYTES, parsePositiveNumber(env.MARKET_DATA_MAX_BODY_BYTES, 768 * 1024)),
    }), env);
  }
  if (env.MARKET_DATA_ADAPTER === 'krx-open-api') {
    return withMacro(createKrxOpenApiMarketDataAdapter({
      apiKey: env.KRX_OPEN_API_KEY,
      source: env.MARKET_DATA_SOURCE || 'krx-open-api',
      authHeaderName: env.KRX_OPEN_API_AUTH_HEADER_NAME || 'AUTH_KEY',
      endpoints: {
        kospiDaily: env.KRX_OPEN_API_KOSPI_DAILY_URL,
        kospi200Daily: env.KRX_OPEN_API_KOSPI200_DAILY_URL,
        futures: env.KRX_OPEN_API_FUTURES_URL,
        options: env.KRX_OPEN_API_OPTIONS_URL,
        investorFlow: env.KRX_OPEN_API_INVESTOR_FLOW_URL,
        holidayCalendar: env.KRX_OPEN_API_HOLIDAY_CALENDAR_URL,
      },
      commonParams: {
        reqType: 'json',
        ...parseJsonObject(env.KRX_OPEN_API_COMMON_PARAMS_JSON),
      },
      endpointParams: {
        kospiDaily: parseJsonObject(env.KRX_OPEN_API_KOSPI_DAILY_PARAMS_JSON),
        kospi200Daily: parseJsonObject(env.KRX_OPEN_API_KOSPI200_DAILY_PARAMS_JSON),
        futures: parseJsonObject(env.KRX_OPEN_API_FUTURES_PARAMS_JSON),
        options: parseJsonObject(env.KRX_OPEN_API_OPTIONS_PARAMS_JSON),
        investorFlow: parseJsonObject(env.KRX_OPEN_API_INVESTOR_FLOW_PARAMS_JSON),
        holidayCalendar: parseJsonObject(env.KRX_OPEN_API_HOLIDAY_CALENDAR_PARAMS_JSON),
      },
      timeoutMs: parsePositiveNumber(env.KRX_OPEN_API_TIMEOUT_MS, parsePositiveNumber(env.MARKET_DATA_TIMEOUT_MS, 5_000)),
      maxBodyBytes: parsePositiveNumber(env.KRX_OPEN_API_MAX_BODY_BYTES, parsePositiveNumber(env.MARKET_DATA_MAX_BODY_BYTES, 512 * 1024)),
      capabilities: {
        liveMarketData: envFlag(env.KRX_OPEN_API_LIVE ?? env.MARKET_DATA_LIVE),
        approvedPublic: envFlag(env.KRX_OPEN_API_APPROVED_PUBLIC ?? env.MARKET_DATA_APPROVED_PUBLIC),
        readinessAllowed: envFlag(env.KRX_OPEN_API_READINESS_ALLOWED ?? env.MARKET_DATA_READINESS_ALLOWED),
        sourceApproval: env.KRX_OPEN_API_SOURCE_APPROVAL ?? env.MARKET_DATA_SOURCE_APPROVAL ?? 'unapproved',
        license: env.KRX_OPEN_API_LICENSE ?? env.MARKET_DATA_LICENSE ?? 'unspecified',
      },
    }), env);
  }
  if (env.MARKET_DATA_ADAPTER === 'json-http') {
    return withMacro(createJsonHttpMarketDataAdapter({
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
    }), env);
  }
  return withMacro(createKrxFreeSourcePlaceholder({ apiKey: env.KRX_OPEN_API_KEY }), env);
}
