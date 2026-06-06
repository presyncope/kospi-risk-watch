import { FRESHNESS, missingRequiredFields, summarizeFreshness } from './freshness.js';

export const PROBABILITY_STATUS = Object.freeze({
  COMPUTED: 'computed',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
});

function clampProbability(value) {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

function isValidRate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function hasInput(value) {
  return value !== null && value !== undefined;
}

export function computeDownsideProbability({
  historicalMondayDownRate = null,
  recentMomentum = null,
  volatilityZScore = null,
  expiryRiskLevel = 'normal',
  provenance = {},
} = {}) {
  const required = ['kospiDaily', 'historicalMondayDownRate'];
  const probabilityProvenance = {
    kospiDaily: provenance.kospiDaily,
    historicalMondayDownRate: provenance.historicalMondayDownRate,
    ...(hasInput(recentMomentum) ? { recentMomentum: provenance.recentMomentum } : {}),
    ...(hasInput(volatilityZScore) ? { volatility: provenance.volatility } : {}),
  };
  const missingInputs = missingRequiredFields(probabilityProvenance, required);
  const sourceFreshnessSummary = summarizeFreshness(probabilityProvenance);
  const invalidRequiredInputs = isValidRate(historicalMondayDownRate) ? [] : ['historicalMondayDownRate'];

  if (missingInputs.length > 0 || invalidRequiredInputs.length > 0) {
    return {
      status: PROBABILITY_STATUS.UNAVAILABLE,
      probability: null,
      confidence: 'none',
      missingInputs: [...new Set([...missingInputs, ...invalidRequiredInputs])],
      sourceFreshnessSummary,
      formula: 'Unavailable until required KOSPI daily history and valid baseline-rate inputs are present.',
      contributions: [],
    };
  }

  let staleOrError = sourceFreshnessSummary.fields.some((field) => field.freshness !== FRESHNESS.FRESH);
  const requiredInputStale = required.some((field) => provenance[field]?.freshness === FRESHNESS.STALE);
  const degradedReasons = requiredInputStale ? ['Required probability inputs are stale; headline numeric probability is suppressed'] : [];
  let score = Number(historicalMondayDownRate) * 100;
  const contributions = [{ input: 'historicalMondayDownRate', points: score, note: 'Baseline Monday decline frequency.' }];

  if (hasInput(recentMomentum) && !Number.isFinite(recentMomentum)) {
    staleOrError = true;
    degradedReasons.push('recentMomentum ignored because its value is not finite numeric');
    contributions.push({ input: 'recentMomentum', points: 0, note: 'Ignored because recent momentum value is not finite numeric.' });
  } else if (Number.isFinite(recentMomentum)) {
    const momentumFreshness = provenance.recentMomentum?.freshness ?? FRESHNESS.UNAVAILABLE;
    if (momentumFreshness !== FRESHNESS.FRESH) {
      staleOrError = true;
      degradedReasons.push('recentMomentum ignored because its provenance is missing or degraded');
      contributions.push({ input: 'recentMomentum', points: 0, note: 'Ignored because recent momentum provenance is missing or degraded.' });
    } else {
      const adjustment = recentMomentum < 0 ? Math.min(12, Math.abs(recentMomentum) * 100) : -Math.min(8, recentMomentum * 100);
      score += adjustment;
      contributions.push({ input: 'recentMomentum', points: Math.round(adjustment * 10) / 10, note: 'Negative momentum raises downside estimate; positive momentum lowers it.' });
    }
  }

  if (hasInput(volatilityZScore) && !Number.isFinite(volatilityZScore)) {
    staleOrError = true;
    degradedReasons.push('volatilityZScore ignored because its value is not finite numeric');
    contributions.push({ input: 'volatilityZScore', points: 0, note: 'Ignored because volatility value is not finite numeric.' });
  } else if (Number.isFinite(volatilityZScore)) {
    const volatilityFreshness = provenance.volatility?.freshness ?? FRESHNESS.UNAVAILABLE;
    if (volatilityFreshness !== FRESHNESS.FRESH) {
      staleOrError = true;
      degradedReasons.push('volatilityZScore ignored because volatility provenance is missing or degraded');
      contributions.push({ input: 'volatilityZScore', points: 0, note: 'Ignored because volatility provenance is missing or degraded.' });
    } else {
      const adjustment = Math.min(10, Math.max(0, volatilityZScore) * 4);
      score += adjustment;
      contributions.push({ input: 'volatilityZScore', points: Math.round(adjustment * 10) / 10, note: 'Elevated volatility raises uncertainty/downside estimate.' });
    }
  }

  const expiryAdjustment = expiryRiskLevel === 'high' ? 8 : expiryRiskLevel === 'elevated' ? 4 : 0;
  if (expiryAdjustment) {
    score += expiryAdjustment;
    contributions.push({ input: 'expirySettlementRisk', points: expiryAdjustment, note: 'Near-term expiry-settlement window raises risk marker.' });
  }

  return {
    status: staleOrError ? PROBABILITY_STATUS.DEGRADED : PROBABILITY_STATUS.COMPUTED,
    probability: requiredInputStale ? null : clampProbability(score),
    confidence: staleOrError ? 'low' : 'medium',
    missingInputs: [],
    degradedReasons,
    sourceFreshnessSummary,
    formula: requiredInputStale
      ? 'Numeric estimate suppressed until required KOSPI daily input is fresh.'
      : 'baseline Monday down-rate plus transparent momentum, volatility, and expiry-settlement adjustments.',
    contributions,
  };
}
