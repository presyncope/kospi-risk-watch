import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_SEVERITY,
  DERIVATIVES_MARKET_STATUS,
  FRESHNESS,
  PROBABILITY_STATUS,
  buildDerivativesMarketContext,
  buildExpirySettlementRisk,
  buildQuantReadinessAssessment,
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
      historicalMondayDownRate: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
      recentMomentum: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
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
    provenance: {
      kospiDaily: createProvenance({ source: 'mock', observedAt: '2026-06-06T08:00:00Z', freshness: FRESHNESS.STALE }),
      historicalMondayDownRate: createProvenance({ source: 'mock', observedAt: '2026-06-06T08:00:00Z', freshness: FRESHNESS.STALE }),
    },
  });
  assert.equal(probabilityResult.status, PROBABILITY_STATUS.DEGRADED);
  assert.equal(probabilityResult.probability, null);
  assert.ok(probabilityResult.degradedReasons.some((reason) => reason.includes('suppressed')));
  const alerts = buildRiskAlerts({ probabilityResult, thresholds: { probability: 60 } });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'data-quality');
  assert.equal(alerts[0].severity, ALERT_SEVERITY.WATCH);
});

test('probability requires baseline-rate provenance before using derived values', () => {
  const result = computeDownsideProbability({
    historicalMondayDownRate: 0.52,
    recentMomentum: -0.02,
    provenance: {
      kospiDaily: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
    },
  });
  assert.equal(result.status, PROBABILITY_STATUS.UNAVAILABLE);
  assert.equal(result.probability, null);
  assert.ok(result.missingInputs.includes('historicalMondayDownRate'));
});

test('probability rejects non-finite or out-of-range baseline rates', () => {
  for (const invalidRate of [Number.NaN, Number.POSITIVE_INFINITY, '0.52', -0.1, 1.1]) {
    const result = computeDownsideProbability({
      historicalMondayDownRate: invalidRate,
      provenance: {
        kospiDaily: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
        historicalMondayDownRate: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
      },
    });
    assert.equal(result.status, PROBABILITY_STATUS.UNAVAILABLE);
    assert.equal(result.probability, null);
    assert.ok(result.missingInputs.includes('historicalMondayDownRate'));
  }
});

test('probability ignores recent momentum when its provenance is missing', () => {
  const result = computeDownsideProbability({
    historicalMondayDownRate: 0.52,
    recentMomentum: -0.02,
    provenance: {
      kospiDaily: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
      historicalMondayDownRate: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
    },
  });
  assert.equal(result.status, PROBABILITY_STATUS.DEGRADED);
  assert.equal(result.probability, 52);
  assert.ok(result.degradedReasons.some((reason) => reason.includes('recentMomentum')));
  assert.equal(result.contributions.find((item) => item.input === 'recentMomentum').points, 0);
});

test('probability ignores non-finite optional adjustment values', () => {
  const result = computeDownsideProbability({
    historicalMondayDownRate: 0.52,
    recentMomentum: Number.NaN,
    volatilityZScore: 'elevated',
    provenance: {
      kospiDaily: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
      historicalMondayDownRate: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
      recentMomentum: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
      volatility: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
    },
  });
  assert.equal(result.status, PROBABILITY_STATUS.DEGRADED);
  assert.equal(result.probability, 52);
  assert.ok(result.degradedReasons.some((reason) => reason.includes('not finite numeric')));
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
    provenance: {
      kospiDaily: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
      historicalMondayDownRate: createProvenance({ source: 'mock', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
    },
  });
  assert.equal(result.status, PROBABILITY_STATUS.DEGRADED);
  assert.ok(result.degradedReasons.some((reason) => reason.includes('volatilityZScore')));
  assert.equal(result.contributions.find((item) => item.input === 'volatilityZScore').points, 0);
});

