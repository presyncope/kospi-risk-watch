import { FRESHNESS, buildDerivativesMarketContext, buildExpirySettlementRisk, buildProductionReadinessAssessment, buildQuantReadinessAssessment, buildRiskAlerts, computeDownsideProbability, createProvenance, evaluateLiveSourceApproval, normalizeHolidaySet, summarizeFreshness } from '../../../packages/core/src/index.js';

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

function buildMarketPulseContext(snapshot = {}) {
  const pulse = snapshot.values?.marketPulse;
  if (!pulse) {
    return {
      status: 'unavailable',
      source: snapshot.source ?? 'unknown',
      label: '시장 1분봉 프록시가 설정되지 않았습니다.',
      observedAt: null,
      primaryKey: null,
      instruments: [],
      caveat: 'KRX 선물/OI/숏 관련 데이터가 아니라, 별도 설정된 공개 프록시 차트만 표시합니다.',
    };
  }
  return {
    status: pulse.status ?? 'unavailable',
    source: pulse.source ?? snapshot.source ?? 'unknown',
    label: pulse.label ?? '시장 1분봉 프록시',
    observedAt: pulse.observedAt ?? null,
    primaryKey: pulse.primaryKey ?? null,
    instruments: pulse.instruments ?? [],
    caveat: 'Yahoo/yfinance 경로는 KOSPI200 선물이 아니라 지수 프록시입니다. liveReady 판단에는 사용하지 않습니다.',
  };
}

function instrumentByKey(marketPulse, key) {
  return marketPulse.instruments?.find((instrument) => instrument.key === key) ?? null;
}

function provenanceStatus(snapshot, key) {
  return snapshot.fields?.[key]?.freshness ?? 'unavailable';
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
      label: 'KOSPI 당일 변동',
      value: displayPercent(kospi?.changePct, { signed: true }),
      status: provenanceStatus(snapshot, 'kospiIntraday'),
      role: '현재 시장 방향 확인',
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
    provenance: snapshot.fields ?? {},
  });
  const derivativesMarket = buildDerivativesMarketContext({ snapshot, expirySettlement });
  const alerts = buildRiskAlerts({ probabilityResult: probability, expiryRisk: expirySettlement });
  const sourceStatus = buildSourceStatus(snapshot);
  const marketPulse = buildMarketPulseContext(snapshot);
  const downsideInputs = buildDownsideInputEvidence({ snapshot, probability, expirySettlement, marketPulse });
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
    probability,
    expirySettlement,
    derivativesMarket,
    quantReadiness,
    productionReadiness,
    alerts,
  };
}
