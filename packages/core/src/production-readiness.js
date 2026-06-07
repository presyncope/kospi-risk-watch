import { DERIVATIVES_MARKET_STATUS } from './derivatives-market.js';
import { FRESHNESS } from './freshness.js';
import { MVP_GUARDRAILS, NON_ADVICE_NOTICE, assertNonAdviceText } from './policy.js';
import { PROBABILITY_STATUS } from './probability.js';
import { QUANT_READINESS_VERDICTS, READINESS_CHECK_STATUS } from './quant-readiness.js';
import { hasUnsafePublicDiagnostics } from './public-diagnostics.js';

export { hasUnsafePublicDiagnostics } from './public-diagnostics.js';

export const PRODUCTION_READINESS_STATUS = Object.freeze({
  BLOCKED: 'production-blocked',
  SAFE_OBSERVATION: 'production-safe-observation',
  LIVE_READY: 'production-live-ready',
});

function checkScore(status, maxScore) {
  if (status === READINESS_CHECK_STATUS.PASS) return maxScore;
  if (status === READINESS_CHECK_STATUS.WATCH) return Math.round(maxScore * 0.5);
  return 0;
}

function buildCheck({ key, label, status, maxScore, evidence, blocker = null, requiredForLive = true }) {
  return {
    key,
    label,
    status,
    score: checkScore(status, maxScore),
    maxScore,
    evidence,
    blocker,
    requiredForLive,
  };
}

function hasFinitePollingInterval(snapshot = {}) {
  return Number.isFinite(snapshot.polling?.intervalMs) && snapshot.polling.intervalMs > 0;
}

function serviceCheck(service = {}) {
  const ok = service.ok === true;
  return buildCheck({
    key: 'service',
    label: 'Service health',
    status: ok ? READINESS_CHECK_STATUS.PASS : READINESS_CHECK_STATUS.FAIL,
    maxScore: 10,
    evidence: ok ? 'API process explicitly reported healthy readiness composition.' : 'API process has not explicitly reported healthy readiness composition.',
    blocker: ok ? null : 'Restore API service health before serving the public dashboard.',
    requiredForLive: true,
  });
}

function sourceCheck(sourceStatus = {}) {
  if (sourceStatus.liveData === true && sourceStatus.freshness === FRESHNESS.FRESH) {
    return buildCheck({
      key: 'approved-live-source',
      label: 'Approved live market source',
      status: READINESS_CHECK_STATUS.PASS,
      maxScore: 20,
      evidence: `${sourceStatus.source ?? 'configured source'} is fresh and approved by the source registry.`,
    });
  }
  const sourceLabel = sourceStatus.label ?? 'No approved live source is configured.';
  const isError = sourceStatus.freshness === FRESHNESS.ERROR || sourceStatus.mode === 'source-error';
  return buildCheck({
    key: 'approved-live-source',
    label: 'Approved live market source',
    status: READINESS_CHECK_STATUS.FAIL,
    maxScore: 20,
    evidence: sourceLabel,
    blocker: isError
      ? 'Fix adapter polling errors and keep public diagnostics sanitized before live readiness.'
      : 'Configure credentials, data-rights approval, endpoint mapping, and a system-owned source registry entry before live readiness.',
  });
}

function probabilityCheck(probability = {}) {
  if (probability.status === PROBABILITY_STATUS.COMPUTED) {
    return buildCheck({
      key: 'probability-inputs',
      label: 'Probability inputs',
      status: READINESS_CHECK_STATUS.PASS,
      maxScore: 15,
      evidence: `Downside probability is computed with ${probability.confidence ?? 'unknown'} confidence.`,
    });
  }
  if (probability.status === PROBABILITY_STATUS.DEGRADED) {
    return buildCheck({
      key: 'probability-inputs',
      label: 'Probability inputs',
      status: READINESS_CHECK_STATUS.WATCH,
      maxScore: 15,
      evidence: 'Downside probability is degraded because one or more inputs are stale or partial.',
      blocker: probability.degradedReasons?.join('; ') ?? 'Resolve degraded probability inputs before live readiness.',
    });
  }
  return buildCheck({
    key: 'probability-inputs',
    label: 'Probability inputs',
    status: READINESS_CHECK_STATUS.FAIL,
    maxScore: 15,
    evidence: 'Downside probability is unavailable.',
    blocker: `Provide fresh KOSPI daily history and baseline-rate provenance. Missing: ${probability.missingInputs?.join(', ') || 'required probability inputs'}.`,
  });
}