test('probability freshness ignores unrelated derivatives provenance', () => {
  const result = computeDownsideProbability({
    historicalMondayDownRate: 0.52,
    recentMomentum: -0.01,
    provenance: {
      kospiDaily: createProvenance({ source: 'approved-source', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
      historicalMondayDownRate: createProvenance({ source: 'approved-source', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
      recentMomentum: createProvenance({ source: 'approved-source', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.FRESH }),
      futuresOpenInterest: createProvenance({ source: 'approved-source', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.UNAVAILABLE }),
      optionsVolume: createProvenance({ source: 'approved-source', observedAt: '2026-06-06T09:00:00Z', freshness: FRESHNESS.ERROR, error: 'provider outage' }),
    },
  });
  assert.equal(result.status, PROBABILITY_STATUS.COMPUTED);
  assert.equal(result.sourceFreshnessSummary.overall, FRESHNESS.FRESH);
  assert.deepEqual(result.sourceFreshnessSummary.fields.map((field) => field.name), ['kospiDaily', 'historicalMondayDownRate', 'recentMomentum']);
});


test('derivatives market context exposes unavailable required metrics without fake values', () => {
  const context = buildDerivativesMarketContext({ snapshot: { source: 'test-placeholder', fields: {}, values: {} }, expirySettlement: { riskLevel: 'normal' } });
  assert.equal(context.status, DERIVATIVES_MARKET_STATUS.UNAVAILABLE);
  assert.equal(context.metrics.length, 8);
  assert.equal(context.coverage.available, 0);
  assert.ok(context.metrics.every((metric) => metric.value == null));
  assert.ok(context.blockers.some((blocker) => blocker.includes('Futures basis')));
});

test('derivatives market context preserves fresh metric provenance', () => {
  const observedAt = '2026-06-06T09:00:00Z';
  const context = buildDerivativesMarketContext({
    snapshot: {
      source: 'mock-market-data',
      fields: {
        futuresBasis: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
        futuresOpenInterest: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
        futuresVolume: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
        optionsOpenInterest: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
        optionsVolume: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
        putCallRatio: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
        foreignerNetFutures: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
        holidayCalendar: createProvenance({ source: 'mock-calendar', observedAt, freshness: FRESHNESS.FRESH }),
      },
      values: {
        futuresBasis: -0.4,
        futuresOpenInterest: 10,
        futuresVolume: 20,
        optionsOpenInterest: 30,
        optionsVolume: 40,
        putCallRatio: 1.2,
        foreignerNetFutures: -5,
        holidayCalendar: 'fixture',
      },
    },
    expirySettlement: { riskLevel: 'normal' },
  });
  assert.equal(context.status, DERIVATIVES_MARKET_STATUS.AVAILABLE);
  assert.equal(context.coverage.available, 8);
  assert.equal(context.coverage.required.available, 8);
  assert.equal(context.metrics.find((metric) => metric.key === 'futuresBasis').source, 'mock-market-data');
});

test('derivatives market context stays partial until every live-critical metric is fresh', () => {
  const observedAt = '2026-06-06T09:00:00Z';
  const fields = {
    futuresBasis: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
    futuresOpenInterest: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
    futuresVolume: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
    optionsOpenInterest: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
    optionsVolume: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
    putCallRatio: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
    foreignerNetFutures: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
  };
  const values = {
    futuresBasis: -0.4,
    futuresOpenInterest: 10,
    futuresVolume: 20,
    optionsOpenInterest: 30,
    optionsVolume: 40,
    putCallRatio: 1.2,
    foreignerNetFutures: -5,
  };
  const context = buildDerivativesMarketContext({ snapshot: { source: 'test-source', fields, values }, expirySettlement: { riskLevel: 'normal' } });
  assert.equal(context.status, DERIVATIVES_MARKET_STATUS.PARTIAL);
  assert.equal(context.coverage.available, 7);
  assert.equal(context.coverage.required.available, 7);
  assert.ok(context.blockers.some((blocker) => blocker.includes('Holiday calendar')));
});

test('derivatives market context rejects invalid numeric metric values', () => {
  const observedAt = '2026-06-06T09:00:00Z';
  const fields = {
    futuresBasis: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
    futuresOpenInterest: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
    futuresVolume: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
    optionsOpenInterest: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
    optionsVolume: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
    putCallRatio: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
    foreignerNetFutures: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
    holidayCalendar: createProvenance({ source: 'test-source', observedAt, freshness: FRESHNESS.FRESH }),
  };
  const context = buildDerivativesMarketContext({
    snapshot: {
      source: 'test-source',
      fields,
      values: {
        futuresBasis: Number.NaN,
        futuresOpenInterest: '10',
        futuresVolume: Number.POSITIVE_INFINITY,
        optionsOpenInterest: 30,
        optionsVolume: 40,
        putCallRatio: 1.2,
        foreignerNetFutures: -5,
        holidayCalendar: 'fixture',
      },
    },
    expirySettlement: { riskLevel: 'normal' },
  });
  assert.equal(context.status, DERIVATIVES_MARKET_STATUS.PARTIAL);
  assert.equal(context.coverage.available, 5);
  assert.equal(context.metrics.find((metric) => metric.key === 'futuresBasis').displayValue, 'Unavailable');
  assert.ok(context.metrics.find((metric) => metric.key === 'futuresOpenInterest').reason.includes('not finite numeric'));
});

test('quant readiness grades unavailable dashboard as operational shell', () => {
  const probability = computeDownsideProbability({ provenance: {} });
  const derivativesMarket = buildDerivativesMarketContext({ snapshot: {}, expirySettlement: { riskLevel: 'normal' } });
  const readiness = buildQuantReadinessAssessment({
    snapshot: { polling: { intervalMs: 300_000 } },
    sourceStatus: { source: 'krx-free-source-placeholder', freshness: FRESHNESS.UNAVAILABLE, liveData: false, mode: 'unavailable-placeholder', label: 'Unavailable placeholder' },
    probability,
    derivativesMarket,
    expirySettlement: buildExpirySettlementRisk({ asOf: utcDate(2026, 5, 6) }),
  });
  assert.equal(readiness.verdict, 'operational-shell');
  assert.ok(readiness.blockers.some((blocker) => blocker.includes('KOSPI')));
  assert.equal(readiness.checks.find((check) => check.key === 'expiry-calendar').status, 'watch');
  assert.ok(readiness.blockers.some((blocker) => blocker.includes('holiday-calendar provenance')));
  assert.ok(readiness.caveat.includes('system completeness'));
});

test('quant readiness can reach analysis-review-ready with mock-quality inputs but not approved-live-monitor-ready', () => {
  const observedAt = '2026-06-06T09:00:00Z';
  const snapshot = {
    source: 'mock-market-data',
    polling: { intervalMs: 60_000 },
    fields: {
      kospiDaily: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
      historicalMondayDownRate: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
      recentMomentum: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
      volatility: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
      futuresBasis: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
      futuresOpenInterest: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
      futuresVolume: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
      optionsOpenInterest: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
      optionsVolume: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
      putCallRatio: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
      foreignerNetFutures: createProvenance({ source: 'mock-market-data', observedAt, freshness: FRESHNESS.FRESH }),
      holidayCalendar: createProvenance({ source: 'mock-calendar', observedAt, freshness: FRESHNESS.FRESH }),
    },
    values: {
      historicalMondayDownRate: 0.53,
      recentMomentum: -0.02,
      volatilityZScore: 1.1,
      futuresBasis: -0.4,
      futuresOpenInterest: 10,
      futuresVolume: 20,
      optionsOpenInterest: 30,
      optionsVolume: 40,
      putCallRatio: 1.2,
      foreignerNetFutures: -5,
      holidayCalendar: 'fixture',
    },
  };
  const expirySettlement = buildExpirySettlementRisk({ asOf: utcDate(2026, 5, 6) });
  const probability = computeDownsideProbability({
    historicalMondayDownRate: snapshot.values.historicalMondayDownRate,
    recentMomentum: snapshot.values.recentMomentum,
    volatilityZScore: snapshot.values.volatilityZScore,
    expiryRiskLevel: expirySettlement.riskLevel,
    provenance: snapshot.fields,
  });
  const derivativesMarket = buildDerivativesMarketContext({ snapshot, expirySettlement });
  const readiness = buildQuantReadinessAssessment({
    snapshot,
    sourceStatus: { source: 'mock-market-data', freshness: FRESHNESS.FRESH, liveData: false, mode: 'mock-fixture' },
    probability,
    derivativesMarket,
    expirySettlement,
  });
  assert.equal(readiness.verdict, 'analysis-review-ready');
  assert.notEqual(readiness.verdict, 'approved-live-monitor-ready');
});


test('quant readiness rejects fresh unknown adapters without explicit approval capabilities', () => {
  const observedAt = '2026-06-06T09:00:00Z';
  const snapshot = {
    source: 'fresh-but-unapproved-source',
    freshness: FRESHNESS.FRESH,
    polling: { intervalMs: 60_000 },
    fields: {
      kospiDaily: createProvenance({ source: 'fresh-but-unapproved-source', observedAt, freshness: FRESHNESS.FRESH }),
      historicalMondayDownRate: createProvenance({ source: 'fresh-but-unapproved-source', observedAt, freshness: FRESHNESS.FRESH }),
      recentMomentum: createProvenance({ source: 'fresh-but-unapproved-source', observedAt, freshness: FRESHNESS.FRESH }),
      volatility: createProvenance({ source: 'fresh-but-unapproved-source', observedAt, freshness: FRESHNESS.FRESH }),
      futuresBasis: createProvenance({ source: 'fresh-but-unapproved-source', observedAt, freshness: FRESHNESS.FRESH }),
      futuresOpenInterest: createProvenance({ source: 'fresh-but-unapproved-source', observedAt, freshness: FRESHNESS.FRESH }),
      futuresVolume: createProvenance({ source: 'fresh-but-unapproved-source', observedAt, freshness: FRESHNESS.FRESH }),
      optionsOpenInterest: createProvenance({ source: 'fresh-but-unapproved-source', observedAt, freshness: FRESHNESS.FRESH }),
      optionsVolume: createProvenance({ source: 'fresh-but-unapproved-source', observedAt, freshness: FRESHNESS.FRESH }),
      putCallRatio: createProvenance({ source: 'fresh-but-unapproved-source', observedAt, freshness: FRESHNESS.FRESH }),
      foreignerNetFutures: createProvenance({ source: 'fresh-but-unapproved-source', observedAt, freshness: FRESHNESS.FRESH }),
      holidayCalendar: createProvenance({ source: 'fresh-but-unapproved-source', observedAt, freshness: FRESHNESS.FRESH }),
    },
    values: {
      historicalMondayDownRate: 0.53,
      recentMomentum: -0.01,
      volatilityZScore: 1,
      futuresBasis: -0.4,
      futuresOpenInterest: 10,
      futuresVolume: 20,
      optionsOpenInterest: 30,
      optionsVolume: 40,
      putCallRatio: 1.2,
      foreignerNetFutures: -5,
      holidayCalendar: 'fixture',
    },
  };
  const expirySettlement = buildExpirySettlementRisk({ asOf: utcDate(2026, 5, 6) });
  const probability = computeDownsideProbability({
    historicalMondayDownRate: snapshot.values.historicalMondayDownRate,
    volatilityZScore: snapshot.values.volatilityZScore,
    expiryRiskLevel: expirySettlement.riskLevel,
    provenance: snapshot.fields,
  });
  const derivativesMarket = buildDerivativesMarketContext({ snapshot, expirySettlement });
  const readiness = buildQuantReadinessAssessment({
    snapshot,
    sourceStatus: { source: snapshot.source, freshness: FRESHNESS.FRESH, liveData: false, mode: 'external-source-unapproved', label: 'External source — not approved for live readiness' },
    probability,
    derivativesMarket,
    expirySettlement,
  });
  assert.equal(readiness.verdict, 'operational-shell');
  assert.ok(readiness.blockers.some((blocker) => blocker.includes('explicit approved')));
});


test('quant readiness blocks live-monitor verdict until holiday data is applied to expiry calculation', () => {
  const observedAt = '2026-06-06T09:00:00Z';
  const snapshot = {
    source: 'approved-live-source',
    polling: { intervalMs: 60_000 },
    fields: {
      kospiDaily: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      historicalMondayDownRate: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      volatility: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      futuresBasis: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      futuresOpenInterest: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      futuresVolume: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      optionsOpenInterest: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      optionsVolume: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      putCallRatio: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      foreignerNetFutures: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      holidayCalendar: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
    },
    values: {
      historicalMondayDownRate: 0.53,
      volatilityZScore: 1,
      futuresBasis: -0.4,
      futuresOpenInterest: 10,
      futuresVolume: 20,
      optionsOpenInterest: 30,
      optionsVolume: 40,
      putCallRatio: 1.2,
      foreignerNetFutures: -5,
      holidayCalendar: 'fixture',
    },
  };
  const expirySettlement = buildExpirySettlementRisk({ asOf: utcDate(2026, 5, 6) });
  const probability = computeDownsideProbability({
    historicalMondayDownRate: snapshot.values.historicalMondayDownRate,
    volatilityZScore: snapshot.values.volatilityZScore,
    expiryRiskLevel: expirySettlement.riskLevel,
    provenance: snapshot.fields,
  });
  const derivativesMarket = buildDerivativesMarketContext({ snapshot, expirySettlement });
  const readiness = buildQuantReadinessAssessment({
    snapshot,
    sourceStatus: { source: snapshot.source, freshness: FRESHNESS.FRESH, liveData: true, mode: 'approved-public-live-source' },
    probability,
    derivativesMarket,
    expirySettlement,
  });
  assert.equal(readiness.checks.find((check) => check.key === 'expiry-calendar').status, 'watch');
  assert.equal(readiness.verdict, 'analysis-review-ready');
  assert.notEqual(readiness.verdict, 'approved-live-monitor-ready');
});

test('quant readiness reaches live-monitor verdict only when all checks pass', () => {
  const observedAt = '2026-06-06T09:00:00Z';
  const snapshot = {
    source: 'approved-live-source',
    polling: { intervalMs: 60_000 },
    fields: {
      kospiDaily: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      historicalMondayDownRate: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      futuresBasis: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      futuresOpenInterest: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      futuresVolume: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      optionsOpenInterest: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      optionsVolume: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      putCallRatio: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      foreignerNetFutures: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
      holidayCalendar: createProvenance({ source: 'approved-live-source', observedAt, freshness: FRESHNESS.FRESH }),
    },
    values: {
      historicalMondayDownRate: 0.53,
      futuresBasis: -0.4,
      futuresOpenInterest: 10,
      futuresVolume: 20,
      optionsOpenInterest: 30,
      optionsVolume: 40,
      putCallRatio: 1.2,
      foreignerNetFutures: -5,
      holidayCalendar: 'approved holiday set',
    },
  };
  const expirySettlement = buildExpirySettlementRisk({ asOf: utcDate(2026, 5, 6), holidays: new Set() });
  const probability = computeDownsideProbability({
    historicalMondayDownRate: snapshot.values.historicalMondayDownRate,
    expiryRiskLevel: expirySettlement.riskLevel,
    provenance: snapshot.fields,
  });
  const derivativesMarket = buildDerivativesMarketContext({ snapshot, expirySettlement });
  const readiness = buildQuantReadinessAssessment({
    snapshot,
    sourceStatus: { source: snapshot.source, freshness: FRESHNESS.FRESH, liveData: true, mode: 'approved-public-live-source' },
    probability,
    derivativesMarket,
    expirySettlement,
  });
  assert.equal(readiness.checks.every((check) => check.status === 'pass'), true);
  assert.equal(readiness.verdict, 'approved-live-monitor-ready');
});
