const $ = (selector) => document.querySelector(selector);
const scriptPath = new URL(document.currentScript?.src ?? import.meta.url).pathname;
const basePath = scriptPath.endsWith('/src/main.js') ? scriptPath.slice(0, -'/src/main.js'.length) : '';
const apiUrl = (path) => `${basePath}${path}`;
let refreshTimer = null;
let clientPollingIntervalMs = null;

const STATUS_LABELS = new Map([
  ['computed', '계산 완료'],
  ['degraded', '데이터 제한'],
  ['unavailable', '사용 불가'],
  ['fresh', '신선'],
  ['stale', '오래됨'],
  ['error', '오류'],
  ['pass', '통과'],
  ['fail', '실패'],
  ['watch', '주시'],
  ['partial', '부분 제공'],
  ['available', '사용 가능'],
  ['normal', '정상'],
  ['elevated', '주의'],
  ['high', '높음'],
  ['low', '낮음'],
  ['none', '없음'],
  ['operational-shell', '운영 셸'],
  ['analysis-review-ready', '분석 검토 가능'],
  ['approved-live-monitor-ready', '승인 라이브 모니터 준비'],
  ['production-safe-observation', '공개 관찰 안전'],
  ['production-live-ready', '라이브 게시 준비 완료'],
  ['production-blocked', '게시 차단'],
]);

const FIELD_LABELS = new Map([
  ['kospiDaily', '코스피 일별 데이터'],
  ['historicalMondayDownRate', '월요일 하락 기준율'],
  ['recentMomentum', '최근 모멘텀'],
  ['volatility', '변동성'],
  ['derivativesCalendar', '파생상품 캘린더'],
  ['expiryCalendar', '만기 캘린더'],
  ['holidayCalendar', '휴장일 캘린더'],
  ['futuresBasis', '선물 베이시스'],
  ['futuresOpenInterest', '선물 미결제약정'],
  ['futuresVolume', '선물 거래량'],
  ['optionsOpenInterest', '옵션 미결제약정'],
  ['optionsVolume', '옵션 거래량'],
  ['putCallRatio', '풋/콜 비율'],
  ['foreignerNetFuturesFlow', '외국인 선물 순흐름'],
  ['kospiIntraday', 'KOSPI 1분봉'],
  ['kospi200Intraday', 'KOSPI200 지수 1분봉'],
  ['usdKrwIntraday', 'USD/KRW 1분봉'],
  ['expirySettlementRisk', '만기·결제 근접도'],
  ['dashboard-api', '대시보드 API'],
  ['adapter', '어댑터'],
]);

