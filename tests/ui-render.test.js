import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.listeners = new Map();
    this.className = '';
    this.value = '';
    this.attributes = new Map();
    this._textContent = '';
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  get textContent() {
    return `${this._textContent}${this.children.map((child) => child.textContent).join('')}`;
  }

  replaceChildren(...children) {
    this._textContent = '';
    this.children = children;
  }

  append(...children) {
    this.children.push(...children);
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  async trigger(type) {
    for (const handler of this.listeners.get(type) ?? []) {
      await handler({ target: this });
    }
  }

  querySelector(selector) {
    if (selector.startsWith('#')) return findById(this, selector.slice(1));
    return this.children.find((child) => child.tagName === selector.toLowerCase()) ?? null;
  }
}

function findById(node, id) {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function installFakeDocument() {
  const bySelector = new Map();
  for (const id of [
    'polling-interval',
    'refresh',
    'polling-state',
    'probability-value',
    'probability-status',
    'probability-meta',
    'probability-contributions',
    'expiry-meta',
    'source-status',
    'freshness-list',
    'alerts-list',
  ]) {
    const element = new FakeElement(id === 'polling-interval' ? 'select' : 'div');
    element.id = id;
    bySelector.set(`#${id}`, element);
  }

  globalThis.document = {
    currentScript: { src: 'https://nukim.dyndns.org/kospi-risk-watch/src/main.js' },
    querySelector(selector) {
      return bySelector.get(selector) ?? null;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
  return bySelector;
}

function jsonResponse(body) {
  return { json: async () => body };
}

const dashboardFixture = Object.freeze({
  snapshot: { polling: { intervalMs: 60_000 } },
  sourceStatus: {
    source: 'mock-market-data',
    freshness: 'fresh',
    mode: 'mock-fixture',
    liveData: false,
    label: 'Mock fixture — not live market data',
    message: 'Deterministic mock data for local development and tests.',
    error: null,
  },
  sourceFreshnessSummary: {
    overall: 'fresh',
    fields: [
      { name: 'kospiDaily', freshness: 'fresh', source: 'mock-market-data', observedAt: '2026-06-06T09:00:00Z' },
      { name: 'derivativesCalendar', freshness: 'fresh', source: 'krx-calendar-rules', observedAt: '2026-06-06T09:00:00Z' },
    ],
  },
  probability: {
    status: 'degraded',
    probability: 62.4,
    confidence: 'low',
    formula: 'baseline plus transparent adjustments.',
    missingInputs: [],
    degradedReasons: ['fixture degraded display check'],
    sourceFreshnessSummary: { overall: 'stale' },
    contributions: [
      { input: 'historicalMondayDownRate', points: 53, note: 'Baseline Monday decline frequency.' },
      { input: 'volatilityZScore', points: 4.4, note: 'Elevated volatility marker.' },
    ],
  },
  expirySettlement: {
    asOf: '2026-06-10',
    futuresMonthlyFinalTradingDay: '2026-06-11',
    futuresMonthlyFinalSettlementDay: '2026-06-12',
    weeklyOptionExpiries: { monday: '2026-06-08', thursday: '2026-06-11' },
    riskLevel: 'high',
    holidayAdjustment: 'none',
    explanation: 'Monthly KOSPI200 expiry-settlement window is near.',
  },
  alerts: [
    { kind: 'market-risk', severity: 'high', message: 'Monitoring threshold crossed.' },
  ],
});

test('UI module renders dashboard state and polling control with mocked APIs', async () => {
  const elements = installFakeDocument();
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    if (String(url) === '/kospi-risk-watch/api/polling' && options.method === 'POST') {
      return jsonResponse({ intervalMs: JSON.parse(options.body).intervalMs, active: true });
    }
    if (String(url) === '/kospi-risk-watch/api/polling') return jsonResponse({ intervalMs: 60_000, active: true });
    if (String(url).startsWith('/kospi-risk-watch/api/dashboard')) return jsonResponse(dashboardFixture);
    throw new Error(`unexpected URL ${url}`);
  };

  const moduleUrl = `${pathToFileURL(process.cwd())}/apps/web/src/main.js?test=${Date.now()}`;
  await import(moduleUrl);

  assert.equal(elements.get('#polling-interval').value, '60000');
  assert.match(elements.get('#polling-state').textContent, /Active · 60s interval/);
  assert.equal(elements.get('#probability-value').textContent, '~62%');
  assert.match(elements.get('#probability-status').className, /status-degraded/);
  assert.match(elements.get('#probability-meta').textContent, /fixture degraded display check/);
  assert.match(elements.get('#source-status').textContent, /Mock fixture/);
  assert.match(elements.get('#source-status').textContent, /not live data/);
  assert.match(elements.get('#source-status').textContent, /Deterministic mock data/);
  assert.match(elements.get('#probability-contributions').textContent, /historicalMondayDownRate/);
  assert.match(elements.get('#expiry-meta').textContent, /2026-06-11/);
  assert.equal(elements.get('#freshness-list').children.length, 2);
  assert.match(elements.get('#alerts-list').textContent, /Monitoring threshold crossed/);

  elements.get('#polling-interval').value = '300000';
  await elements.get('#polling-interval').trigger('change');
  assert.ok(fetchCalls.some((call) => call.url === '/kospi-risk-watch/api/polling' && call.options.method === 'POST'));
  assert.ok(fetchCalls.some((call) => call.url === '/kospi-risk-watch/api/dashboard?force=true'));
});


test('UI module renders source error in data-quality panel', async () => {
  const elements = installFakeDocument();
  globalThis.fetch = async (url) => {
    if (String(url) === '/kospi-risk-watch/api/polling') return jsonResponse({ intervalMs: 300_000, active: true });
    if (String(url).startsWith('/kospi-risk-watch/api/dashboard')) {
      return jsonResponse({
        ...dashboardFixture,
        sourceStatus: {
          source: 'throwing-test-adapter',
          freshness: 'error',
          mode: 'external-source',
          liveData: false,
          label: 'Configured external source',
          message: 'Adapter polling failed.',
          error: 'forced adapter exception',
        },
        sourceFreshnessSummary: {
          overall: 'error',
          fields: [{ name: 'adapter', freshness: 'error', source: 'throwing-test-adapter', observedAt: '2026-06-06T09:00:00Z', error: 'forced adapter exception' }],
        },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const moduleUrl = `${pathToFileURL(process.cwd())}/apps/web/src/main.js?test=source-error-${Date.now()}`;
  await import(moduleUrl);

  assert.match(elements.get('#source-status').className, /status-error/);
  assert.match(elements.get('#source-status').textContent, /forced adapter exception/);
  assert.match(elements.get('#freshness-list').textContent, /adapter/);
  assert.match(elements.get('#freshness-list').textContent, /error/);
});
