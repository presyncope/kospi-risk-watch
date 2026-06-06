import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_SEVERITY,
  FRESHNESS,
  PROBABILITY_STATUS,
  buildExpirySettlementRisk,
  buildRiskAlerts,
  classifyFreshness,
  computeDownsideProbability,
  createProvenance,
  normalizePollingConfig,
  secondThursday,
  summarizeFreshness,
  utcDate,
} from '../packages/core/src/index.js';

test('freshness classification distinguishes fresh, stale, unavailable, and error', () => {
  const now = new Date('2026-06-06T09:00:00Z');
  assert.equal(classifyFreshness({ observedAt: '2026-06-06T08:59:00Z', now }), FRESHNESS.FRESH);
  assert.equal(classifyFreshness({ observedAt: '2026-06-06T08:00:00Z', now }), FRESHNESS.STALE);
  assert.equal(classifyFreshness({ now }), FRESHNESS.UNAVAILABLE);
  assert.equal(classifyFreshness({ observedAt: now, now, error: 'boom' }), FRESHNESS.ERROR);
});

test('freshness summary preserves field-level provenance', () => {
  const summary = summarizeFreshness({
    kospiDaily: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
    expiryCalendar: createProvenance({ source: 'calendar', freshness: FRESHNESS.STALE }),
  });
  assert.equal(summary.overall, FRESHNESS.STALE);
  assert.equal(summary.fields.length, 2);
  assert.equal(summary.fields[0].source, 'mock');
});

test('polling config clamps unsafe intervals', () => {
  assert.equal(normalizePollingConfig({ intervalMs: 1 }).intervalMs, 30_000);
  assert.equal(normalizePollingConfig({ intervalMs: 99 * 60_000 }).intervalMs, 30 * 60_000);
  assert.equal(normalizePollingConfig({ active: false }).active, false);
});

test('KOSPI200 monthly expiry helper computes second Thursday and settlement', () => {
  assert.equal(secondThursday(2026, 5).toISOString().slice(0, 10), '2026-06-11');
  const risk = buildExpirySettlementRisk({ asOf: utcDate(2026, 5, 10) });
  assert.equal(risk.futuresMonthlyFinalTradingDay, '2026-06-11');
  assert.equal(risk.futuresMonthlyFinalSettlementDay, '2026-06-12');
  assert.equal(risk.riskLevel, 'high');
});

test('probability is unavailable without required inputs', () => {
  const result = computeDownsideProbability({ provenance: {} });
  assert.equal(result.status, PROBABILITY_STATUS.UNAVAILABLE);
  assert.equal(result.probability, null);
  assert.ok(result.missingInputs.includes('kospiDaily'));
});

test('probability computes transparent contribution list when inputs are fresh', () => {
  const result = computeDownsideProbability({
    historicalMondayDownRate: 0.52,
    recentMomentum: -0.03,
    volatilityZScore: 1.2,
    expiryRiskLevel: 'elevated',
    provenance: {
      kospiDaily: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
      volatility: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
    },
  });
  assert.equal(result.status, PROBABILITY_STATUS.COMPUTED);
  assert.equal(result.confidence, 'medium');
  assert.ok(result.probability > 52);
  assert.ok(result.contributions.length >= 3);
});

test('stale probability becomes degraded and data-quality alert suppresses precise market-risk alert', () => {
  const probabilityResult = computeDownsideProbability({
    historicalMondayDownRate: 0.8,
    provenance: { kospiDaily: createProvenance({ source: 'mock', observedAt: '2026-06-06T08:00:00Z', freshness: FRESHNESS.STALE }) },
  });
  assert.equal(probabilityResult.status, PROBABILITY_STATUS.DEGRADED);
  const alerts = buildRiskAlerts({ probabilityResult, thresholds: { probability: 60 } });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'data-quality');
  assert.equal(alerts[0].severity, ALERT_SEVERITY.WATCH);
});


test('KOSPI200 monthly expiry rolls forward after settlement window passes', () => {
  const risk = buildExpirySettlementRisk({ asOf: utcDate(2026, 5, 15) });
  assert.equal(risk.futuresMonthlyFinalTradingDay, '2026-07-09');
  assert.equal(risk.futuresMonthlyFinalSettlementDay, '2026-07-10');
  assert.equal(risk.settlementBasis, 'rule-based estimate; holiday calendar unavailable');
  assert.ok(risk.daysToMonthlyFinalTrading > 0);
});

test('probability degrades and ignores optional volatility value without provenance', () => {
  const result = computeDownsideProbability({
    historicalMondayDownRate: 0.52,
    volatilityZScore: 2,
    provenance: { kospiDaily: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }) },
  });
  assert.equal(result.status, PROBABILITY_STATUS.DEGRADED);
  assert.ok(result.degradedReasons.some((reason) => reason.includes('volatilityZScore')));
  assert.equal(result.contributions.find((item) => item.input === 'volatilityZScore').points, 0);
});