const TEXT_REPLACEMENTS = [
  [/Mock fixture — not live market data/gi, '목업 고정값 — 라이브 시장 데이터 아님'],
  [/Deterministic mock data for local development and tests\./gi, '로컬 개발과 테스트용 결정론적 목업 데이터입니다.'],
  [/not live data/gi, '라이브 데이터 아님'],
  [/live source configured/gi, '라이브 소스 설정됨'],
  [/No source message\./gi, '소스 메시지가 없습니다.'],
  [/Dashboard API unavailable\./gi, '대시보드 API를 사용할 수 없습니다.'],
  [/Dashboard API fetch failed/gi, '대시보드 API 조회 실패'],
  [/Dashboard API unavailable/gi, '대시보드 API 사용 불가'],
  [/Polling update failed/gi, '폴링 갱신 실패'],
  [/dashboard remains observation-only and not live-ready/gi, '대시보드는 관찰 전용이며 라이브 준비 상태가 아닙니다'],
  [/data freshness and readiness cannot be verified/gi, '데이터 신선도와 준비도를 검증할 수 없습니다'],
  [/Production-safe observation shell/gi, '공개 관찰 안전 셸'],
  [/live readiness remains blocked/gi, '라이브 준비는 아직 차단됨'],
  [/approved market data is configured/gi, '승인 시장 데이터가 설정될 때까지'],
  [/Production readiness is an operational\/data-rights gate, not market direction guidance\./gi, '운영 게시 준비도는 운용/데이터 권리 게이트이며 시장 방향 안내가 아닙니다.'],
  [/This readiness score evaluates dashboard data\/system completeness only; it is not market direction guidance\./gi, '이 준비도 점수는 대시보드 데이터/시스템 완성도만 평가하며 시장 방향 안내가 아닙니다.'],
  [/system logic and fixture\/partial inputs can be reviewed/gi, '시스템 로직과 고정/부분 입력은 검토 가능'],
  [/this is not live market readiness/gi, '라이브 시장 준비 상태는 아닙니다'],
  [/Replace mock fixture with an approved free\/public adapter before live-monitor readiness\./gi, '라이브 모니터 준비 전 승인된 무료/공개 어댑터로 목업을 대체해야 합니다.'],
  [/Configure credentials, data-rights approval, endpoint mapping, and a system-owned source registry entry before live readiness\./gi, '라이브 준비 전 인증 정보, 데이터 권리 승인, 엔드포인트 매핑, 시스템 소유 소스 레지스트리 항목을 설정해야 합니다.'],
  [/Market data source/gi, '시장 데이터 소스'],
  [/Downside probability calculation/gi, '하락 확률 계산'],
  [/Service health/gi, '서비스 상태'],
  [/Approved live market source/gi, '승인 라이브 시장 소스'],
  [/Probability is computed\./gi, '확률이 계산되었습니다.'],
  [/API process is responding\./gi, 'API 프로세스가 응답 중입니다.'],
  [/Mock fixture is available for verification only\./gi, '목업 고정값은 검증용으로만 사용 가능합니다.'],
  [/Mock fixture is not live data\./gi, '목업 고정값은 라이브 데이터가 아닙니다.'],
  [/Baseline Monday decline frequency\./gi, '월요일 하락 빈도 기준값입니다.'],
  [/Elevated volatility marker\./gi, '변동성 상승 신호입니다.'],
  [/Monitoring threshold crossed\./gi, '모니터링 임계값에 도달했습니다.'],
  [/Monthly KOSPI200 expiry-settlement window is near\./gi, 'KOSPI200 월물 만기·결제 구간이 임박했습니다.'],
  [/derivatives market metrics available/gi, '개 파생상품 지표 사용 가능'],
  [/expiry calendar status is high/gi, '만기 캘린더 리스크가 높음'],
  [/Futures basis/gi, '선물 베이시스'],
  [/Futures open interest/gi, '선물 미결제약정'],
  [/Unavailable/gi, '사용 불가'],
  [/Adapter did not provide this metric\./gi, '어댑터가 이 지표를 제공하지 않았습니다.'],
  [/Mock fixture; not live market data\./gi, '목업 고정값이며 라이브 시장 데이터가 아닙니다.'],
  [/baseline plus transparent adjustments\./gi, '기준율에 투명한 보정값을 더합니다.'],
  [/fixture degraded display check/gi, '목업 기반 제한 표시 점검'],
  [/No readiness blockers at the current data\/system level\./gi, '현재 데이터/시스템 수준의 준비도 차단 항목이 없습니다.'],
  [/No production readiness blockers at the current system\/data-rights level\./gi, '현재 시스템/데이터 권리 수준의 게시 준비 차단 항목이 없습니다.'],
  [/No contribution list until required inputs are available\./gi, '필수 입력이 들어오기 전까지 기여도 목록은 표시하지 않습니다.'],
  [/No informational alerts at the current thresholds\./gi, '현재 임계값 기준 정보성 알림이 없습니다.'],
  [/Yahoo Finance proxy was polled for KOSPI\/KOSPI200 observation; derivatives\/OI\/short-selling metrics remain unavailable\./gi, 'Yahoo Finance 프록시로 KOSPI/KOSPI200 관찰 데이터를 조회했습니다. 파생상품/OI/숏 관련 지표는 아직 미제공입니다.'],
  [/Yahoo Finance 1-minute proxy; KOSPI200 is an index proxy, not KOSPI200 futures\./gi, 'Yahoo Finance 1분봉 프록시입니다. KOSPI200은 선물 데이터가 아니라 지수 프록시입니다.'],
  [/Yahoo\/yfinance route is a KOSPI200 index proxy, not futures data\./gi, 'Yahoo/yfinance 경로는 KOSPI200 선물이 아니라 지수 프록시입니다.'],
  [/not KOSPI200 futures/gi, 'KOSPI200 선물 아님'],
  [/KOSPI200 index proxy/gi, 'KOSPI200 지수 프록시'],
  [/KOSPI daily proxy/gi, 'KOSPI 일별 프록시'],
  [/Unofficial and not exchange-approved/gi, '비공식이며 거래소 승인 데이터가 아님'],
  [/downside-probability-input/gi, '하락확률 입력'],
  [/index-proxy-not-futures/gi, '지수 프록시 · 선물 아님'],
  [/macro-fx-context/gi, '환율 맥락'],
  [/\bNo\b/gi, '아니오'],
  [/\bYes\b/gi, '예'],
  [/\bNone yet\b/gi, '아직 없음'],
  [/\bNone\b/gi, '없음'],
  [/\bunknown\b/gi, '알 수 없음'],
  [/\bno timestamp\b/gi, '타임스탬프 없음'],
];

