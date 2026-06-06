import { FRESHNESS, missingRequiredFields, summarizeFreshness } from './freshness.js';

export const PROBABILITY_STATUS = Object.freeze({
  COMPUTED: 'computed',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
});

function clampProbability(value) {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

export function computeDownsideProbability({
  historicalMondayDownRate = null,
  recentMomentum = null,
  volatilityZScore = null,
  expiryRiskLevel = 'normal',
  provenance = {},
} = {}) {
  const required = ['kospiDaily'];
  const missingInputs = missingRequiredFields(provenance, required);
  const sourceFreshnessSummary = summarizeFreshness(provenance);

  if (missingInputs.length > 0 || historicalMondayDownRate == null) {
    return {
      status: PROBABILITY_STATUS.UNAVAILABLE,
      probability: null,
      confidence: 'none',
      missingInputs: [...new Set([...missingInputs, historicalMondayDownRate == null ? 'historicalMondayDownRate' : null].filter(Boolean))],
      sourceFreshnessSummary,
      formula: 'Unavailable until required KOSPI daily history is present.',
      contributions: [],
    };
  }

  let staleOrError = sourceFreshnessSummary.fields.some((field) => field.freshness !== FRESHNESS.FRESH);
  const degradedReasons = [];
  let score = Number(historicalMondayDownRate) * 100;
  const contributions = [{ input: 'historicalMondayDownRate', points: score, note: 'Baseline Monday decline frequency.' }];

  if (Number.isFinite(recentMomentum)) {
    const adjustment = recentMomentum < 0 ? Math.min(12, Math.abs(recentMomentum) * 100) : -Math.min(8, recentMomentum * 100);
    score += adjustment;
    contributions.push({ input: 'recentMomentum', points: Math.round(adjustment * 10) / 10, note: 'Negative momentum raises downside estimate; positive momentum lowers it.' });
  }

  if (Number.isFinite(volatilityZScore)) {
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
    probability: clampProbability(score),
    confidence: staleOrError ? 'low' : 'medium',
    missingInputs: [],
    degradedReasons,
    sourceFreshnessSummary,
    formula: 'baseline Monday down-rate plus transparent momentum, volatility, and expiry-settlement adjustments.',
    contributions,
  };
}
