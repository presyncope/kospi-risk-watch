const $ = (selector) => document.querySelector(selector);
const scriptPath = new URL(document.currentScript?.src ?? import.meta.url).pathname;
const basePath = scriptPath.endsWith('/src/main.js') ? scriptPath.slice(0, -'/src/main.js'.length) : '';
const apiUrl = (path) => `${basePath}${path}`;

function statusClass(status) {
  return `status-${status ?? 'unknown'}`;
}

function setText(selector, text) {
  const node = $(selector);
  if (node) node.textContent = text;
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

function renderProbability(probability) {
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

function renderFreshness(summary, sourceStatus) {
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
  $('#polling-interval').value = String(polling.intervalMs);
  setText('#polling-state', `Active · ${Math.round(polling.intervalMs / 1000)}s interval`);
}

async function updatePolling() {
  const intervalMs = Number($('#polling-interval').value);
  const polling = await (await fetch(apiUrl('/api/polling'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intervalMs }),
  })).json();
  setText('#polling-state', `Active · ${Math.round(polling.intervalMs / 1000)}s interval`);
  await loadDashboard(true);
}

async function loadDashboard(force = false) {
  setText('#polling-state', 'Refreshing…');
  const dashboard = await (await fetch(apiUrl(`/api/dashboard${force ? '?force=true' : ''}`))).json();
  renderProbability(dashboard.probability);
  renderExpiry(dashboard.expirySettlement);
  renderFreshness(dashboard.sourceFreshnessSummary, dashboard.sourceStatus);
  renderAlerts(dashboard.alerts);
  const interval = dashboard.snapshot?.polling?.intervalMs;
  setText('#polling-state', interval ? `Active · ${Math.round(interval / 1000)}s interval` : 'Loaded');
}

$('#polling-interval').addEventListener('change', updatePolling);
$('#refresh').addEventListener('click', () => loadDashboard(true));

await loadPolling();
await loadDashboard(true);
