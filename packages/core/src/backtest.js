// Walk-forward backtest of the Monday-downside core model — the daily-derivable
// part of computeDownsideProbability (baseline Monday down-rate + recent momentum
// + volatility z). It deliberately excludes macro/expiry adjustments, which need
// separate point-in-time history.
//
// No lookahead: for each historical Monday the prediction uses ONLY the daily
// closes strictly before that Monday. The realized outcome is whether that Monday
// closed below the prior trading day. Reported with sample size so a thin sample
// is honest rather than misleading.

function isMonday(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay() === 1;
}

function mondayDownRate(series) {
  let mondays = 0;
  let downs = 0;
  for (let index = 1; index < series.length; index += 1) {
    if (!isMonday(series[index].date)) continue;
    mondays += 1;
    if (series[index].close < series[index - 1].close) downs += 1;
  }
  return mondays > 0 ? downs / mondays : null;
}

function recentMomentum(series, lookback = 5) {
  if (series.length < 2) return null;
  const last = series.at(-1).close;
  const prior = series[Math.max(0, series.length - 1 - lookback)].close;
  return Number.isFinite(last) && Number.isFinite(prior) && prior !== 0 ? last / prior - 1 : null;
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

// Mirrors the daily core of computeDownsideProbability (momentum + volatility
// adjustments). Kept in sync with probability.js by construction.
function predictMondayDownProbability(baselineRate, momentum, volZ) {
  let score = baselineRate * 100;
  if (Number.isFinite(momentum)) {
    score += momentum < 0 ? Math.min(12, Math.abs(momentum) * 100) : -Math.min(8, momentum * 100);
  }
  if (Number.isFinite(volZ)) {
    score += Math.min(10, Math.max(0, volZ) * 4);
  }
  return Math.max(0, Math.min(100, score)) / 100;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

const CALIBRATION_EDGES = [0, 0.3, 0.4, 0.5, 1.0001];

export function backtestMondayDownside(dailySeries = [], { minHistory = 60, minSample = 20 } = {}) {
  const series = (Array.isArray(dailySeries) ? dailySeries : [])
    .filter((row) => row && typeof row.date === 'string' && Number.isFinite(row.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  const predictions = [];
  for (let index = Math.max(1, minHistory); index < series.length; index += 1) {
    const today = series[index];
    if (!isMonday(today.date)) continue;
    const history = series.slice(0, index); // strictly before this Monday — no lookahead
    const baseline = mondayDownRate(history);
    if (baseline == null) continue;
    const probability = predictMondayDownProbability(baseline, recentMomentum(history), volatilityZScore(history));
    predictions.push({ probability, down: today.close < series[index - 1].close });
  }

  const sampleSize = predictions.length;
  if (sampleSize < minSample) {
    return { sampleSize, sufficient: false, verdict: 'insufficient-sample' };
  }

  const baseRate = predictions.filter((entry) => entry.down).length / sampleSize;
  const meanPredicted = predictions.reduce((sum, entry) => sum + entry.probability, 0) / sampleSize;
  const brierScore = predictions.reduce((sum, entry) => sum + (entry.probability - (entry.down ? 1 : 0)) ** 2, 0) / sampleSize;
  const climatologyBrier = baseRate * (1 - baseRate);
  const brierSkillScore = climatologyBrier > 0 ? 1 - brierScore / climatologyBrier : 0;

  const calibration = [];
  for (let bucket = 0; bucket < CALIBRATION_EDGES.length - 1; bucket += 1) {
    const low = CALIBRATION_EDGES[bucket];
    const high = CALIBRATION_EDGES[bucket + 1];
    const inBucket = predictions.filter((entry) => entry.probability >= low && entry.probability < high);
    if (inBucket.length === 0) continue;
    calibration.push({
      from: round(low, 2),
      to: round(Math.min(high, 1), 2),
      count: inBucket.length,
      predictedAvg: round(inBucket.reduce((sum, entry) => sum + entry.probability, 0) / inBucket.length),
      actualRate: round(inBucket.filter((entry) => entry.down).length / inBucket.length),
    });
  }

  const verdict = brierSkillScore > 0.05
    ? 'positive-skill'
    : brierSkillScore < -0.05
      ? 'negative-skill'
      : 'no-skill';

  return {
    sampleSize,
    sufficient: true,
    baseRate: round(baseRate),
    meanPredicted: round(meanPredicted),
    brierScore: round(brierScore),
    climatologyBrier: round(climatologyBrier),
    brierSkillScore: round(brierSkillScore),
    verdict,
    calibration,
  };
}