function statusClass(status) {
  return `status-${status ?? 'unknown'}`;
}

function labelStatus(status) {
  const normalized = String(status ?? 'unknown');
  return STATUS_LABELS.get(normalized) ?? normalized.replaceAll('-', ' ');
}

function labelField(name) {
  return FIELD_LABELS.get(name) ?? name;
}

function translateText(value) {
  if (value == null) return value;
  let text = String(value);
  for (const [pattern, replacement] of TEXT_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function translateList(values, emptyText = '없음') {
  return values?.length ? values.map((value) => translateText(value)).join(', ') : emptyText;
}

function formatInterval(intervalMs) {
  if (!Number.isFinite(intervalMs)) return '알 수 없음';
  if (intervalMs < 60_000) return `${Math.round(intervalMs / 1000)}초`;
  return `${Math.round(intervalMs / 60_000)}분`;
}

function formatPct(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '사용 불가';
  const prefix = number > 0 ? '+' : '';
  return `${prefix}${number.toFixed(digits)}%`;
}

function formatMarketNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '사용 불가';
  return number.toLocaleString('en-US', { maximumFractionDigits: number >= 100 ? 2 : 4 });
}

function movementClass(changePct) {
  const number = Number(changePct);
  if (!Number.isFinite(number)) return 'movement-unavailable';
  if (number < -0.05) return 'movement-down';
  if (number > 0.05) return 'movement-up';
  return 'movement-flat';
}

function clampPct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function setGauge(selector, pct, status, label) {
  const node = $(selector);
  if (!node) return;
  const value = clampPct(pct);
  node.style.setProperty('--value', String(value));
  node.className = `gauge ${selector.includes('probability') ? '' : 'gauge-small'} ${statusClass(status)}`.trim();
  node.setAttribute('aria-label', `${label}: ${value}/100 · ${labelStatus(status)}`);
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
    dd.textContent = translateText(value) ?? '—';
    node.append(dt, dd);
  }
}

function renderProbabilityValue(probability) {
  if (probability.probability == null) return '사용 불가';
  if (probability.status === 'degraded') return `~${Math.round(probability.probability)}%`;
  return `${probability.probability}%`;
}

function renderProbability(probability = {}) {
  const value = renderProbabilityValue(probability);
  setText('#probability-value', value);
  const status = probability.status ?? 'unavailable';
  setGauge('#probability-gauge', probability.probability, status, '월요일 하락 확률');
  const statusNode = $('#probability-status');
  statusNode.className = `status ${statusClass(status)}`;
  statusNode.textContent = `${labelStatus(status)} · 신뢰도 ${labelStatus(probability.confidence ?? 'none')}`;
  renderDefinitionList('#probability-meta', [
    ['계산식', probability.formula],
    ['누락 입력', probability.missingInputs?.length ? probability.missingInputs.map(labelField).join(', ') : '없음'],
    ['제한 사유', probability.degradedReasons?.length ? probability.degradedReasons.map(translateText).join('; ') : '없음'],
    ['소스 상태', labelStatus(probability.sourceFreshnessSummary?.overall ?? 'unknown')],
  ]);
  const list = $('#probability-contributions');
  list.replaceChildren();
  for (const contribution of probability.contributions ?? []) {
    const item = document.createElement('li');
    item.textContent = `${labelField(contribution.input)}: ${contribution.points}점 — ${translateText(contribution.note)}`;
    list.append(item);
  }
  if ((probability.contributions ?? []).length === 0) {
    const item = document.createElement('li');
    item.textContent = '필수 입력이 들어오기 전까지 기여도 목록은 표시하지 않습니다.';
    list.append(item);
  }
}

