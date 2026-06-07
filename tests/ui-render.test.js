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
    this.style = {
      properties: new Map(),
      setProperty(name, value) {
        this.properties.set(name, String(value));
      },
      getPropertyValue(name) {
        return this.properties.get(name) ?? '';
      },
    };
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

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
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
    'probability-gauge',
    'probability-value',
    'probability-status',
    'probability-meta',
    'probability-contributions',
    'quant-readiness-gauge',
    'quant-readiness-score',
    'quant-readiness-verdict',
    'quant-readiness-summary',
    'quant-readiness-meta',
    'quant-readiness-checks',
    'quant-readiness-blockers',
    'production-readiness-gauge',
    'production-readiness-score',
    'production-readiness-status',
    'production-readiness-summary',
    'production-readiness-meta',
    'production-readiness-checks',
    'production-readiness-blockers',
    'expiry-meta',
    'derivatives-market-summary',
    'derivatives-market-list',
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

function installFakeTimers() {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled = [];
  globalThis.setTimeout = (handler, delay) => {
    const timer = {
      handler,
      delay,
      cleared: false,
      unrefCalled: false,
      unref() {
        this.unrefCalled = true;
      },
    };
    scheduled.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    if (timer) timer.cleared = true;
  };
  return {
    scheduled,
    restore() {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
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
  derivativesMarket: {
    status: 'partial',
    summary: '2/8 derivatives market metrics available; expiry calendar status is high.',
    coverage: { total: 8, available: 2, stale: 0, unavailable: 6, error: 0, ratio: 0.25 },
    metrics: [
      { key: 'futuresBasis', label: 'Futures basis', status: 'available', displayValue: '-0.42 pt', source: 'mock-market-data', observedAt: '2026-06-06T09:00:00Z', reason: 'Mock fixture; not live market data.' },
      { key: 'futuresOpenInterest', label: 'Futures open interest', status: 'unavailable', displayValue: 'Unavailable', source: 'krx-free-source-placeholder', observedAt: null, reason: 'Adapter did not provide this metric.' },
    ],
  },
  quantReadiness: {
    score: 70,
    maxScore: 100,
    scorePct: 70,
    verdict: 'analysis-review-ready',
    summary: 'Analysis review ready: system logic and fixture/partial inputs can be reviewed, but this is not live market readiness.',
    caveat: 'This readiness score evaluates dashboard data/system completeness only; it is not market direction guidance.',
    strengths: ['Downside probability calculation', 'Expiry and settlement calendar'],
    blockers: ['Replace mock fixture with an approved free/public adapter before live-monitor readiness.'],
    checks: [
      { key: 'source', label: 'Market data source', status: 'watch', score: 10, maxScore: 20, evidence: 'Mock fixture is available for verification only.' },
      { key: 'probability', label: 'Downside probability calculation', status: 'pass', score: 20, maxScore: 20, evidence: 'Probability is computed.' },
    ],
  },
  productionReadiness: {
    status: 'production-safe-observation',
    verdict: 'production-safe-observation',
    liveReady: false,
    safeToServe: true,
    score: 55,
    maxScore: 100,
    scorePct: 55,
    summary: 'Production-safe observation shell; live readiness remains blocked until approved market data is configured.',
    caveat: 'Production readiness is an operational/data-rights gate, not market direction guidance.',
    blockers: ['Configure credentials, data-rights approval, endpoint mapping, and a system-owned source registry entry before live readiness.'],
    checks: [
      { key: 'service', label: 'Service health', status: 'pass', score: 10, maxScore: 10, evidence: 'API process is responding.' },
      { key: 'approved-live-source', label: 'Approved live market source', status: 'fail', score: 0, maxScore: 20, evidence: 'Mock fixture is not live data.' },
    ],
  },
  alerts: [
    { kind: 'market-risk', severity: 'high', message: 'Monitoring threshold crossed.' },
  ],
});

test('UI module renders dashboard state and polling control with mocked APIs', async () => {
  const elements = installFakeDocument();
  const timers = installFakeTimers();
  const fetchCalls = [];
  let currentIntervalMs = 60_000;
  try {
    globalThis.fetch = async (url, options = {}) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url) === '/kospi-risk-watch/api/polling' && options.method === 'POST') {
        currentIntervalMs = JSON.parse(options.body).intervalMs;
        return jsonResponse({ intervalMs: currentIntervalMs, active: true });
      }
      if (String(url) === '/kospi-risk-watch/api/polling') return jsonResponse({ intervalMs: currentIntervalMs, active: true });
      if (String(url).startsWith('/kospi-risk-watch/api/dashboard')) {
        return jsonResponse({
          ...dashboardFixture,
          snapshot: { polling: { intervalMs: currentIntervalMs } },
        });
      }
      throw new Error(`unexpected URL ${url}`);
    };

    const moduleUrl = `${pathToFileURL(process.cwd())}/apps/web/src/main.js?test=${Date.now()}`;
    await import(moduleUrl);

    assert.equal(elements.get('#polling-interval').value, '60000');
    assert.match(elements.get('#polling-state').textContent, /활성 · 1분 주기/);
    assert.equal(elements.get('#probability-value').textContent, '~62%');
    assert.equal(elements.get('#probability-gauge').style.getPropertyValue('--value'), '62');
    assert.match(elements.get('#probability-gauge').getAttribute('aria-label'), /월요일 하락 확률/);
    assert.match(elements.get('#probability-status').className, /status-degraded/);
    assert.match(elements.get('#probability-status').textContent, /데이터 제한/);
    assert.match(elements.get('#probability-meta').textContent, /목업 기반 제한 표시 점검/);
    assert.match(elements.get('#source-status').textContent, /목업 고정값/);
    assert.match(elements.get('#source-status').textContent, /라이브 데이터 아님/);
    assert.match(elements.get('#source-status').textContent, /로컬 개발과 테스트용/);
    assert.match(elements.get('#probability-contributions').textContent, /월요일 하락 기준율/);
    assert.equal(elements.get('#quant-readiness-score').textContent, '70/100');
    assert.equal(elements.get('#quant-readiness-gauge').style.getPropertyValue('--value'), '70');
    assert.match(elements.get('#quant-readiness-verdict').className, /status-analysis-review-ready/);
    assert.match(elements.get('#quant-readiness-verdict').textContent, /분석 검토 가능/);
    assert.match(elements.get('#quant-readiness-blockers').textContent, /승인된 무료/);
    assert.match(elements.get('#quant-readiness-checks').textContent, /확률이 계산되었습니다/);
    assert.equal(elements.get('#production-readiness-score').textContent, '55/100');
    assert.equal(elements.get('#production-readiness-gauge').style.getPropertyValue('--value'), '55');
    assert.match(elements.get('#production-readiness-status').className, /status-production-safe-observation/);
    assert.match(elements.get('#production-readiness-status').textContent, /공개 관찰 안전/);
    assert.match(elements.get('#production-readiness-blockers').textContent, /소스 레지스트리/);
    assert.match(elements.get('#production-readiness-checks').textContent, /서비스 상태/);
    assert.match(elements.get('#expiry-meta').textContent, /2026-06-11/);
    assert.match(elements.get('#derivatives-market-summary').textContent, /2\/8/);
    assert.match(elements.get('#derivatives-market-summary').textContent, /파생상품 지표/);
    assert.match(elements.get('#derivatives-market-list').textContent, /선물 베이시스/);
    assert.match(elements.get('#derivatives-market-list').textContent, /라이브 시장 데이터가 아닙니다/);
    assert.equal(elements.get('#freshness-list').children.length, 2);
    assert.match(elements.get('#alerts-list').textContent, /모니터링 임계값/);
    assert.ok(timers.scheduled.some((timer) => timer.delay === 60_000 && timer.unrefCalled));

    elements.get('#polling-interval').value = '300000';
    await elements.get('#polling-interval').trigger('change');
    assert.ok(fetchCalls.some((call) => call.url === '/kospi-risk-watch/api/polling' && call.options.method === 'POST'));
    assert.ok(fetchCalls.some((call) => call.url === '/kospi-risk-watch/api/dashboard?force=true'));
    assert.ok(timers.scheduled.some((timer) => timer.delay === 300_000 && timer.unrefCalled));
  } finally {
    timers.restore();
  }
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
          error: 'adapter_polling_failed',
        },
        sourceFreshnessSummary: {
          overall: 'error',
          fields: [{ name: 'adapter', freshness: 'error', source: 'throwing-test-adapter', observedAt: '2026-06-06T09:00:00Z', error: 'adapter_polling_failed' }],
        },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const moduleUrl = `${pathToFileURL(process.cwd())}/apps/web/src/main.js?test=source-error-${Date.now()}`;
  await import(moduleUrl);

  assert.match(elements.get('#source-status').className, /status-error/);
  assert.match(elements.get('#source-status').textContent, /adapter_polling_failed/);
  assert.match(elements.get('#freshness-list').textContent, /어댑터/);
  assert.match(elements.get('#freshness-list').textContent, /오류/);
});


