import { FRESHNESS, buildDerivativesMarketContext, buildExpirySettlementRisk, buildInverseSignal, buildProductionReadinessAssessment, buildQuantReadinessAssessment, buildRiskAlerts, computeDownsideProbability, createProvenance, evaluateLiveSourceApproval, normalizeHolidaySet, summarizeFreshness } from '../../../packages/core/src/index.js';

export function summarizeSnapshotFreshness(snapshot = {}) {
  const fields = { ...(snapshot.fields ?? {}) };
  fields.adapter = createProvenance({
    source: snapshot.source ?? 'unknown',
    observedAt: snapshot.observedAt ?? snapshot.polledAt ?? null,
    freshness: snapshot.freshness ?? 'unavailable',
    error: snapshot.error ?? null,
    details: snapshot.message ?? null,
  });
  return summarizeFreshness(fields);
}

export function buildSourceStatus(snapshot = {}) {
  const source = snapshot.source ?? 'unknown';
  const capabilities = snapshot.capabilities ?? {};
  const isMock = capabilities.mock === true;
  const sourceApproval = evaluateLiveSourceApproval({ source, capabilities });
  const approval = sourceApproval.approval;
  const isApprovedLive = sourceApproval.approved && snapshot.freshness === FRESHNESS.FRESH;
  const hasSourceError = snapshot.freshness === FRESHNESS.ERROR || Boolean(snapshot.error);
  const isPlaceholder = approval === 'placeholder' || approval === 'unconfigured' || source === 'unconfigured';
  let mode = 'external-source-unapproved';
  let label = 'External source — not approved for live readiness';
  if (hasSourceError) {
    mode = 'source-error';
    label = 'Adapter polling error — no live market data verified';
  } else if (isMock) {
    mode = 'mock-fixture';
    label = 'Mock fixture — not live market data';
  } else if (isPlaceholder) {
    mode = 'unavailable-placeholder';
    label = 'Unavailable placeholder — no live market data configured';
  } else if (isApprovedLive) {
    mode = 'approved-public-live-source';
    label = 'Approved free/public live market source';
  }
  return {
    source,
    observedAt: snapshot.observedAt ?? null,
    polledAt: snapshot.polledAt ?? null,
    freshness: snapshot.freshness ?? FRESHNESS.UNAVAILABLE,
    message: snapshot.message ?? null,
    error: snapshot.error ?? null,
    mode,
    liveData: isApprovedLive,
    approval,
    requestedApproval: sourceApproval.requestedApproval ?? approval,
    approvalReason: sourceApproval.reason,
    license: capabilities.license ?? 'unspecified',
    label,
  };
}

function displayPercent(value, { ratio = false, signed = false } = {}) {
  if (!Number.isFinite(value)) return '사용 불가';
  const pct = ratio ? value * 100 : value;
  const prefix = signed && pct > 0 ? '+' : '';
  return `${prefix}${pct.toFixed(2)}%`;
}

