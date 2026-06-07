import { FRESHNESS, createProvenance } from '../../core/src/index.js';

// Macro context providers (FRED, ECOS) and a composite adapter that merges
// macro values/fields onto a base market-data snapshot. Everything fails closed:
// a provider that errors or returns nothing simply contributes no macro values,
// and the base snapshot is unaffected.

function parseNumberLike(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === '-' || trimmed.toLowerCase() === 'nan') return null;
  const parsed = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function round4(value) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}

function compact(series = {}) {
  return Object.fromEntries(Object.entries(series).filter(([, value]) => typeof value === 'string' && value.trim()));
}

async function fetchJson({ url, fetchImpl, timeoutMs, maxBodyBytes }) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: controller?.signal });
    if (!response?.ok) throw new Error('macro_http_status_error');
    const text = typeof response.text === 'function' ? await response.text() : '';
    if (Buffer.byteLength(text, 'utf8') > maxBodyBytes) throw new Error('macro_body_too_large');
    return JSON.parse(text);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const FRED_DEFAULT_SERIES = Object.freeze({ vix: 'VIXCLS', usEquity: 'SP500', us10y: 'DGS10' });

export function createFredMacroProvider({
  apiKey,
  series = {},
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
  maxBodyBytes = 256 * 1024,
  baseUrl = 'https://api.stlouisfed.org/fred/series/observations',
} = {}) {
  if (!apiKey || typeof fetchImpl !== 'function') return null;
  const ids = { ...FRED_DEFAULT_SERIES, ...compact(series) };

  const latestObservations = async (seriesId, limit) => {
    const url = `${baseUrl}?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=desc&limit=${limit}`;
    const payload = await fetchJson({ url, fetchImpl, timeoutMs, maxBodyBytes });
    const rows = Array.isArray(payload?.observations) ? payload.observations : [];
    return rows.map((row) => parseNumberLike(row?.value)).filter((value) => value != null);
  };

  return async function getFredMacro() {
    const observedAt = new Date().toISOString();
    const values = {};
    const fields = {};
    const mark = (name, details) => { fields[name] = createProvenance({ source: 'fred', observedAt, freshness: FRESHNESS.FRESH, details }); };

    try {
      const vix = await latestObservations(ids.vix, 1);
      if (vix[0] != null) { values.vixLevel = round4(vix[0]); mark('vix', 'FRED VIX latest close.'); }
    } catch { /* fail closed */ }
    try {
      const equity = await latestObservations(ids.usEquity, 2);
      if (equity.length >= 2 && equity[1] !== 0) {
        values.usEquityChangePct = round4((equity[0] / equity[1] - 1) * 100);
        mark('usEquity', 'FRED US equity index last daily change (Monday-gap proxy).');
      }
    } catch { /* fail closed */ }
    try {
      const yield10y = await latestObservations(ids.us10y, 1);
      if (yield10y[0] != null) { values.us10yYield = round4(yield10y[0]); mark('us10y', 'FRED 10Y Treasury yield.'); }
    } catch { /* fail closed */ }

    return { values, fields };
  };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function ecosPeriod(cycle) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  if (cycle === 'D') {
    const past = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
    return {
      start: `${past.getUTCFullYear()}${pad2(past.getUTCMonth() + 1)}${pad2(past.getUTCDate())}`,
      end: `${year}${pad2(month + 1)}${pad2(day)}`,
    };
  }
  if (cycle === 'M') {
    const past = new Date(Date.UTC(year, month - 3, 1));
    return { start: `${past.getUTCFullYear()}${pad2(past.getUTCMonth() + 1)}`, end: `${year}${pad2(month + 1)}` };
  }
  return { start: `${year - 2}`, end: `${year}` };
}

// ECOS stat codes/items are version-specific; supply them via env. Each stat:
// { statCode, cycle?: 'D'|'M'|'A', item?: string } -> latest finite DATA_VALUE.
export function createEcosMacroProvider({
  apiKey,
  stats = {},
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
  maxBodyBytes = 256 * 1024,
  baseUrl = 'https://ecos.bok.or.kr/api/StatisticSearch',
} = {}) {
  if (!apiKey || typeof fetchImpl !== 'function') return null;
  const wanted = Object.entries(stats).filter(([, spec]) => spec && typeof spec.statCode === 'string' && spec.statCode.trim());
  if (wanted.length === 0) return null;

  const latestValue = async ({ statCode, cycle = 'D', item = '?' }) => {
    const { start, end } = ecosPeriod(cycle);
    const url = `${baseUrl}/${encodeURIComponent(apiKey)}/json/kr/1/100/${encodeURIComponent(statCode)}/${encodeURIComponent(cycle)}/${start}/${end}/${encodeURIComponent(item)}`;
    const payload = await fetchJson({ url, fetchImpl, timeoutMs, maxBodyBytes });
    const rows = Array.isArray(payload?.StatisticSearch?.row) ? payload.StatisticSearch.row : [];
    const sorted = rows
      .map((row) => ({ time: String(row?.TIME ?? ''), value: parseNumberLike(row?.DATA_VALUE) }))
      .filter((row) => row.value != null)
      .sort((a, b) => a.time.localeCompare(b.time));
    return sorted.at(-1)?.value ?? null;
  };

  return async function getEcosMacro() {
    const observedAt = new Date().toISOString();
    const values = {};
    const fields = {};
    const fieldName = { bokBaseRate: 'bokBaseRate', usdKrwRate: 'usdKrw', ktb3yYield: 'ktb3y' };
    const detail = {
      bokBaseRate: 'ECOS Bank of Korea base rate.',
      usdKrwRate: 'ECOS official USD/KRW reference rate.',
      ktb3yYield: 'ECOS 3Y Korea Treasury Bond yield.',
    };
    for (const [key, spec] of wanted) {
      try {
        const value = await latestValue(spec);
        if (value != null) {
          values[key] = round4(value);
          fields[fieldName[key] ?? key] = createProvenance({ source: 'ecos', observedAt, freshness: FRESHNESS.FRESH, details: detail[key] ?? 'ECOS macro series.' });
        }
      } catch { /* fail closed per series */ }
    }
    return { values, fields };
  };
}

export function createCompositeMarketDataAdapter({ base, providers = [], source } = {}) {
  return {
    source: source ?? base.source,
    async getSnapshot() {
      const snapshot = await base.getSnapshot();
      const macros = await Promise.all(providers.map((provider) => {
        try {
          return Promise.resolve(provider()).catch(() => null);
        } catch {
          return Promise.resolve(null);
        }
      }));
      const values = { ...(snapshot.values ?? {}) };
      const fields = { ...(snapshot.fields ?? {}) };
      for (const macro of macros) {
        if (!macro) continue;
        for (const [key, value] of Object.entries(macro.values ?? {})) {
          if (value != null) values[key] = value;
        }
        for (const [key, value] of Object.entries(macro.fields ?? {})) {
          if (value != null) fields[key] = value;
        }
      }
      // A provider may contribute extra market-pulse instruments (e.g. a KIS futures
      // series). Append them onto the base market pulse so the chart can prefer them.
      const extraInstruments = macros.flatMap((macro) => (Array.isArray(macro?.marketPulseInstruments) ? macro.marketPulseInstruments : []));
      if (extraInstruments.length && values.marketPulse && Array.isArray(values.marketPulse.instruments)) {
        values.marketPulse = { ...values.marketPulse, instruments: [...values.marketPulse.instruments, ...extraInstruments] };
      }
      // Polling boundary re-normalizes, dropping any value/field not in the schema/field set.
      return { ...snapshot, values, fields };
    },
  };
}
