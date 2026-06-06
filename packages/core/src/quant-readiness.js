import { FRESHNESS } from './freshness.js';
import { MVP_GUARDRAILS } from './policy.js';
import { PROBABILITY_STATUS } from './probability.js';
import { DERIVATIVES_MARKET_STATUS } from './derivatives-market.js';

export const QUANT_READINESS_VERDICTS = Object.freeze({
  OPERATIONAL_SHELL: 'operational-shell',
  ANALYSIS_READY: 'analysis-review-ready',
  LIVE_MONITOR_READY: 'approved-live-monitor-ready',
});

export const READINESS_CHECK_STATUS = Object.freeze({
  PASS: 'pass',
  WATCH: 'watch',
  FAIL: 'fail',
});

function checkScore(status, maxScore) {
  if (status === READINESS_CHECK_STATUS.PASS) return maxScore;
  if (status === READINESS_CHECK_STATUS.WATCH) return Math.round(maxScore * 0.5);
  return 0;
}

function buildCheck({ key, label, status, maxScore, evidence, blocker = null }) {
  return {
    key,
    label,
    status,
    score: checkScore(status, maxScore),
    maxScore,
    evidence,
    blocker,
  };
}

function sourceCheck(sourceStatus = {}) {
  if (sourceStatus.liveData && sourceStatus.freshness === FRESHNESS.FRESH) {
    return buildCheck({
      key: 'source',
      label: 'Market data source',
      status: READINESS_CHECK_STATUS.PASS,
      maxScore: 20,
      evidence: `${sourceStatus.source} is fresh and marked live by the adapter boundary.`,
    });
  }
  if (sourceStatus.mode === 'mock-fixture') {
    return buildCheck({
      key: 'source',
      label: 'Market data source',
      status: READINESS_CHECK_STATUS.WATCH,
      maxScore: 20,
      evidence: 'Deterministic mock fixture is available for UI and logic verification only.',
      blocker: 'Replace mock fixture with an explicitly approved free/public live adapter before live-monitor readiness.',
    });
  }
  if (sourceStatus.mode === 'source-error') {
    return buildCheck({
      key: 'source',
      label: 'Market data source',
      status: READINESS_CHECK_STATUS.FAIL,
      maxScore: 20,
      evidence: sourceStatus.label ?? 'Adapter polling failed.',
      blocker: 'Restore adapter polling before live-monitor readiness.',
    });
  }
  return buildCheck({
    key: 'source',
    label: 'Market data source',
    status: READINESS_CHECK_STATUS.FAIL,
    maxScore: 20,
    evidence: sourceStatus.label ?? 'No live source is configured.',
    blocker: sourceStatus.mode === 'external-source-unapproved'
      ? 'Declare explicit approved/free-public/live adapter capabilities before live-monitor readiness.'
      : 'Approved KOSPI and KOSPI200 market inputs are not configured.',
  });
}

function probabilityCheck(probability = {}) {
  if (probability.status === PROBABILITY_STATUS.COMPUTED) {
    return buildCheck({
      key: 'probability',
      label: 'Downside probability calculation',
      status: READINESS_CHECK_STATUS.PASS,
      maxScore: 20,
      evidence: `Probability is computed with ${probability.confidence ?? 'unknown'} calculation confidence.`,
    });
  }
  if (probability.status === PROBABILITY_STATUS.DEGRADED) {
    return buildCheck({
      key: 'probability',
      label: 'Downside probability calculation',
      status: READINESS_CHECK_STATUS.WATCH,
      maxScore: 20,
      evidence: 'Probability is degraded because one or more inputs are stale or partial.',
      blocker: probability.degradedReasons?.join('; ') ?? 'Resolve degraded probability inputs.',
    });
  }
  return buildCheck({
    key: 'probability',
    label: 'Downside probability calculation',
    status: READINESS_CHECK_STATUS.FAIL,
    maxScore: 20,
    evidence: 'Probability is unavailable until required KOSPI history inputs exist.',
    blocker: `Missing inputs: ${probability.missingInputs?.join(', ') || 'required probability inputs'}.`,
  });
}