function renderMiniChart(instrument) {
  const node = $('#market-chart');
  node.replaceChildren();
  if (!instrument?.bars?.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '1분봉 차트 데이터를 사용할 수 없습니다.';
    node.setAttribute('aria-label', '1분봉 차트 데이터 사용 불가');
    node.append(empty);
    return;
  }

  const bars = instrument.bars;
  const closes = bars.map((bar) => Number(bar.close)).filter(Number.isFinite);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const stride = Math.max(1, Math.ceil(bars.length / 72));
  const stage = document.createElement('div');
  stage.className = 'sparkline';
  bars.filter((_, index) => index % stride === 0 || index === bars.length - 1).forEach((bar) => {
    const point = document.createElement('span');
    const y = 100 - ((bar.close - min) / range) * 100;
    point.style.setProperty('--y', `${Math.max(2, Math.min(98, y)).toFixed(2)}%`);
    stage.append(point);
  });

  const caption = document.createElement('div');
  caption.className = 'chart-caption';
  caption.textContent = `${instrument.label} · ${instrument.symbol} · 최근 ${bars.length}개 1분봉 · 현재 ${formatMarketNumber(instrument.last)} · 당일 ${formatPct(instrument.changePct)}`;
  node.setAttribute('aria-label', caption.textContent);
  node.append(stage, caption);
}

function renderMarketPulse(marketPulse = {}) {
  const status = marketPulse.status ?? 'unavailable';
  const summary = $('#market-pulse-summary');
  summary.className = `status ${statusClass(status)}`;
  summary.textContent = `${labelStatus(status)} · ${translateText(marketPulse.label ?? '시장 프록시 미설정')}`;
  setText('#market-pulse-caveat', translateText(marketPulse.caveat ?? 'KRX 선물/OI/숏 관련 데이터가 연결되기 전까지 프록시 차트만 표시합니다.'));

  const meta = $('#market-pulse-meta');
  meta.replaceChildren();
  for (const [label, value] of [
    ['소스', marketPulse.source ?? 'unknown'],
    ['관측', marketPulse.observedAt ?? '타임스탬프 없음'],
  ]) {
    const item = document.createElement('span');
    item.textContent = `${label}: ${translateText(value)}`;
    meta.append(item);
  }

  const primary = marketPulse.instruments?.find((instrument) => instrument.key === marketPulse.primaryKey)
    ?? marketPulse.instruments?.find((instrument) => instrument.key === 'kospi200')
    ?? marketPulse.instruments?.[0];
  renderMiniChart(primary);

  const grid = $('#market-movement-grid');
  grid.replaceChildren();
  for (const instrument of marketPulse.instruments ?? []) {
    const tile = document.createElement('div');
    const label = document.createElement('strong');
    const value = document.createElement('span');
    const detail = document.createElement('small');
    tile.className = `movement-tile ${movementClass(instrument.changePct)}`;
    label.textContent = `${instrument.label} · ${instrument.symbol}`;
    value.textContent = `${formatMarketNumber(instrument.last)} · ${formatPct(instrument.changePct)}`;
    detail.textContent = `5분 ${formatPct(instrument.momentum5mPct)} · 20분 ${formatPct(instrument.momentum20mPct)} · 범위 ${formatPct(instrument.rangePct)} · ${translateText(instrument.role)}`;
    tile.append(label, value, detail);
    grid.append(tile);
  }
  if ((marketPulse.instruments ?? []).length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '시장 1분봉 프록시가 없습니다.';
    grid.append(empty);
  }
}

