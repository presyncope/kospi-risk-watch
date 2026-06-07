import { FRESHNESS, createProvenance } from '../../core/src/index.js';

// Korea Investment & Securities (KIS) OpenAPI futures provider.
// Returns a `kospi200Futures` market-pulse instrument (1-minute bars + last/prev)
// so the chart switches to the real futures series and basis (futures - spot) can
// be derived. Everything fails closed: any error -> no futures instrument, base
// snapshot (spot proxy) is unaffected.
//
// KIS endpoints, TR ids, the front-month futures code, and response field names
// are all env-configurable because they are account/version specific and change
// at each expiry. Defaults are best-effort and may need validation against a live
// KIS account.

function parseNum(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'nan') return null;
  const parsed = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function round4(value) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}

function compactKey(key) {
  return String(key ?? '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
}

function valueByAliases(row, aliases) {
  if (!row || typeof row !== 'object') return null;
  const direct = aliases.find((alias) => row[alias] != null);
  if (direct) return row[direct];
  const compact = aliases.map(compactKey);
  for (const [key, value] of Object.entries(row)) {
    if (compact.includes(compactKey(key))) return value;
  }
  return null;
}

const DATE_ALIASES = ['stck_bsop_date', 'bsop_date', 'trd_dd', 'date'];
const TIME_ALIASES = ['stck_cntg_hour', 'cntg_hour', 'time', 'hour'];
const PRICE_ALIASES = ['futs_prpr', 'stck_prpr', 'prpr', 'futs_oprc', 'close', 'clpr'];
const VOLUME_ALIASES = ['cntg_vol', 'acml_vol', 'futs_otrc_vol', 'volume', 'vol'];
const LAST_ALIASES = ['futs_prpr', 'stck_prpr', 'prpr', 'last'];
const PREV_CLOSE_ALIASES = ['futs_prdy_clpr', 'stck_prdy_clpr', 'prdy_clpr', 'futs_prdy_setl', 'prdy_setl', 'prev_close'];

function appendParams(url, params = {}) {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    parsed.searchParams.set(key, String(value));
  }
  return parsed.href;
}