function derivativesCheck(derivativesMarket = {}) {
  const coverage = derivativesMarket.coverage ?? { available: 0, total: 0, stale: 0, required: { available: 0, total: 0 } };
  const required = coverage.required ?? { available: 0, total: 0, stale: 0, unavailable: 0, error: 0 };
  if (derivativesMarket.status === DERIVATIVES_MARKET_STATUS.AVAILABLE) {
    return buildCheck({
      key: 'derivatives',
      label: 'Derivatives market coverage',
      status: READINESS_CHECK_STATUS.PASS,
      maxScore: 20,
      evidence: `${coverage.available}/${coverage.total} configured derivatives metrics are available, including ${required.available}/${required.total} live-critical metrics.`,
    });
  }
  if (derivativesMarket.status === DERIVATIVES_MARKET_STATUS.PARTIAL) {
    return buildCheck({
      key: 'derivatives',
      label: 'Derivatives market coverage',
      status: READINESS_CHECK_STATUS.WATCH,
      maxScore: 20,
      evidence: `${coverage.available}/${coverage.total} configured derivatives metrics are available, ${coverage.stale} are stale, and ${required.available}/${required.total} live-critical metrics are fresh.`,
      blocker: 'Complete every live-critical derivatives metric before calling the dashboard live-monitor ready.',
    });
  }
  return buildCheck({
    key: 'derivatives',
    label: 'Derivatives market coverage',
    status: READINESS_CHECK_STATUS.FAIL,
    maxScore: 20,
    evidence: 'Major derivatives market metrics are not provided by the configured adapter.',
    blocker: 'Add approved futures/options open interest, volume, basis, ratio, flow, and holiday-calendar fields.',
  });
}

function expiryCheck(expirySettlement = {}, derivativesMarket = {}) {
  const hasRuleBasedWindow = Boolean(expirySettlement.futuresMonthlyFinalTradingDay);
  const holidayCalendar = derivativesMarket.metrics?.find((metric) => metric.key === 'holidayCalendar');
  const holidayCalendarFresh = holidayCalendar?.status === DERIVATIVES_MARKET_STATUS.AVAILABLE;
  const holidayAdjustmentApplied = expirySettlement.holidayAdjustment === 'applied';
  if (hasRuleBasedWindow && holidayCalendarFresh && holidayAdjustmentApplied) {
    return buildCheck({
      key: 'expiry-calendar',
      label: 'Expiry and settlement calendar',
      status: READINESS_CHECK_STATUS.PASS,
      maxScore: 15,
      evidence: `Expiry window is present for ${expirySettlement.futuresMonthlyFinalTradingDay}, and fresh holiday-calendar data was applied.`,
    });
  }
  if (hasRuleBasedWindow) {
    const missingPiece = holidayCalendarFresh
      ? 'holiday-calendar provenance is fresh, but it has not been applied to the expiry/settlement calculation'
      : 'holiday-calendar provenance is not fresh';
    return buildCheck({
      key: 'expiry-calendar',
      label: 'Expiry and settlement calendar',
      status: READINESS_CHECK_STATUS.WATCH,
      maxScore: 15,
      evidence: `Rule-based expiry window is present for ${expirySettlement.futuresMonthlyFinalTradingDay}, but ${missingPiece}.`,
      blocker: 'Apply fresh holiday-calendar provenance to the expiry/settlement calculation before treating expiry-settlement readiness as live-monitor ready.',
    });
  }
  return buildCheck({
    key: 'expiry-calendar',
    label: 'Expiry and settlement calendar',
    status: READINESS_CHECK_STATUS.FAIL,
    maxScore: 15,
    evidence: 'Expiry calendar is missing.',
    blocker: 'Restore KOSPI200 expiry-settlement calendar output.',
  });
}

