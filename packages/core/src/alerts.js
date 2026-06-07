import { FRESHNESS } from './freshness.js';
import { PROBABILITY_STATUS } from './probability.js';
import { INVERSE_STANCES } from './inverse-signal.js';

export const ALERT_SEVERITY = Object.freeze({
  INFO: 'info',
  WATCH: 'watch',
  HIGH: 'high',
});

export function buildRiskAlerts({
  probabilityResult,
  expiryRisk,
  inverseSignal = null,
  volatilityZScore = null,
  thresholds = { volatilityZScore: 1.5, intradayDropPct: -1.5 },
} = {}) {
  const alerts = [];
  if (!probabilityResult || probabilityResult.status === PROBABILITY_STATUS.UNAVAILABLE) {
    alerts.push({
      kind: 'data-quality',
      severity: ALERT_SEVERITY.WATCH,
      message: '필수 입력이 없어 하락 확률을 계산할 수 없습니다.',
      nonAdvice: true,
    });
    return alerts;
  }

  const degraded = probabilityResult.status === PROBABILITY_STATUS.DEGRADED || probabilityResult.sourceFreshnessSummary?.overall !== FRESHNESS.FRESH;
  if (degraded) {
    alerts.push({
      kind: 'data-quality',
      severity: ALERT_SEVERITY.WATCH,
      message: '입력 데이터가 제한적/오래되어 신호를 주의해서 해석하세요.',
      nonAdvice: true,
    });
    return alerts;
  }

  if (inverseSignal?.stance === INVERSE_STANCES.ENTER) {
    alerts.push({
      kind: 'inverse-entry',
      severity: ALERT_SEVERITY.HIGH,
      message: `인버스 진입 우위 구간 도달 (신호 강도 ${inverseSignal.signalStrength}).`,
      value: inverseSignal.signalStrength,
      nonAdvice: true,
    });
  } else if (inverseSignal?.stance === INVERSE_STANCES.SCALE_IN) {
    alerts.push({
      kind: 'inverse-entry',
      severity: ALERT_SEVERITY.WATCH,
      message: `인버스 분할 진입 검토 구간 (신호 강도 ${inverseSignal.signalStrength}).`,
      value: inverseSignal.signalStrength,
      nonAdvice: true,
    });
  }

  if (Number.isFinite(inverseSignal?.intradayChangePct) && inverseSignal.intradayChangePct <= thresholds.intradayDropPct) {
    alerts.push({
      kind: 'market-drop',
      severity: ALERT_SEVERITY.HIGH,
      message: `지수 당일 급락 (${inverseSignal.intradayChangePct}%).`,
      value: inverseSignal.intradayChangePct,
      nonAdvice: true,
    });
  }

  if (Number.isFinite(volatilityZScore) && volatilityZScore >= thresholds.volatilityZScore) {
    alerts.push({
      kind: 'volatility',
      severity: ALERT_SEVERITY.WATCH,
      message: `변동성 확대 (z ${Math.round(volatilityZScore * 100) / 100}).`,
      value: volatilityZScore,
      nonAdvice: true,
    });
  }

  if (expiryRisk?.riskLevel === 'high' || expiryRisk?.riskLevel === 'elevated') {
    alerts.push({
      kind: 'expiry-settlement',
      severity: ALERT_SEVERITY.WATCH,
      message: 'KOSPI200 만기·결제 구간이 임박했습니다. 신선도와 결제 맥락을 확인하세요.',
      nonAdvice: true,
    });
  }

  return alerts;
}
