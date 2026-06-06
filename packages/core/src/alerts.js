import { FRESHNESS } from './freshness.js';
import { PROBABILITY_STATUS } from './probability.js';

export const ALERT_SEVERITY = Object.freeze({
  INFO: 'info',
  WATCH: 'watch',
  HIGH: 'high',
});

export function buildRiskAlerts({ probabilityResult, expiryRisk, thresholds = { probability: 60 } } = {}) {
  const alerts = [];
  if (!probabilityResult || probabilityResult.status === PROBABILITY_STATUS.UNAVAILABLE) {
    alerts.push({
      kind: 'data-quality',
      severity: ALERT_SEVERITY.WATCH,
      message: 'Probability is unavailable because required market inputs are missing.',
      nonAdvice: true,
    });
    return alerts;
  }

  const degraded = probabilityResult.status === PROBABILITY_STATUS.DEGRADED || probabilityResult.sourceFreshnessSummary?.overall !== FRESHNESS.FRESH;
  if (degraded) {
    alerts.push({
      kind: 'data-quality',
      severity: ALERT_SEVERITY.WATCH,
      message: 'Inputs are degraded or stale; interpret risk context with caution.',
      nonAdvice: true,
    });
    return alerts;
  }

  if (probabilityResult.probability >= thresholds.probability) {
    alerts.push({
      kind: 'market-risk',
      severity: ALERT_SEVERITY.HIGH,
      message: `Monday downside probability is above the ${thresholds.probability}% monitoring threshold.`,
      threshold: thresholds.probability,
      value: probabilityResult.probability,
      nonAdvice: true,
    });
  }

  if (expiryRisk?.riskLevel === 'high') {
    alerts.push({
      kind: 'expiry-settlement-risk',
      severity: ALERT_SEVERITY.WATCH,
      message: 'KOSPI200 expiry-settlement window is near; monitor freshness and settlement context.',
      nonAdvice: true,
    });
  }

  return alerts;
}
