import test from 'node:test';
import assert from 'node:assert/strict';
import { NON_ADVICE_NOTICE, MVP_GUARDRAILS, assertNonAdviceText } from '../packages/core/src/index.js';
import { createUnavailableAdapter, ADAPTER_STATUSES } from '../packages/data-adapters/src/index.js';

test('central MVP guardrails disable prohibited features', () => {
  assert.equal(MVP_GUARDRAILS.automatedTrading, false);
  assert.equal(MVP_GUARDRAILS.orderRouting, false);
  assert.equal(MVP_GUARDRAILS.paidOrClosedData, false);
  assert.equal(MVP_GUARDRAILS.productionDeployment, false);
  assert.equal(MVP_GUARDRAILS.complexMachineLearning, false);
});

test('non-advice notice is present and intentionally descriptive', () => {
  assert.match(NON_ADVICE_NOTICE, /decision-support/);
  assert.match(NON_ADVICE_NOTICE, /responsibility rest with the user/);
  assert.equal(assertNonAdviceText('Risk threshold crossed; review freshness before acting.'), true);
});

test('unconfigured data adapter reports unavailable rather than fake live data', async () => {
  const adapter = createUnavailableAdapter('test-source');
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.freshness, ADAPTER_STATUSES.UNAVAILABLE);
  assert.equal(snapshot.source, 'test-source');
});
