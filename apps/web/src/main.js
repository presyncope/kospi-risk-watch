const $ = (selector) => document.querySelector(selector);
const scriptPath = new URL(document.currentScript?.src ?? import.meta.url).pathname;
const basePath = scriptPath.endsWith('/src/main.js') ? scriptPath.slice(0, -'/src/main.js'.length) : '';
const apiUrl = (path) => `${basePath}${path}`;
let refreshTimer = null;
let clientPollingIntervalMs = null;

function statusClass(status) {
  return `status-${status ?? 'unknown'}`;
}

function setText(selector, text) {
  const node = $(selector);
  if (node) node.textContent = text;
}

function scheduleNextRefresh(intervalMs) {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
  refreshTimer = setTimeout(() => {
    void loadDashboard(true);
  }, intervalMs);
  if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
}

function selectedPollingIntervalMs() {
  const value = Number($('#polling-interval')?.value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function effectivePollingIntervalMs(serverIntervalMs) {
  return clientPollingIntervalMs ?? serverIntervalMs;
}

function renderDefinitionList(selector, entries) {
  const node = $(selector);
  node.replaceChildren();
  for (const [label, value] of entries) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value ?? '—';
    node.append(dt, dd);
  }
}

function renderProbabilityValue(probability) {
  if (probability.probability == null) return 'Unavailable';
  if (probability.status === 'degraded') return `~${Math.round(probability.probability)}%`;
  return `${probability.probability}%`;
}

function renderProbability(probability = {}) {
  const value = renderProbabilityValue(probability);
  setText('#probability-value', value);
  const status = probability.status ?? 'unavailable';
  const statusNode = $('#probability-status');
  statusNode.className = `status ${statusClass(status)}`;
  statusNode.textContent = `${status.toUpperCase()} · ${probability.confidence ?? 'no'} confidence`;
  renderDefinitionList('#probability-meta', [
    ['Formula', probability.formula],
    ['Missing inputs', probability.missingInputs?.length ? probability.missingInputs.join(', ') : 'None'],
    ['Degraded reasons', probability.degradedReasons?.length ? probability.degradedReasons.join('; ') : 'None'],
    ['Source state', probability.sourceFreshnessSummary?.overall ?? 'unknown'],
  ]);
  const list = $('#probability-contributions');
  list.replaceChildren();
  for (const contribution of probability.contributions ?? []) {
    const item = document.createElement('li');
    item.textContent = `${contribution.input}: ${contribution.points} pts — ${contribution.note}`;
    list.append(item);
  }
  if ((probability.contributions ?? []).length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No contribution list until required inputs are available.';
    list.append(item);
  }
}

function renderExpiry(expiry) {
  renderDefinitionList('#expiry-meta', [
    ['As of', expiry.asOf],
    ['Monthly final trading', expiry.futuresMonthlyFinalTradingDay],
    ['Final settlement', expiry.futuresMonthlyFinalSettlementDay],
    ['Settlement basis', expiry.settlementBasis],
    ['Monday weekly expiry', expiry.weeklyOptionExpiries?.monday],
    ['Thursday weekly expiry', expiry.weeklyOptionExpiries?.thursday],
    ['Risk level', expiry.riskLevel],
    ['Holiday adjustment', expiry.holidayAdjustment],
    ['Explanation', expiry.explanation],
  ]);
}

function renderQuantReadiness(readiness) {
  const scoreText = readiness?.scorePct == null ? 'Unavailable' : `${readiness.scorePct}/100`;
  setText('#quant-readiness-score', scoreText);
  const verdict = readiness?.verdict ?? 'unavailable';
  const verdictNode = $('#quant-readiness-verdict');
  verdictNode.className = `status ${statusClass(verdict)}`;
  verdictNode.textContent = verdict.replaceAll('-', ' ').toUpperCase();
  setText('#quant-readiness-summary', readiness?.summary ?? 'Readiness assessment is unavailable.');
  renderDefinitionList('#quant-readiness-meta', [
    ['Score', readiness?.score == null ? '—' : `${readiness.score}/${readiness.maxScore}`],
    ['Strengths', readiness?.strengths?.length ? readiness.strengths.join(', ') : 'None yet'],
    ['Caveat', readiness?.caveat],
  ]);

  const checks = $('#quant-readiness-checks');
  checks.replaceChildren();
  for (const check of readiness?.checks ?? []) {
    const row = document.createElement('div');
    const label = document.createElement('strong');
    const status = document.createElement('span');
    const evidence = document.createElement('small');
    row.className = `readiness-row ${statusClass(check.status)}`;
    label.textContent = `${check.label} · ${check.score}/${check.maxScore}`;
    status.textContent = check.status;
    evidence.textContent = check.evidence;
    row.append(label, status, evidence);
    checks.append(row);
  }

  const blockers = $('#quant-readiness-blockers');
  blockers.replaceChildren();
  const blockerList = readiness?.blockers ?? [];
  if (blockerList.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No readiness blockers at the current data/system level.';
    blockers.append(item);
  } else {
    for (const blocker of blockerList) {
      const item = document.createElement('li');
      item.textContent = blocker;
      blockers.append(item);
    }
  }
}

function renderProductionReadiness(readiness) {
  const scoreText = readiness?.scorePct == null ? 'Unavailable' : `${readiness.scorePct}/100`;
  setText('#production-readiness-score', scoreText);
  const status = readiness?.status ?? 'production-blocked';
  const statusNode = $('#production-readiness-status');
  statusNode.className = `status ${statusClass(status)}`;
  statusNode.textContent = status.replaceAll('-', ' ').toUpperCase();
  setText('#production-readiness-summary', readiness?.summary ?? 'Production readiness is unavailable.');
  renderDefinitionList('#production-readiness-meta', [
    ['Live ready', readiness?.liveReady ? 'Yes' : 'No'],
    ['Safe to serve', readiness?.safeToServe ? 'Yes' : 'No'],
    ['Score', readiness?.score == null ? '—' : `${readiness.score}/${readiness.maxScore}`],
    ['Caveat', readiness?.caveat],
  ]);

  const checks = $('#production-readiness-checks');
  checks.replaceChildren();
  for (const check of readiness?.checks ?? []) {
    const row = document.createElement('div');
    const label = document.createElement('strong');
    const statusLabel = document.createElement('span');
    const evidence = document.createElement('small');
    row.className = `readiness-row ${statusClass(check.status)}`;
    label.textContent = `${check.label} · ${check.score}/${check.maxScore}`;
    statusLabel.textContent = check.status;
    evidence.textContent = check.evidence;
    row.append(label, statusLabel, evidence);
    checks.append(row);
  }

  const blockers = $('#production-readiness-blockers');
  blockers.replaceChildren();
  const blockerList = readiness?.blockers ?? [];
  if (blockerList.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No production readiness blockers at the current system/data-rights level.';
    blockers.append(item);
  } else {
    for (const blocker of blockerList) {
      const item = document.createElement('li');
      item.textContent = blocker;
      blockers.append(item);
    }
  }
}

function renderDerivativesMarket(market) {
  setText('#derivatives-market-summary', market?.summary ?? 'Derivatives coverage is unavailable.');
  const node = $('#derivatives-market-list');
  node.replaceChildren();
  for (const metric of market?.metrics ?? []) {
    const row = document.createElement('div');
    const label = document.createElement('strong');
    const status = document.createElement('span');
    const details = document.createElement('small');
    row.className = `metric-row ${statusClass(metric.status)}`;
    label.textContent = `${metric.label}: ${metric.displayValue}`;
    status.textContent = metric.status;
    details.textContent = `${metric.source} · ${metric.observedAt ?? 'no timestamp'} · ${metric.reason ?? metric.description}`;
    row.append(label, status, details);
    node.append(row);
  }
}

function renderSourceStatus(sourceStatus) {
  const node = $('#source-status');
  node.replaceChildren();
  const label = document.createElement('strong');
  const details = document.createElement('span');
  const message = document.createElement('small');
  node.className = `source-status ${statusClass(sourceStatus?.freshness)} source-${sourceStatus?.mode ?? 'unknown'}`;
  label.textContent = sourceStatus?.label ?? 'Unknown source status';
  details.textContent = `${sourceStatus?.source ?? 'unknown'} · ${sourceStatus?.freshness ?? 'unknown'} · ${sourceStatus?.liveData ? 'live source configured' : 'not live data'}`;
  message.textContent = sourceStatus?.error ?? sourceStatus?.message ?? 'No source message.';
  node.append(label, details, message);
}

function renderFetchFailure(message) {
  renderProbability({
    status: 'unavailable',
    probability: null,
    confidence: 'none',
    formula: 'Dashboard API unavailable.',
    missingInputs: ['dashboard-api'],
    degradedReasons: [],
    sourceFreshnessSummary: { overall: 'error' },
    contributions: [],
  });
  renderQuantReadiness({
    scorePct: null,
    verdict: 'operational-shell',
    summary: message,
    caveat: 'This readiness score evaluates dashboard data/system completeness only; it is not market direction guidance.',
    strengths: [],
    blockers: [message],
    checks: [],
  });
  renderProductionReadiness({
    scorePct: null,
    status: 'production-blocked',
    liveReady: false,
    safeToServe: false,
    summary: message,
    caveat: 'Production readiness cannot be assessed while the dashboard API is unreachable.',
    blockers: [message],
    checks: [],
  });
  renderExpiry({});
  renderDerivativesMarket({ summary: 'Derivatives coverage is unavailable because the dashboard API did not respond.', metrics: [] });
  renderFreshness({
    overall: 'error',
    fields: [{ name: 'dashboard-api', freshness: 'error', source: 'browser-fetch', observedAt: null }],
  }, {
    source: 'dashboard-api',
    freshness: 'error',
    mode: 'unavailable-placeholder',
    liveData: false,
    label: 'Dashboard API unavailable',
    message,
  });
  renderAlerts([{ kind: 'data-quality', severity: 'watch', message, nonAdvice: true }]);
}

function renderFreshness(summary = {}, sourceStatus = {}) {
  renderSourceStatus(sourceStatus);
  const node = $('#freshness-list');
  node.replaceChildren();
  for (const field of summary.fields ?? []) {
    const row = document.createElement('div');
    const name = document.createElement('strong');
    const freshness = document.createElement('span');
    const source = document.createElement('small');
    row.className = `freshness-row ${statusClass(field.freshness)}`;
    name.textContent = field.name;
    freshness.textContent = field.freshness;
    source.textContent = `${field.source} · ${field.observedAt ?? 'no timestamp'}`;
    row.append(name, freshness, source);
    node.append(row);
  }
}

function renderAlerts(alerts) {
  const node = $('#alerts-list');
  node.replaceChildren();
  if (!alerts?.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No informational alerts at the current thresholds.';
    node.append(empty);
    return;
  }
  for (const alert of alerts) {
    const item = document.createElement('div');
    item.className = `alert severity-${alert.severity}`;
    item.textContent = `${alert.kind}: ${alert.message}`;
    node.append(item);
  }
}

async function loadPolling() {
  const polling = await (await fetch(apiUrl('/api/polling'))).json();
  const interval = effectivePollingIntervalMs(polling.intervalMs);
  $('#polling-interval').value = String(interval);
  setText('#polling-state', `Active · ${Math.round(interval / 1000)}s interval`);
  scheduleNextRefresh(interval);
}

async function updatePolling() {
  try {
    const intervalMs = Number($('#polling-interval').value);
    const polling = await (await fetch(apiUrl('/api/polling'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intervalMs }),
    })).json();
    clientPollingIntervalMs = polling.intervalMs;
    $('#polling-interval').value = String(clientPollingIntervalMs);
    const scope = polling.scope === 'client' ? ' · client refresh only' : '';
    setText('#polling-state', `Active · ${Math.round(clientPollingIntervalMs / 1000)}s interval${scope}`);
    await loadDashboard(true);
  } catch {
    const message = 'Polling update failed; dashboard remains observation-only and not live-ready.';
    setText('#polling-state', 'Polling update failed');
    renderFetchFailure(message);
  }
}