function derivativesCheck(derivativesMarket = {}) {
  const coverage = derivativesMarket.coverage ?? { required: { available: 0, total: 0 } };
  const required = coverage.required ?? { available: 0, total: 0 };
  if (derivativesMarket.status === DERIVATIVES_MARKET_STATUS.AVAILABLE) {
    return buildCheck({
      key: 'derivatives-coverage',
      label: 'Live-critical derivatives coverage',
      status: READINESS_CHECK_STATUS.PASS,
      maxScore: 20,
      evidence: `${required.available}/${required.total} live-critical derivatives metrics are fresh.`,
    });
  }
  if (derivativesMarket.status === DERIVATIVES_MARKET_STATUS.PARTIAL || derivativesMarket.status === DERIVATIVES_MARKET_STATUS.STALE) {
    return buildCheck({
      key: 'derivatives-coverage',
      label: 'Live-critical derivatives coverage',
      status: READINESS_CHECK_STATUS.WATCH,
      maxScore: 20,
      evidence: `${required.available}/${required.total} live-critical derivatives metrics are fresh.`,
      blocker: 'Every live-critical derivatives metric must be fresh before live readiness.',
    });
  }
  return buildCheck({
    key: 'derivatives-coverage',
    label: 'Live-critical derivatives coverage',
    status: READINESS_CHECK_STATUS.FAIL,
    maxScore: 20,
    evidence: 'No usable KOSPI200 futures/options coverage is available from the configured adapter.',
    blocker: 'Add approved basis, futures/options open interest and volume, put/call ratio, foreigner flow, and holiday-calendar fields.',
  });
}

function expiryCalendarCheck(expirySettlement = {}, derivativesMarket = {}) {
  const hasRuleBasedWindow = Boolean(expirySettlement.futuresMonthlyFinalTradingDay);
  const holidayCalendar = derivativesMarket.metrics?.find((metric) => metric.key === 'holidayCalendar');
  const holidayCalendarFresh = holidayCalendar?.status === DERIVATIVES_MARKET_STATUS.AVAILABLE;
  const holidayAdjustmentApplied = expirySettlement.holidayAdjustment === 'applied';
  if (hasRuleBasedWindow && holidayCalendarFresh && holidayAdjustmentApplied) {
    return buildCheck({
      key: 'expiry-calendar-application',
      label: 'Expiry holiday calendar application',
      status: READINESS_CHECK_STATUS.PASS,
      maxScore: 15,
      evidence: 'Fresh holiday-calendar provenance is applied to expiry/settlement dates.',
    });
  }
  if (hasRuleBasedWindow) {
    return buildCheck({
      key: 'expiry-calendar-application',
      label: 'Expiry holiday calendar application',
      status: READINESS_CHECK_STATUS.WATCH,
      maxScore: 15,
      evidence: `Rule-based expiry window is present for ${expirySettlement.futuresMonthlyFinalTradingDay}.`,
      blocker: 'Apply a fresh approved holiday calendar to expiry/settlement calculations before live readiness.',
    });
  }
  return buildCheck({
    key: 'expiry-calendar-application',
    label: 'Expiry holiday calendar application',
    status: READINESS_CHECK_STATUS.FAIL,
    maxScore: 15,
    evidence: 'Expiry/settlement calendar output is missing.',
    blocker: 'Restore expiry/settlement calendar output before serving readiness status.',
  });
}

function pollingCheck(snapshot = {}) {
  const pass = hasFinitePollingInterval(snapshot);
  return buildCheck({
    key: 'polling-control',
    label: 'Polling controls',
    status: pass ? READINESS_CHECK_STATUS.PASS : READINESS_CHECK_STATUS.FAIL,
    maxScore: 10,
    evidence: pass ? `Server polling interval is visible at ${snapshot.polling.intervalMs} ms.` : 'Polling metadata is missing.',
    blocker: pass ? null : 'Expose polling interval metadata before public readiness.',
    requiredForLive: true,
  });
}

function guardrailCheck() {
  const pass = MVP_GUARDRAILS.automatedTrading === false
    && MVP_GUARDRAILS.orderRouting === false
    && assertNonAdviceText('Risk context only; no automated execution or order routing.')
    && typeof NON_ADVICE_NOTICE === 'string';
  return buildCheck({
    key: 'non-advice-guardrail',
    label: 'Observation-only guardrails',
    status: pass ? READINESS_CHECK_STATUS.PASS : READINESS_CHECK_STATUS.FAIL,
    maxScore: 10,
    evidence: pass ? 'Observation-only guardrails are enabled.' : 'Observation-only guardrails are not in the safe state.',
    blocker: pass ? null : 'Disable advice or execution features before serving the dashboard.',
    requiredForLive: true,
  });
}

