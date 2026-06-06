import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../apps/api/src/server.js';
import { createMockMarketDataAdapter, createUnavailableAdapter } from '../packages/data-adapters/src/index.js';

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
      throw new Error('forced adapter exception');
    },
  };
  await withServer(createAppServer({ adapter }), async (baseUrl) => {
    const snapshot = await (await fetch(`${baseUrl}/api/snapshot?force=true`)).json();
    assert.equal(snapshot.freshness, 'error');
    assert.equal(snapshot.error, 'forced adapter exception');
    const dashboard = await (await fetch(`${baseUrl}/api/dashboard`)).json();
    assert.equal(dashboard.sourceStatus.freshness, 'error');
    assert.equal(dashboard.sourceStatus.error, 'forced adapter exception');
    assert.equal(dashboard.sourceFreshnessSummary.overall, 'error');
    assert.ok(dashboard.sourceFreshnessSummary.fields.some((field) => field.name === 'adapter' && field.error === 'forced adapter exception'));
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