function renderDownsideInputs(inputs = []) {
  const node = $('#downside-input-grid');
  node.replaceChildren();
  for (const input of inputs) {
    const tile = document.createElement('div');
    const label = document.createElement('strong');
    const value = document.createElement('span');
    const detail = document.createElement('small');
    tile.className = `downside-input ${statusClass(input.status)}`;
    label.textContent = input.label ?? labelField(input.key);
    value.textContent = translateText(input.value ?? '사용 불가');
    detail.textContent = `${translateText(input.role ?? '')} · ${translateText(input.detail ?? '')}`.trim();
    tile.append(label, value, detail);
    node.append(tile);
  }
  if (!inputs.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '하락확률 입력 근거가 아직 없습니다.';
    node.append(empty);
  }
}

function renderExpiry(expiry) {
  renderDefinitionList('#expiry-meta', [
    ['기준일', expiry.asOf],
    ['월물 최종거래일', expiry.futuresMonthlyFinalTradingDay],
    ['최종결제일', expiry.futuresMonthlyFinalSettlementDay],
    ['결제 기준', expiry.settlementBasis],
    ['월요일 위클리 만기', expiry.weeklyOptionExpiries?.monday],
    ['목요일 위클리 만기', expiry.weeklyOptionExpiries?.thursday],
    ['리스크 수준', labelStatus(expiry.riskLevel)],
    ['휴장일 보정', labelStatus(expiry.holidayAdjustment)],
    ['설명', expiry.explanation],
  ]);
}

function renderQuantReadiness(readiness) {
  const scoreText = readiness?.scorePct == null ? '사용 불가' : `${readiness.scorePct}/100`;
  setText('#quant-readiness-score', scoreText);
  const verdict = readiness?.verdict ?? 'unavailable';
  setGauge('#quant-readiness-gauge', readiness?.scorePct, verdict, '퀀트 준비도');
  const verdictNode = $('#quant-readiness-verdict');
  verdictNode.className = `status ${statusClass(verdict)}`;
  verdictNode.textContent = labelStatus(verdict);
  setText('#quant-readiness-summary', translateText(readiness?.summary ?? '준비도 평가를 사용할 수 없습니다.'));
  renderDefinitionList('#quant-readiness-meta', [
    ['점수', readiness?.score == null ? '—' : `${readiness.score}/${readiness.maxScore}`],
    ['강점', translateList(readiness?.strengths, '아직 없음')],
    ['주의', readiness?.caveat],
  ]);

  const checks = $('#quant-readiness-checks');
  checks.replaceChildren();
  for (const check of readiness?.checks ?? []) {
    const row = document.createElement('div');
    const label = document.createElement('strong');
    const status = document.createElement('span');
    const evidence = document.createElement('small');
    row.className = `readiness-row ${statusClass(check.status)}`;
    label.textContent = `${translateText(check.label)} · ${check.score}/${check.maxScore}`;
    status.textContent = labelStatus(check.status);
    evidence.textContent = translateText(check.evidence);
    row.append(label, status, evidence);
    checks.append(row);
  }

  const blockers = $('#quant-readiness-blockers');
  blockers.replaceChildren();
  const blockerList = readiness?.blockers ?? [];
  if (blockerList.length === 0) {
    const item = document.createElement('li');
    item.textContent = '현재 데이터/시스템 수준의 준비도 차단 항목이 없습니다.';
    blockers.append(item);
  } else {
    for (const blocker of blockerList) {
      const item = document.createElement('li');
      item.textContent = translateText(blocker);
      blockers.append(item);
    }
  }
}

