import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../apps/api/src/server.js';
import { FRESHNESS } from '../packages/core/src/index.js';
import { createMockMarketDataAdapter, createUnavailableAdapter, normalizeAdapterResult } from '../packages/data-adapters/src/index.js';

async function withServer(server, fn) {
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('backend returns normalized unavailable snapshot by default adapter', async () => {
  await withServer(createAppServer({ adapter: createUnavailableAdapter('test-unavailable') }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/snapshot?force=true`);
    const body = await response.json();
    assert.equal(body.freshness, 'unavailable');
    assert.equal(body.fields.kospiDaily.freshness, 'unavailable');
    assert.equal(body.polling.intervalMs, 300_000);
  });
});

test('backend polling interval can be updated and clamped', async () => {
  await withServer(createAppServer({ adapter: createMockMarketDataAdapter() }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/polling`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intervalMs: 1 }),
    });
    const body = await response.json();
    assert.equal(body.intervalMs, 30_000);
    const snapshot = await (await fetch(`${baseUrl}/api/snapshot?force=true`)).json();
    assert.equal(snapshot.polling.intervalMs, 30_000);
  });
});

test('dashboard endpoint composes probability, expiry risk, and alerts from mock data', async () => {
  await withServer(createAppServer({ adapter: createMockMarketDataAdapter() }), async (baseUrl) => {
    const body = await (await fetch(`${baseUrl}/api/dashboard?force=true`)).json();
    assert.equal(body.probability.status, 'computed');
    assert.ok(body.probability.probability > 0);
    assert.ok(body.expirySettlement.futuresMonthlyFinalTradingDay);
    assert.equal(body.derivativesMarket.status, 'available');
    assert.equal(body.derivativesMarket.coverage.available, 8);
    assert.equal(body.quantReadiness.verdict, 'analysis-review-ready');
    assert.ok(body.quantReadiness.blockers.some((blocker) => blocker.includes('approved free/public')));
    assert.ok(Array.isArray(body.alerts));
  });
});


test('backend degrades dashboard state when adapter data is stale', async () => {
  await withServer(createAppServer({ adapter: createMockMarketDataAdapter({ stale: true }) }), async (baseUrl) => {
    const body = await (await fetch(`${baseUrl}/api/dashboard?force=true`)).json();
    assert.equal(body.probability.status, 'degraded');
    assert.equal(body.sourceFreshnessSummary.overall, 'stale');
    assert.equal(body.alerts[0].kind, 'data-quality');
  });
});

test('backend normalizes adapter exceptions into error snapshots', async () => {
  const adapter = {
    source: 'throwing-test-adapter',
    async getSnapshot() {
      throw new Error('forced adapter exception SECRET_TOKEN=abc123');
    },
  };
  await withServer(createAppServer({ adapter }), async (baseUrl) => {
    const snapshot = await (await fetch(`${baseUrl}/api/snapshot?force=true`)).json();
    assert.equal(snapshot.freshness, 'error');
    assert.equal(snapshot.error, 'adapter_polling_failed');
    assert.doesNotMatch(JSON.stringify(snapshot), /SECRET_TOKEN|abc123|forced adapter exception/);
    const dashboard = await (await fetch(`${baseUrl}/api/dashboard`)).json();
    assert.equal(dashboard.sourceStatus.freshness, 'error');
    assert.equal(dashboard.sourceStatus.error, 'adapter_polling_failed');
    assert.equal(dashboard.sourceStatus.mode, 'source-error');
    assert.equal(dashboard.sourceFreshnessSummary.overall, 'error');
    assert.ok(dashboard.sourceFreshnessSummary.fields.some((field) => field.name === 'adapter' && field.error === 'adapter_polling_failed'));
    assert.doesNotMatch(JSON.stringify(dashboard), /SECRET_TOKEN|abc123|forced adapter exception/);
    assert.equal(dashboard.probability.status, 'unavailable');
    assert.equal(dashboard.alerts[0].kind, 'data-quality');
  });
});


test('backend returns 400 for malformed polling JSON', async () => {
  await withServer(createAppServer({ adapter: createMockMarketDataAdapter() }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/polling`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad-json',
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error, 'invalid_json_body');
  });
});

test('backend returns 413 for oversized polling JSON', async () => {
  await withServer(createAppServer({ adapter: createMockMarketDataAdapter() }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/polling`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(70_000) }),
    });
    const body = await response.json();
    assert.equal(response.status, 413);
    assert.equal(body.error, 'request_body_too_large');
  });
});