function pollingCheck(snapshot = {}) {
  return buildCheck({
    key: 'polling',
    label: 'Polling visibility',
    status: snapshot.polling?.intervalMs ? READINESS_CHECK_STATUS.PASS : READINESS_CHECK_STATUS.FAIL,
    maxScore: 10,
    evidence: snapshot.polling?.intervalMs ? `Polling interval is visible at ${snapshot.polling.intervalMs} ms.` : 'Polling metadata is missing.',
    blocker: snapshot.polling?.intervalMs ? null : 'Expose polling interval and active state.',
  });
}

function guardrailCheck() {
  const pass = MVP_GUARDRAILS.automatedTrading === false && MVP_GUARDRAILS.investmentAdvice === false;
  return buildCheck({
    key: 'guardrails',
    label: 'Observation-only guardrails',
    status: pass ? READINESS_CHECK_STATUS.PASS : READINESS_CHECK_STATUS.FAIL,
    maxScore: 15,
    evidence: pass ? 'No trading automation or advice mode is enabled.' : 'Guardrail constants are not in the safe MVP state.',
    blocker: pass ? null : 'Disable prohibited execution or advice features.',
  });
}

function verdictFor({ score, checks, sourceStatus, probability, derivativesMarket }) {
  const noFailures = checks.every((check) => check.status !== READINESS_CHECK_STATUS.FAIL);
  const allChecksPass = checks.every((check) => check.status === READINESS_CHECK_STATUS.PASS);
  if (score >= 85 && allChecksPass && sourceStatus.liveData && probability.status === PROBABILITY_STATUS.COMPUTED && derivativesMarket.status === DERIVATIVES_MARKET_STATUS.AVAILABLE) {
    return QUANT_READINESS_VERDICTS.LIVE_MONITOR_READY;
  }
  if (score >= 60 && noFailures && probability.status !== PROBABILITY_STATUS.UNAVAILABLE && derivativesMarket.status !== DERIVATIVES_MARKET_STATUS.UNAVAILABLE) {
    return QUANT_READINESS_VERDICTS.ANALYSIS_READY;
  }
  return QUANT_READINESS_VERDICTS.OPERATIONAL_SHELL;
}

function summaryFor(verdict) {
  if (verdict === QUANT_READINESS_VERDICTS.LIVE_MONITOR_READY) {
    return 'Approved live-monitor readiness: explicit free/public live source capabilities, fresh probability inputs, and all live-critical derivatives metrics are present.';
  }
  if (verdict === QUANT_READINESS_VERDICTS.ANALYSIS_READY) {
    return 'Analysis review ready: system logic and fixture/partial inputs can be reviewed, but this is not live market readiness.';
  }
  return 'Operational shell: service, controls, guardrails, and calendar logic exist, but required market inputs are missing or not live.';
}

export function buildQuantReadinessAssessment({ snapshot = {}, sourceStatus = {}, probability = {}, derivativesMarket = {}, expirySettlement = {} } = {}) {
  const checks = [
    sourceCheck(sourceStatus),
    probabilityCheck(probability),
    derivativesCheck(derivativesMarket),
    expiryCheck(expirySettlement, derivativesMarket),
    pollingCheck(snapshot),
    guardrailCheck(),
  ];
  const score = checks.reduce((sum, check) => sum + check.score, 0);
  const maxScore = checks.reduce((sum, check) => sum + check.maxScore, 0);
  const verdict = verdictFor({ score, checks, sourceStatus, probability, derivativesMarket });
  return {
    score,
    maxScore,
    scorePct: Math.round((score / maxScore) * 100),
    verdict,
    status: verdict,
    summary: summaryFor(verdict),
    checks,
    blockers: checks.filter((check) => check.blocker).map((check) => check.blocker),
    strengths: checks.filter((check) => check.status === READINESS_CHECK_STATUS.PASS).map((check) => check.label),
    caveat: 'This readiness score evaluates dashboard data/system completeness only; it is not market direction guidance.',
  };
}