function renderProductionReadiness(readiness) {
  const scoreText = readiness?.scorePct == null ? '사용 불가' : `${readiness.scorePct}/100`;
  setText('#production-readiness-score', scoreText);
  const status = readiness?.status ?? 'production-blocked';
  setGauge('#production-readiness-gauge', readiness?.scorePct, status, '공개 게시 안전성');
  const statusNode = $('#production-readiness-status');
  statusNode.className = `status ${statusClass(status)}`;
  statusNode.textContent = labelStatus(status);
  setText('#production-readiness-summary', translateText(readiness?.summary ?? '운영 게시 준비도를 사용할 수 없습니다.'));
  renderDefinitionList('#production-readiness-meta', [
    ['라이브 준비', readiness?.liveReady ? '예' : '아니오'],
    ['공개 게시 안전', readiness?.safeToServe ? '예' : '아니오'],
    ['점수', readiness?.score == null ? '—' : `${readiness.score}/${readiness.maxScore}`],
    ['주의', readiness?.caveat],
  ]);

  const checks = $('#production-readiness-checks');
  checks.replaceChildren();
  for (const check of readiness?.checks ?? []) {
    const row = document.createElement('div');
    const label = document.createElement('strong');
    const statusLabel = document.createElement('span');
    const evidence = document.createElement('small');
    row.className = `readiness-row ${statusClass(check.status)}`;
    label.textContent = `${translateText(check.label)} · ${check.score}/${check.maxScore}`;
    statusLabel.textContent = labelStatus(check.status);
    evidence.textContent = translateText(check.evidence);
    row.append(label, statusLabel, evidence);
    checks.append(row);
  }

  const blockers = $('#production-readiness-blockers');
  blockers.replaceChildren();
  const blockerList = readiness?.blockers ?? [];
  if (blockerList.length === 0) {
    const item = document.createElement('li');
    item.textContent = '현재 시스템/데이터 권리 수준의 게시 준비 차단 항목이 없습니다.';
    blockers.append(item);
  } else {
    for (const blocker of blockerList) {
      const item = document.createElement('li');
      item.textContent = translateText(blocker);
      blockers.append(item);
    }
  }
}

function renderDerivativesMarket(market) {
  setText('#derivatives-market-summary', translateText(market?.summary ?? '파생상품 커버리지를 사용할 수 없습니다.'));
  const node = $('#derivatives-market-list');
  node.replaceChildren();
  for (const metric of market?.metrics ?? []) {
    const row = document.createElement('div');
    const label = document.createElement('strong');
    const status = document.createElement('span');
    const details = document.createElement('small');
    row.className = `metric-row ${statusClass(metric.status)}`;
    label.textContent = `${translateText(metric.label)}: ${translateText(metric.displayValue)}`;
    status.textContent = labelStatus(metric.status);
    details.textContent = `${metric.source} · ${metric.observedAt ?? '타임스탬프 없음'} · ${translateText(metric.reason ?? metric.description)}`;
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
  label.textContent = translateText(sourceStatus?.label ?? '소스 상태 알 수 없음');
  details.textContent = `${sourceStatus?.source ?? 'unknown'} · ${labelStatus(sourceStatus?.freshness ?? 'unknown')} · ${sourceStatus?.liveData ? '라이브 소스 설정됨' : '라이브 데이터 아님'}`;
  message.textContent = translateText(sourceStatus?.error ?? sourceStatus?.message ?? '소스 메시지가 없습니다.');
  node.append(label, details, message);
}

function renderFetchFailure(message) {
  const safeMessage = translateText(message);
  renderProbability({
    status: 'unavailable',
    probability: null,
    confidence: 'none',
    formula: '대시보드 API를 사용할 수 없습니다.',
    missingInputs: ['dashboard-api'],
    degradedReasons: [],
    sourceFreshnessSummary: { overall: 'error' },
    contributions: [],
  });
  renderQuantReadiness({
    scorePct: null,
    verdict: 'operational-shell',
    summary: safeMessage,
    caveat: '이 준비도 점수는 대시보드 데이터/시스템 완성도만 평가하며 시장 방향 안내가 아닙니다.',
    strengths: [],
    blockers: [safeMessage],
    checks: [],
  });
  renderProductionReadiness({
    scorePct: null,
    status: 'production-blocked',
    liveReady: false,
    safeToServe: false,
    summary: safeMessage,
    caveat: '대시보드 API에 연결할 수 없어 운영 게시 준비도를 평가할 수 없습니다.',
    blockers: [safeMessage],
    checks: [],
  });
  renderMarketPulse({
    status: 'error',
    source: 'dashboard-api',
    label: '대시보드 API 사용 불가',
    observedAt: null,
    instruments: [],
    caveat: safeMessage,
  });
  renderDownsideInputs([]);
  renderExpiry({});
  renderDerivativesMarket({ summary: '대시보드 API가 응답하지 않아 파생상품 커버리지를 사용할 수 없습니다.', metrics: [] });
  renderFreshness({
    overall: 'error',
    fields: [{ name: 'dashboard-api', freshness: 'error', source: 'browser-fetch', observedAt: null }],
  }, {
    source: 'dashboard-api',
    freshness: 'error',
    mode: 'unavailable-placeholder',
    liveData: false,
    label: '대시보드 API 사용 불가',
    message: safeMessage,
  });
  renderAlerts([{ kind: 'data-quality', severity: 'watch', message: safeMessage, nonAdvice: true }]);
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
    name.textContent = labelField(field.name);
    freshness.textContent = labelStatus(field.freshness);
    source.textContent = `${field.source} · ${field.observedAt ?? '타임스탬프 없음'}`;
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
    empty.textContent = '현재 임계값 기준 정보성 알림이 없습니다.';
    node.append(empty);
    return;
  }
  for (const alert of alerts) {
    const item = document.createElement('div');
    item.className = `alert severity-${alert.severity}`;
    item.textContent = `${translateAlertKind(alert.kind)} · ${labelStatus(alert.severity)}: ${translateText(alert.message)}`;
    node.append(item);
  }
}