test('UI module renders explicit dashboard fetch failure state', async () => {
  const elements = installFakeDocument();
  globalThis.fetch = async (url) => {
    if (String(url) === '/kospi-risk-watch/api/polling') return jsonResponse({ intervalMs: 300_000, active: true });
    if (String(url).startsWith('/kospi-risk-watch/api/dashboard')) throw new Error('network unavailable SECRET_TOKEN=hidden');
    throw new Error(`unexpected URL ${url}`);
  };

  const moduleUrl = `${pathToFileURL(process.cwd())}/apps/web/src/main.js?test=fetch-failure-${Date.now()}`;
  await import(moduleUrl);

  assert.equal(elements.get('#probability-value').textContent, '사용 불가');
  assert.match(elements.get('#production-readiness-status').className, /status-production-blocked/);
  assert.match(elements.get('#production-readiness-blockers').textContent, /대시보드 API 조회 실패/);
  assert.match(elements.get('#source-status').textContent, /대시보드 API 사용 불가/);
  assert.match(elements.get('#freshness-list').textContent, /대시보드 API/);
  assert.match(elements.get('#alerts-list').textContent, /대시보드 API 조회 실패/);
  assert.doesNotMatch(elements.get('#alerts-list').textContent, /SECRET_TOKEN|hidden/);
});
