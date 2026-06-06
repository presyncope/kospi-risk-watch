import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAppServer } from '../apps/api/src/server.js';
import { createMockMarketDataAdapter } from '../packages/data-adapters/src/index.js';
import { NON_ADVICE_NOTICE } from '../packages/core/src/index.js';

async function withServer(server, fn) {
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('dashboard HTML exposes required MVP panels and guardrails', async () => {
  const html = await readFile('apps/web/index.html', 'utf8');
  for (const id of [
    'non-advice',
    'polling-interval',
    'refresh',
    'polling-state',
    'probability-value',
    'probability-status',
    'probability-meta',
    'probability-contributions',
    'quant-readiness',
    'quant-readiness-score',
    'quant-readiness-verdict',
    'quant-readiness-summary',
    'quant-readiness-meta',
    'quant-readiness-checks',
    'quant-readiness-blockers',
    'production-readiness',
    'production-readiness-score',
    'production-readiness-status',
    'production-readiness-summary',
    'production-readiness-meta',
    'production-readiness-checks',
    'production-readiness-blockers',
    'source-status',
    'expiry-meta',
    'derivatives-market',
    'derivatives-market-summary',
    'derivatives-market-list',
    'freshness-list',
    'alerts-list',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.ok(html.includes(NON_ADVICE_NOTICE));
  assert.match(html, /automated trading/);
  assert.match(html, /KOSPI200 expiry-settlement/);
  assert.match(html, /Senior quant assessment/);
  assert.match(html, /Production readiness/);
  assert.match(html, /Derivatives market coverage/);
});

test('dashboard HTML only contains observation controls, not execution controls', async () => {
  const html = await readFile('apps/web/index.html', 'utf8');
  const buttonLabels = [...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1].trim());
  assert.deepEqual(buttonLabels, ['Refresh now']);
  assert.doesNotMatch(html, /<form\b/i);
  assert.doesNotMatch(html, /type="submit"/i);
  assert.doesNotMatch(html, /data-order/i);
  assert.doesNotMatch(html, /order-entry/i);
});

test('local server serves dashboard static assets', async () => {
  await withServer(createAppServer({ adapter: createMockMarketDataAdapter() }), async (baseUrl) => {
    const htmlResponse = await fetch(`${baseUrl}/`);
    const html = await htmlResponse.text();
    assert.equal(htmlResponse.status, 200);
    assert.match(htmlResponse.headers.get('content-type'), /text\/html/);
    assert.match(html, /probability-value/);

    const scriptResponse = await fetch(`${baseUrl}/src/main.js`);
    const script = await scriptResponse.text();
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers.get('content-type'), /javascript/);
    assert.match(script, /loadDashboard/);
  });
});


test('dashboard HTML uses relative assets for reverse-proxy subpaths', async () => {
  const html = await readFile('apps/web/index.html', 'utf8');
  assert.match(html, /href="\.\/src\/styles\.css"/);
  assert.match(html, /src="\.\/src\/main\.js"/);
  assert.doesNotMatch(html, /href="\/src\/styles\.css"/);
  assert.doesNotMatch(html, /src="\/src\/main\.js"/);
});