function translateAlertKind(kind) {
  return new Map([
    ['market-risk', '시장 리스크'],
    ['data-quality', '데이터 품질'],
    ['expiry-settlement', '만기·결제'],
  ]).get(kind) ?? translateText(kind);
}

async function loadPolling() {
  const polling = await (await fetch(apiUrl('/api/polling'))).json();
  const interval = effectivePollingIntervalMs(polling.intervalMs);
  $('#polling-interval').value = String(interval);
  setText('#polling-state', `활성 · ${formatInterval(interval)} 주기`);
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
    const scope = polling.scope === 'client' ? ' · 화면 갱신만 적용' : '';
    setText('#polling-state', `활성 · ${formatInterval(clientPollingIntervalMs)} 주기${scope}`);
    await loadDashboard(true);
  } catch {
    const message = '폴링 갱신 실패; 대시보드는 관찰 전용이며 라이브 준비 상태가 아닙니다.';
    setText('#polling-state', '폴링 갱신 실패');
    renderFetchFailure(message);
  }
}

async function loadDashboard(force = false) {
  setText('#polling-state', '새로고침 중…');
  try {
    const dashboard = await (await fetch(apiUrl(`/api/dashboard${force ? '?force=true' : ''}`))).json();
    renderProbability(dashboard.probability);
    renderMarketPulse(dashboard.marketPulse);
    renderDownsideInputs(dashboard.downsideInputs);
    renderQuantReadiness(dashboard.quantReadiness);
    renderProductionReadiness(dashboard.productionReadiness);
    renderExpiry(dashboard.expirySettlement);
    renderDerivativesMarket(dashboard.derivativesMarket);
    renderFreshness(dashboard.sourceFreshnessSummary, dashboard.sourceStatus);
    renderAlerts(dashboard.alerts);
    const interval = effectivePollingIntervalMs(dashboard.snapshot?.polling?.intervalMs);
    const limited = dashboard.snapshot?.polling?.forceRefreshLimited ? ' · 강제 새로고침 제한됨' : '';
    setText('#polling-state', interval ? `활성 · ${formatInterval(interval)} 주기${limited}` : '로드 완료');
    scheduleNextRefresh(interval);
  } catch {
    const message = '대시보드 API 조회 실패; 데이터 신선도와 준비도를 검증할 수 없습니다.';
    setText('#polling-state', '대시보드 API 사용 불가');
    renderFetchFailure(message);
    scheduleNextRefresh(selectedPollingIntervalMs());
  }
}

async function initialize() {
  try {
    await loadPolling();
  } catch {
    setText('#polling-state', '폴링 API 사용 불가');
  }
  await loadDashboard(true);
}

$('#polling-interval').addEventListener('change', updatePolling);
$('#refresh').addEventListener('click', () => loadDashboard(true));

await initialize();
