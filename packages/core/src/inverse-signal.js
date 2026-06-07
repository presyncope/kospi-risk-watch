import { PROBABILITY_STATUS } from './probability.js';

export const INVERSE_STANCES = Object.freeze({
  ENTER: '진입 우위',
  SCALE_IN: '분할 진입 검토',
  WATCH: '관망',
  REDUCE: '청산·축소',
  UNAVAILABLE: '평가 불가',
});

// stance color tokens consumed by the UI gauge/status CSS.
const STANCE_STATUS = Object.freeze({
  [INVERSE_STANCES.ENTER]: 'signal-strong',
  [INVERSE_STANCES.SCALE_IN]: 'signal-elevated',
  [INVERSE_STANCES.WATCH]: 'signal-watch',
  [INVERSE_STANCES.REDUCE]: 'signal-low',
  [INVERSE_STANCES.UNAVAILABLE]: 'unavailable',
});

const STANCE_BOUNDARIES = [30, 50, 70];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function dateKey(value) {
  if (value == null) return null;
  const parsed = typeof value === 'string' ? Date.parse(value) : value?.getTime?.();
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function instrument(marketPulse, key) {
  return marketPulse?.instruments?.find((item) => item.key === key) ?? null;
}

function mostNegativeIntraday(marketPulse) {
  const candidates = ['kospi', 'kospi200']
    .map((key) => instrument(marketPulse, key)?.changePct)
    .filter((value) => Number.isFinite(value));
  return candidates.length ? Math.min(...candidates) : null;
}

function stanceFor(strength) {
  if (strength >= 70) return INVERSE_STANCES.ENTER;
  if (strength >= 50) return INVERSE_STANCES.SCALE_IN;
  if (strength >= 30) return INVERSE_STANCES.WATCH;
  return INVERSE_STANCES.REDUCE;
}

function thresholdProximity(strength) {
  if (strength >= 70) return 100;
  const next = STANCE_BOUNDARIES.find((boundary) => boundary > strength) ?? 70;
  const prev = [...STANCE_BOUNDARIES].reverse().find((boundary) => boundary <= strength) ?? 0;
  if (next === prev) return 100;
  return Math.round(((strength - prev) / (next - prev)) * 100);
}

function entryGuideFor(stance) {
  switch (stance) {
    case INVERSE_STANCES.ENTER:
      return '강한 인버스 우위 구간입니다. 이미 분할 진입했다면 유지, 신규는 변동성·만기 확인 후 분할로만 진입을 검토하세요.';
    case INVERSE_STANCES.SCALE_IN:
      return '인버스 분할 진입을 고려할 구간입니다. 한 번에 전량보다 2~3회 분할하고, 급반등에 대비해 손절 기준을 먼저 정하세요.';
    case INVERSE_STANCES.WATCH:
      return '뚜렷한 인버스 우위가 없습니다. 하락확률 50%+ 또는 변동성 확대 신호가 나올 때까지 관망을 검토하세요.';
    default:
      return '인버스에 비우호적인 구간입니다. 보유 인버스는 축소·청산을 검토하고 신규 진입은 자제하세요.';
  }
}

function exitGuideFor(stance) {
  if (stance === INVERSE_STANCES.REDUCE) {
    return '청산·축소 우선: 보유 인버스는 분할 청산을 검토하세요. 손절은 진입가 기준 미리 정한 % 이탈 시 기계적으로 적용합니다.';
  }
  return '청산 신호 예시: 신호 강도 30 미만으로 하락, 지수의 강한 반등(당일 +0.8% 이상), 또는 만기·결제 통과. 손절선은 진입 전에 먼저 설정하세요.';
}

function sizingHint(stance, signalStrength, volatilityZScore) {
  if (stance === INVERSE_STANCES.REDUCE || signalStrength == null) {
    return {
      suggestedPctOfRiskBudget: 0,
      note: '인버스 비우호 구간 — 신규 진입 비중 0 예시입니다.',
      caveat: '총자본이 아니라 손실을 감내할 수 있는 위험 예산 대비 비율이며, 예시일 뿐 본인 책임입니다.',
    };
  }
  const volDivisor = Math.max(1, Number.isFinite(volatilityZScore) && volatilityZScore > 0 ? volatilityZScore : 0.6);
  const suggested = clamp(Math.round((signalStrength / 100) * 60 / volDivisor), 0, 60);
  return {
    suggestedPctOfRiskBudget: suggested,
    note: '변동성이 높을수록 1회 비중을 줄이는 역가중 예시입니다. 분할 진입을 전제로 합니다.',
    caveat: '총자본이 아니라 손실을 감내할 수 있는 위험 예산 대비 비율이며, 예시일 뿐 본인 책임입니다.',
  };
}

export function buildInverseSignal({
  probability = {},
  marketPulse = {},
  expirySettlement = {},
  volatilityZScore = null,
  lastDailyChangePct = null,
  asOf = null,
} = {}) {
  const disclaimer = '자동매매가 아니며 표시된 수치는 참고 예시입니다. 최종 판단과 책임은 본인에게 있습니다.';
  const closedMarket = (() => {
    const observed = dateKey(marketPulse?.observedAt);
    const today = dateKey(asOf ?? null);
    return observed && today ? observed !== today : false;
  })();

  if (probability.status === PROBABILITY_STATUS.UNAVAILABLE || probability.probability == null) {
    return {
      status: 'unavailable',
      signalStrength: null,
      stance: INVERSE_STANCES.UNAVAILABLE,
      stanceStatus: STANCE_STATUS[INVERSE_STANCES.UNAVAILABLE],
      thresholdProximity: 0,
      confidence: 'none',
      contributions: [],
      entryGuide: '필수 입력이 없어 인버스 신호를 계산할 수 없습니다. 데이터 신선도를 먼저 확인하세요.',
      exitGuide: exitGuideFor(INVERSE_STANCES.UNAVAILABLE),
      positionSizingHint: sizingHint(INVERSE_STANCES.REDUCE, null, volatilityZScore),
      caveat: '하락 확률 입력이 사용 불가 상태입니다.',
      disclaimer,
    };
  }

  const intradayChangePct = mostNegativeIntraday(marketPulse);
  const contributions = [];

  const baseFromProbability = round1(probability.probability * 0.5);
  contributions.push({ input: 'downsideProbability', points: baseFromProbability, note: '월요일 하락 확률 기반 기준값입니다.' });
  let strength = baseFromProbability;

  if (Number.isFinite(intradayChangePct)) {
    const points = intradayChangePct < 0
      ? round1(Math.min(18, Math.abs(intradayChangePct) * 3))
      : -round1(Math.min(12, intradayChangePct * 3));
    strength += points;
    contributions.push({ input: 'intradayMomentum', points, note: '당일 지수 약세는 인버스 우위를 높이고, 강세는 낮춥니다.' });
  }

  if (Number.isFinite(lastDailyChangePct)) {
    const points = lastDailyChangePct < 0
      ? round1(Math.min(12, Math.abs(lastDailyChangePct) * 2))
      : -round1(Math.min(8, lastDailyChangePct * 2));
    strength += points;
    contributions.push({ input: 'lastDailyChange', points, note: '최근 일봉 종가 변동을 반영합니다.' });
  }

  if (Number.isFinite(volatilityZScore) && volatilityZScore > 0) {
    const points = round1(Math.min(12, volatilityZScore * 5));
    strength += points;
    contributions.push({ input: 'volatilityZScore', points, note: '변동성 확대는 급변 위험을 키워 인버스 신호를 높입니다.' });
  }

  const expiryPoints = expirySettlement.riskLevel === 'high' ? 8 : expirySettlement.riskLevel === 'elevated' ? 5 : 0;
  if (expiryPoints) {
    strength += expiryPoints;
    contributions.push({ input: 'expirySettlement', points: expiryPoints, note: '만기·결제 임박 구간은 변동성 위험을 더합니다.' });
  }

  const signalStrength = Math.round(clamp(strength, 0, 100));
  const stance = stanceFor(signalStrength);
  let confidence = probability.confidence ?? 'medium';
  if (closedMarket && confidence === 'medium') confidence = 'low';

  const caveatParts = [];
  if (probability.status === PROBABILITY_STATUS.DEGRADED) caveatParts.push('입력 데이터가 제한적이라 신호 신뢰도가 낮습니다.');
  if (closedMarket) caveatParts.push('장 마감/주말 기준 데이터이므로 개장 후 갱신이 필요합니다.');

  return {
    status: 'computed',
    signalStrength,
    stance,
    stanceStatus: STANCE_STATUS[stance],
    thresholdProximity: thresholdProximity(signalStrength),
    confidence,
    intradayChangePct: Number.isFinite(intradayChangePct) ? round1(intradayChangePct) : null,
    lastDailyChangePct: Number.isFinite(lastDailyChangePct) ? round1(lastDailyChangePct) : null,
    contributions,
    entryGuide: entryGuideFor(stance),
    exitGuide: exitGuideFor(stance),
    positionSizingHint: sizingHint(stance, signalStrength, volatilityZScore),
    caveat: caveatParts.join(' ') || '관찰 데이터 기준 참고 신호입니다.',
    disclaimer,
  };
}