async function loadDashboard(force = false) {
  setText('#polling-state', 'Refreshing…');
  try {
    const dashboard = await (await fetch(apiUrl(`/api/dashboard${force ? '?force=true' : ''}`))).json();
    renderProbability(dashboard.probability);
    renderQuantReadiness(dashboard.quantReadiness);
    renderProductionReadiness(dashboard.productionReadiness);
    renderExpiry(dashboard.expirySettlement);
    renderDerivativesMarket(dashboard.derivativesMarket);
    renderFreshness(dashboard.sourceFreshnessSummary, dashboard.sourceStatus);
    renderAlerts(dashboard.alerts);
    const interval = effectivePollingIntervalMs(dashboard.snapshot?.polling?.intervalMs);
    const limited = dashboard.snapshot?.polling?.forceRefreshLimited ? ' · refresh rate-limited' : '';
    setText('#polling-state', interval ? `Active · ${Math.round(interval / 1000)}s interval${limited}` : 'Loaded');
    scheduleNextRefresh(interval);
  } catch {
    const message = 'Dashboard API fetch failed; data freshness and readiness cannot be verified.';
    setText('#polling-state', 'Dashboard API unavailable');
    renderFetchFailure(message);
    scheduleNextRefresh(selectedPollingIntervalMs());
  }
}

async function initialize() {
  try {
    await loadPolling();
  } catch {
    setText('#polling-state', 'Polling API unavailable');
  }
  await loadDashboard(true);
}

$('#polling-interval').addEventListener('change', updatePolling);
$('#refresh').addEventListener('click', () => loadDashboard(true));

await initialize();