// KIS minute rows carry KST date (YYYYMMDD) + time (HHMMSS); convert to an absolute ISO.
function kisBarTime(dateRaw, timeRaw) {
  const date = String(dateRaw ?? '').replace(/\D/g, '');
  const time = String(timeRaw ?? '').replace(/\D/g, '').padStart(6, '0');
  if (date.length !== 8) return null;
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+09:00`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function pctChange(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) && previous !== 0 ? (current / previous - 1) * 100 : null;
}

function momentumPct(bars, lookback) {
  if (bars.length < 2) return null;
  return pctChange(bars.at(-1)?.close, bars[Math.max(0, bars.length - 1 - lookback)]?.close);
}

function rangePct(bars, reference) {
  if (!Number.isFinite(reference) || reference === 0 || bars.length === 0) return null;
  const closes = bars.map((bar) => bar.close).filter(Number.isFinite);
  if (closes.length === 0) return null;
  return ((Math.max(...closes) - Math.min(...closes)) / reference) * 100;
}

function extractRows(payload, preferredKeys = ['output2', 'output1', 'output']) {
  if (!payload || typeof payload !== 'object') return [];
  for (const key of preferredKeys) {
    if (Array.isArray(payload[key])) return payload[key].filter((row) => row && typeof row === 'object');
  }
  // fallback: first array of records
  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.some((row) => row && typeof row === 'object')) return value.filter((row) => row && typeof row === 'object');
  }
  return [];
}

function firstRecord(payload, preferredKeys = ['output', 'output1', 'output2']) {
  if (!payload || typeof payload !== 'object') return {};
  for (const key of preferredKeys) {
    if (payload[key] && typeof payload[key] === 'object' && !Array.isArray(payload[key])) return payload[key];
    if (Array.isArray(payload[key]) && payload[key][0]) return payload[key][0];
  }
  return {};
}

export function createKisFuturesProvider({
  appKey,
  appSecret,
  futuresCode,
  baseUrl = 'https://openapi.koreainvestment.com:9443',
  minutesPath = '/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice',
  pricePath = '/uapi/domestic-futureoption/v1/quotations/inquire-price',
  minutesTrId = 'FHKIF03020200',
  priceTrId = 'FHMIF10000000',
  custType = 'P',
  minutesParams = {},
  priceParams = {},
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
  maxBodyBytes = 512 * 1024,
} = {}) {
  if (!appKey || !appSecret || !futuresCode || typeof fetchImpl !== 'function') return null;

  let cachedToken = null;
  let tokenExpiryMs = 0;

  const readText = async (response) => {
    const text = typeof response.text === 'function' ? await response.text() : '';
    if (Buffer.byteLength(text, 'utf8') > maxBodyBytes) throw new Error('kis_body_too_large');
    return text;
  };

  const withTimeout = async (run) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      return await run(controller?.signal);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const getToken = async () => {
    const now = Date.now();
    if (cachedToken && now < tokenExpiryMs - 60_000) return cachedToken;
    const payload = await withTimeout(async (signal) => {
      const response = await fetchImpl(`${baseUrl}/oauth2/tokenP`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret }),
        signal,
      });
      if (!response?.ok) throw new Error('kis_token_status_error');
      return JSON.parse(await readText(response));
    });
    cachedToken = payload?.access_token;
    if (!cachedToken) throw new Error('kis_token_missing');
    tokenExpiryMs = now + (parseNum(payload?.expires_in) ?? 3600) * 1000;
    return cachedToken;
  };

  const kisGet = async (path, params, trId) => {
    const token = await getToken();
    return withTimeout(async (signal) => {
      const response = await fetchImpl(appendParams(`${baseUrl}${path}`, params), {
        headers: {
          authorization: `Bearer ${token}`,
          appkey: appKey,
          appsecret: appSecret,
          tr_id: trId,
          custtype: custType,
          'content-type': 'application/json',
        },
        signal,
      });
      if (!response?.ok) throw new Error('kis_request_status_error');
      return JSON.parse(await readText(response));
    });
  };

  return async function getKisFutures() {
    try {
      const observedAt = new Date().toISOString();
      const minutesPayload = await kisGet(minutesPath, { FID_COND_MRKT_DIV_CODE: 'F', FID_INPUT_ISCD: futuresCode, FID_HOUR_CLS_CODE: '60', FID_PW_DATA_INCU_YN: 'Y', ...minutesParams }, minutesTrId);
      const bars = extractRows(minutesPayload)
        .flatMap((row) => {
          const time = kisBarTime(valueByAliases(row, DATE_ALIASES), valueByAliases(row, TIME_ALIASES));
          const close = parseNum(valueByAliases(row, PRICE_ALIASES));
          if (!time || close == null) return [];
          const volume = parseNum(valueByAliases(row, VOLUME_ALIASES));
          return [{ time, close, volume: Number.isFinite(volume) ? volume : null }];
        })
        .sort((a, b) => a.time.localeCompare(b.time))
        .slice(-400);
      if (bars.length === 0) return { marketPulseInstruments: [], values: {}, fields: {} };

      let last = bars.at(-1).close;
      let previousClose = null;
      try {
        const pricePayload = await kisGet(pricePath, { FID_COND_MRKT_DIV_CODE: 'F', FID_INPUT_ISCD: futuresCode, ...priceParams }, priceTrId);
        const priceRow = firstRecord(pricePayload);
        const livePrice = parseNum(valueByAliases(priceRow, LAST_ALIASES));
        const prev = parseNum(valueByAliases(priceRow, PREV_CLOSE_ALIASES));
        if (Number.isFinite(livePrice)) last = livePrice;
        if (Number.isFinite(prev)) previousClose = prev;
      } catch { /* price is optional; minutes suffice */ }

      const instrument = {
        key: 'kospi200Futures',
        label: 'KOSPI200 선물',
        symbol: futuresCode,
        role: 'futures',
        observedAt: bars.at(-1).time,
        last,
        previousClose,
        changePct: round4(pctChange(last, previousClose)),
        momentum5mPct: round4(momentumPct(bars, 5)),
        momentum20mPct: round4(momentumPct(bars, 20)),
        rangePct: round4(rangePct(bars, previousClose)),
        bars,
      };
      return {
        marketPulseInstruments: [instrument],
        values: {},
        fields: { kisFutures: createProvenance({ source: 'kis', observedAt, freshness: FRESHNESS.FRESH, details: 'KIS KOSPI200 futures 1-minute series.' }) },
      };
    } catch {
      return { marketPulseInstruments: [], values: {}, fields: {} };
    }
  };
}