test('dashboard endpoint exposes readiness blockers and derivative placeholders when source is unavailable', async () => {
  await withServer(createAppServer({ adapter: createUnavailableAdapter('test-unavailable') }), async (baseUrl) => {
    const body = await (await fetch(`${baseUrl}/api/dashboard?force=true`)).json();
    assert.equal(body.sourceStatus.liveData, false);
    assert.equal(body.probability.status, 'unavailable');
    assert.equal(body.derivativesMarket.status, 'unavailable');
    assert.equal(body.derivativesMarket.metrics.length, 8);
    assert.ok(body.derivativesMarket.metrics.every((metric) => metric.value === null));
    assert.equal(body.quantReadiness.verdict, 'operational-shell');
    assert.ok(body.quantReadiness.blockers.some((blocker) => blocker.includes('KOSPI')));
  });
});

test('dashboard endpoint keeps readiness and derivative rows available during adapter errors', async () => {
  const adapter = {
    source: 'throwing-test-adapter',
    async getSnapshot() {
      throw new Error('forced adapter exception SECRET_TOKEN=def456');
    },
  };
  await withServer(createAppServer({ adapter }), async (baseUrl) => {
    const body = await (await fetch(`${baseUrl}/api/dashboard?force=true`)).json();
    assert.equal(body.sourceStatus.freshness, 'error');
    assert.equal(body.sourceStatus.error, 'adapter_polling_failed');
    assert.equal(body.derivativesMarket.metrics.length, 8);
    assert.equal(body.quantReadiness.verdict, 'operational-shell');
    assert.ok(body.quantReadiness.blockers.length >= 2);
  });
});


test('dashboard endpoint refuses live readiness for fresh adapters without explicit approval capabilities', async () => {
  const observedAt = '2026-06-06T09:00:00Z';
  const adapter = {
    source: 'fresh-but-unapproved-source',
    async getSnapshot() {
      return normalizeAdapterResult({
        source: this.source,
        observedAt,
        freshness: FRESHNESS.FRESH,
        fields: {
          kospiDaily: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          volatility: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          futuresBasis: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          futuresOpenInterest: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          futuresVolume: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          optionsOpenInterest: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          optionsVolume: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          putCallRatio: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          foreignerNetFutures: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          holidayCalendar: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
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
      });
    },
  };
  await withServer(createAppServer({ adapter }), async (baseUrl) => {
    const body = await (await fetch(`${baseUrl}/api/dashboard?force=true`)).json();
    assert.equal(body.sourceStatus.liveData, false);
    assert.equal(body.sourceStatus.mode, 'external-source-unapproved');
    assert.equal(body.quantReadiness.verdict, 'operational-shell');
    assert.ok(body.quantReadiness.blockers.some((blocker) => blocker.includes('explicit approved')));
  });
});


test('dashboard endpoint requires documented source approval before live readiness', async () => {
  const observedAt = '2026-06-06T09:00:00Z';
  const adapter = {
    source: 'fresh-live-flags-but-undocumented-source',
    async getSnapshot() {
      return normalizeAdapterResult({
        source: this.source,
        observedAt,
        freshness: FRESHNESS.FRESH,
        capabilities: { liveMarketData: true, approvedPublic: true, readinessAllowed: true },
        fields: {
          kospiDaily: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          futuresBasis: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          futuresOpenInterest: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          futuresVolume: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          optionsOpenInterest: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          optionsVolume: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          putCallRatio: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          foreignerNetFutures: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
          holidayCalendar: { source: this.source, observedAt, freshness: FRESHNESS.FRESH },
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
          holidayCalendar: 'fixture',
        },
      });
    },
  };
  await withServer(createAppServer({ adapter }), async (baseUrl) => {
    const body = await (await fetch(`${baseUrl}/api/dashboard?force=true`)).json();
    assert.equal(body.sourceStatus.liveData, false);
    assert.equal(body.sourceStatus.approval, 'unapproved');
    assert.equal(body.quantReadiness.verdict, 'operational-shell');
  });
});

test('force refresh is rate-limited to avoid repeated public adapter polling', async () => {
  let calls = 0;
  const adapter = {
    source: 'counting-mock',
    async getSnapshot() {
      calls += 1;
      return normalizeAdapterResult({
        source: this.source,
        observedAt: new Date().toISOString(),
        freshness: FRESHNESS.FRESH,
        capabilities: { mock: true, sourceApproval: 'mock-fixture' },
        fields: { kospiDaily: { source: this.source, freshness: FRESHNESS.FRESH } },
        values: { historicalMondayDownRate: 0.5 },
      });
    },
  };
  await withServer(createAppServer({ adapter, pollingConfig: { intervalMs: 30_000 } }), async (baseUrl) => {
    const first = await (await fetch(`${baseUrl}/api/snapshot?force=true`)).json();
    await fetch(`${baseUrl}/api/polling`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intervalMs: 300_000 }),
    });
    const second = await (await fetch(`${baseUrl}/api/snapshot?force=true`)).json();
    assert.equal(calls, 1);
    assert.equal(first.polling.forceRefreshLimited, undefined);
    assert.equal(second.polling.forceRefreshLimited, true);
    assert.equal(second.polling.intervalMs, 300_000);
  });
});