function diagnosticsCheck({ snapshot = {}, sourceStatus = {} } = {}) {
  const unsafe = hasUnsafePublicDiagnostics(snapshot, sourceStatus);
  return buildCheck({
    key: 'public-diagnostics',
    label: 'Public diagnostics safety',
    status: unsafe ? READINESS_CHECK_STATUS.FAIL : READINESS_CHECK_STATUS.PASS,
    maxScore: 10,
    evidence: unsafe ? 'Public diagnostics contain unsafe provider details.' : 'Public diagnostics are stable and sanitized.',
    blocker: unsafe ? 'Remove secrets, private endpoints, stack traces, and raw provider diagnostics from public JSON.' : null,
    requiredForLive: true,
  });
}

function statusFor({ checks, sourceStatus, quantReadiness, probability, derivativesMarket, expirySettlement }) {
  const operationalKeys = new Set(['service', 'polling-control', 'non-advice-guardrail', 'public-diagnostics']);
  const operationalPass = checks
    .filter((check) => operationalKeys.has(check.key))
    .every((check) => check.status === READINESS_CHECK_STATUS.PASS);
  const allLiveRequiredPass = checks
    .filter((check) => check.requiredForLive)
    .every((check) => check.status === READINESS_CHECK_STATUS.PASS);
  const liveReady = allLiveRequiredPass
    && sourceStatus.liveData === true
    && quantReadiness.verdict === QUANT_READINESS_VERDICTS.LIVE_MONITOR_READY
    && probability.status === PROBABILITY_STATUS.COMPUTED
    && derivativesMarket.status === DERIVATIVES_MARKET_STATUS.AVAILABLE
    && expirySettlement.holidayAdjustment === 'applied';
  if (liveReady) return PRODUCTION_READINESS_STATUS.LIVE_READY;
  if (operationalPass && sourceStatus.mode !== 'source-error') return PRODUCTION_READINESS_STATUS.SAFE_OBSERVATION;
  return PRODUCTION_READINESS_STATUS.BLOCKED;
}

function summaryFor(status) {
  if (status === PRODUCTION_READINESS_STATUS.LIVE_READY) {
    return 'Production live-ready: approved source, fresh probability inputs, full derivatives coverage, applied holiday calendar, polling, diagnostics, and guardrails are all passing.';
  }
  if (status === PRODUCTION_READINESS_STATUS.SAFE_OBSERVATION) {
    return 'Production-safe observation shell: service and public guardrails are healthy, but live-market readiness remains blocked until approved fresh market data is configured.';
  }
  return 'Production blocked: one or more operational safety or live-data requirements are failing.';
}

export function buildProductionReadinessAssessment({
  snapshot = {},
  sourceStatus = {},
  quantReadiness = {},
  probability = {},
  derivativesMarket = {},
  expirySettlement = {},
  service = {},
} = {}) {
  const checks = [
    serviceCheck(service),
    sourceCheck(sourceStatus),
    probabilityCheck(probability),
    derivativesCheck(derivativesMarket),
    expiryCalendarCheck(expirySettlement, derivativesMarket),
    pollingCheck(snapshot),
    guardrailCheck(),
    diagnosticsCheck({ snapshot, sourceStatus }),
  ];
  const score = checks.reduce((sum, check) => sum + check.score, 0);
  const maxScore = checks.reduce((sum, check) => sum + check.maxScore, 0);
  const status = statusFor({ checks, sourceStatus, quantReadiness, probability, derivativesMarket, expirySettlement });
  const liveReady = status === PRODUCTION_READINESS_STATUS.LIVE_READY;
  const safeToServe = status !== PRODUCTION_READINESS_STATUS.BLOCKED;
  return {
    status,
    verdict: status,
    liveReady,
    safeToServe,
    score,
    maxScore,
    scorePct: Math.round((score / maxScore) * 100),
    summary: summaryFor(status),
    checks,
    blockers: checks.filter((check) => check.blocker).map((check) => check.blocker),
    strengths: checks.filter((check) => check.status === READINESS_CHECK_STATUS.PASS).map((check) => check.label),
    caveat: 'Production readiness is an operational/data-rights gate, not market direction guidance.',
  };
}