function displayNumber(value, suffix = '') {
  if (!Number.isFinite(value)) return '사용 불가';
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}${suffix}`;
}

function dateKey(value) {
  if (value == null) return null;
  const parsed = typeof value === 'string' ? Date.parse(value) : value?.getTime?.();
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

// Defensive plausibility check: the KOSPI/KOSPI200 level ratio is normally ~6.5–8.
// If a proxy returns an implausible ratio we flag it instead of trusting it silently.
function marketDataQuality(pulse) {
  const kospi = pulse.instruments?.find((item) => item.key === 'kospi')?.last;
  const kospi200 = pulse.instruments?.find((item) => item.key === 'kospi200')?.last;
  if (!Number.isFinite(kospi) || !Number.isFinite(kospi200) || kospi200 === 0) return 'unknown';
  const ratio = kospi / kospi200;
  return ratio >= 5 && ratio <= 9 ? 'ok' : 'check';
}

function buildMarketPulseContext(snapshot = {}, { asOf = null } = {}) {
  const pulse = snapshot.values?.marketPulse;
  if (!pulse) {
    return {
      status: 'unavailable',
      source: snapshot.source ?? 'unknown',
      label: '시장 1분봉 프록시가 설정되지 않았습니다.',
      observedAt: null,
      primaryKey: null,
      instruments: [],
      closed: false,
      marketDateLabel: null,
      dataQuality: 'unknown',
      caveat: 'KRX 선물/OI/숏 관련 데이터가 아니라, 별도 설정된 공개 프록시 차트만 표시합니다.',
    };
  }
  const observedKey = dateKey(pulse.observedAt);
  const closed = Boolean(observedKey && dateKey(asOf) && observedKey !== dateKey(asOf));
  const dataQuality = marketDataQuality(pulse);
  const instruments = pulse.instruments ?? [];
  // Futures-first: chart the actual traded instrument when a futures series exists; else spot proxy.
  const hasFutures = instruments.some((item) => item.key === 'kospi200Futures');
  const primaryKey = hasFutures ? 'kospi200Futures' : (pulse.primaryKey ?? null);
  const primaryInstrument = instruments.find((item) => item.key === primaryKey) ?? instruments[0];
  const futuresInstrument = instruments.find((item) => item.key === 'kospi200Futures');
  const spotInstrument = instruments.find((item) => item.key === 'kospi200');
  // Prefer the real basis (futures − spot) when a futures series is present;
  // else fall back to an adapter-provided basis value (e.g. KRX over spot).
  let futuresBasis = Number.isFinite(snapshot.values?.futuresBasis) ? snapshot.values.futuresBasis : null;
  if (Number.isFinite(futuresInstrument?.last) && Number.isFinite(spotInstrument?.last)) {
    futuresBasis = Number((futuresInstrument.last - spotInstrument.last).toFixed(2));
  }
  // Implied level only matters when there is no real futures series (basis over spot).
  const impliedFuturesLevel = !hasFutures && futuresBasis != null && Number.isFinite(primaryInstrument?.last)
    ? Number((primaryInstrument.last + futuresBasis).toFixed(2))
    : null;
  const caveatParts = ['Yahoo/yfinance 경로는 KOSPI200 선물이 아니라 지수 프록시입니다. liveReady 판단에는 사용하지 않습니다.'];
  if (closed) caveatParts.push(`표시값은 ${observedKey} 최근 장 마감 기준이며, 개장 후 갱신이 필요합니다.`);
  if (dataQuality === 'check') caveatParts.push('지수 레벨 비율이 비정상이라 데이터 점검이 필요합니다.');
  return {
    status: pulse.status ?? 'unavailable',
    source: pulse.source ?? snapshot.source ?? 'unknown',
    label: pulse.label ?? '시장 1분봉 프록시',
    observedAt: pulse.observedAt ?? null,
    primaryKey,
    isFuturesPrimary: hasFutures,
    instruments,
    closed,
    marketDateLabel: closed ? observedKey : null,
    dataQuality,
    futuresBasis,
    impliedFuturesLevel,
    caveat: caveatParts.join(' '),
  };
}

function instrumentByKey(marketPulse, key) {
  return marketPulse.instruments?.find((instrument) => instrument.key === key) ?? null;
}

function provenanceStatus(snapshot, key) {
  return snapshot.fields?.[key]?.freshness ?? 'unavailable';
}

function macroEvidence(snapshot = {}) {
  const values = snapshot.values ?? {};
  const freshness = (name) => snapshot.fields?.[name]?.freshness ?? 'unavailable';
  const out = [];
  if (Number.isFinite(values.vixLevel)) {
    out.push({ key: 'vixLevel', label: 'VIX (위험 regime)', value: displayNumber(values.vixLevel), status: freshness('vix'), role: '미검증 매크로', detail: '미검증: 높을수록 위험회피·하방 위험.' });
  }
  if (Number.isFinite(values.usEquityChangePct)) {
    out.push({ key: 'usEquityChangePct', label: '직전 미국장 변동', value: displayPercent(values.usEquityChangePct, { signed: true }), status: freshness('usEquity'), role: '미검증 매크로', detail: '미검증: 음수면 월요일 갭다운 위험을 높임.' });
  }
  if (Number.isFinite(values.us10yYield)) {
    out.push({ key: 'us10yYield', label: '미 10년물 금리', value: displayNumber(values.us10yYield, '%'), status: freshness('us10y'), role: '매크로 맥락', detail: '미국 장기금리.' });
  }
  if (Number.isFinite(values.bokBaseRate)) {
    out.push({ key: 'bokBaseRate', label: '한은 기준금리', value: displayNumber(values.bokBaseRate, '%'), status: freshness('bokBaseRate'), role: '매크로 맥락', detail: 'ECOS 기준금리.' });
  }
  if (Number.isFinite(values.usdKrwRate)) {
    out.push({ key: 'usdKrwRate', label: 'USD/KRW (공식)', value: displayNumber(values.usdKrwRate), status: freshness('usdKrw'), role: '매크로 맥락', detail: 'ECOS 원/달러 기준율.' });
  }
  return out;
}

function buildDownsideInputEvidence({ snapshot = {}, probability = {}, expirySettlement = {}, marketPulse = {} } = {}) {
  const kospi = instrumentByKey(marketPulse, 'kospi');
  const kospi200 = instrumentByKey(marketPulse, 'kospi200');
  return [
    {
      key: 'historicalMondayDownRate',
      label: '월요일 하락 기준율',
      value: displayPercent(snapshot.values?.historicalMondayDownRate, { ratio: true }),
      status: provenanceStatus(snapshot, 'historicalMondayDownRate'),
      role: '확률의 기본값',
      detail: probability.contributions?.find((item) => item.input === 'historicalMondayDownRate')?.note ?? '필수 입력입니다.',
    },
    {
      key: 'recentMomentum',
      label: '최근 KOSPI 모멘텀',
      value: displayPercent(snapshot.values?.recentMomentum, { ratio: true, signed: true }),
      status: provenanceStatus(snapshot, 'recentMomentum'),
      role: '음수면 하방 압력 보정',
      detail: probability.contributions?.find((item) => item.input === 'recentMomentum')?.note ?? '일별 KOSPI 추세가 필요합니다.',
    },
    {
      key: 'volatilityZScore',
      label: '변동성 z-score',
      value: displayNumber(snapshot.values?.volatilityZScore, 'σ'),
      status: provenanceStatus(snapshot, 'volatility'),
      role: '변동성 확대 보정',
      detail: probability.contributions?.find((item) => item.input === 'volatilityZScore')?.note ?? '변동성 입력이 필요합니다.',
    },
    {
      key: 'expirySettlementRisk',
      label: '만기·결제 근접도',
      value: expirySettlement.riskLevel ?? 'unknown',
      status: expirySettlement.riskLevel ?? 'unknown',
      role: '만기 주간 리스크 보정',
      detail: expirySettlement.explanation ?? 'KOSPI200 룰 기반 만기 캘린더입니다.',
    },
    {
      key: 'kospiIntraday',
      label: marketPulse.closed ? `KOSPI 변동 (${marketPulse.marketDateLabel} 마감)` : 'KOSPI 당일 변동',
      value: displayPercent(kospi?.changePct, { signed: true }),
      status: provenanceStatus(snapshot, 'kospiIntraday'),
      role: marketPulse.closed ? '최근 장 마감 기준 (실시간 아님)' : '현재 시장 방향 확인',
      detail: kospi ? `${kospi.symbol} · 5분 ${displayPercent(kospi.momentum5mPct, { signed: true })} · 20분 ${displayPercent(kospi.momentum20mPct, { signed: true })}` : '1분봉 프록시가 없습니다.',
    },
    {
      key: 'kospi200Intraday',
      label: 'KOSPI200 지수 프록시',
      value: displayPercent(kospi200?.changePct, { signed: true }),
      status: provenanceStatus(snapshot, 'kospi200Intraday'),
      role: '선물 대체 아님',
      detail: kospi200 ? `${kospi200.symbol} · 선물/OI/옵션 데이터가 아닌 지수 차트입니다.` : 'KOSPI200 1분봉 프록시가 없습니다.',
    },
    ...macroEvidence(snapshot),
  ];
}

export function buildDashboardState(snapshot, { asOf = new Date(), service = {} } = {}) {
  const holidaySet = snapshot.fields?.holidayCalendar?.freshness === FRESHNESS.FRESH
    ? normalizeHolidaySet(snapshot.values?.holidayCalendar)
    : null;
  const expirySettlement = buildExpirySettlementRisk({ asOf, holidays: holidaySet });
  const sourceFreshnessSummary = summarizeSnapshotFreshness(snapshot);
  const probability = computeDownsideProbability({
    historicalMondayDownRate: snapshot.values?.historicalMondayDownRate ?? null,
    recentMomentum: snapshot.values?.recentMomentum ?? null,
    volatilityZScore: snapshot.values?.volatilityZScore ?? null,
    expiryRiskLevel: expirySettlement.riskLevel,
    vixLevel: snapshot.values?.vixLevel ?? null,
    usEquityChangePct: snapshot.values?.usEquityChangePct ?? null,
    provenance: snapshot.fields ?? {},
  });
  probability.backtest = snapshot.values?.probabilityBacktest ?? null;
  const derivativesMarket = buildDerivativesMarketContext({ snapshot, expirySettlement });
  const sourceStatus = buildSourceStatus(snapshot);
  const marketPulse = buildMarketPulseContext(snapshot, { asOf });
  const downsideInputs = buildDownsideInputEvidence({ snapshot, probability, expirySettlement, marketPulse });
  const inverseSignal = buildInverseSignal({
    probability,
    marketPulse,
    expirySettlement,
    volatilityZScore: snapshot.values?.volatilityZScore ?? null,
    lastDailyChangePct: snapshot.values?.lastDailyChangePct ?? null,
    asOf,
  });
  const alerts = buildRiskAlerts({
    probabilityResult: probability,
    expiryRisk: expirySettlement,
    inverseSignal,
    volatilityZScore: snapshot.values?.volatilityZScore ?? null,
  });
  const quantReadiness = buildQuantReadinessAssessment({
    snapshot,
    sourceStatus,
    probability,
    derivativesMarket,
    expirySettlement,
  });
  const productionReadiness = buildProductionReadinessAssessment({
    snapshot,
    sourceStatus,
    quantReadiness,
    probability,
    derivativesMarket,
    expirySettlement,
    service,
  });
  return {
    snapshot,
    sourceStatus,
    sourceFreshnessSummary,
    marketPulse,
    downsideInputs,
    inverseSignal,
    probability,
    expirySettlement,
    derivativesMarket,
    quantReadiness,
    productionReadiness,
    alerts,
  };
}
