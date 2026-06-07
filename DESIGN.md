# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-06-07
- Primary product surfaces:
  - Public dashboard at `apps/web/index.html`
  - Browser rendering logic at `apps/web/src/main.js`
  - Dashboard visual system at `apps/web/src/styles.css`
  - API payload contracts from `GET /api/dashboard` and `GET /api/readiness`
- Evidence reviewed:
  - `README.md` — product scope: observation-only KOSPI Monday downside and KOSPI200 expiry-settlement dashboard; non-advice guardrails; production/quant readiness levels.
  - `docs/data-sources.md` — source freshness, derivatives metric contract, readiness semantics, and approved-source gate.
  - `apps/web/index.html` — current dashboard structure: hero, polling toolbar, probability, quant readiness, production readiness, expiry-settlement, derivatives coverage, data quality, alerts.
  - `apps/web/src/main.js` — current text rendering and state mapping; API subpath-safe fetches.
  - `apps/web/src/styles.css` — current dark theme, two-column card grid, pill/status styles.
  - No existing design docs, screenshots, brand assets, icons, Figma files, or visual-regression baselines were found in the repository.
  - 2026-06-07 refresh: user feedback that the live screen over-weighted readiness plumbing and under-weighted the actual job: “코스피 월요일 하락 확률 · KOSPI200 만기/결제 리스크 관찰”.

## Brand
- Personality:
  - Korean-first, serious, analytical, transparent, and safety-focused.
  - Feels like a quant risk console rather than a trading app.
- Trust signals:
  - Prominent non-advice / no-auto-trading copy.
  - Clear separation between service availability, safe public serving, and true live-market readiness.
  - Explicit unavailable/stale/error states instead of hidden missing data.
  - Readiness gauges and metric tiles should explain why a score is not live-ready.
- Avoid:
  - Buy/sell wording, target-price language, position sizing, signal hype, “real-time guaranteed” claims, or profit-oriented visuals.
  - Precise-looking market probability when required inputs are unavailable/degraded.
  - Hiding the approved-data-source blocker behind decorative charts.

## Product goals
- Goals:
  - Translate the dashboard user experience from English to Korean.
  - Improve at-a-glance comprehension through stronger visual hierarchy, score gauges, metric tiles, and freshness/state grouping.
  - Preserve honest data readiness semantics: public-safe observation is acceptable; live readiness remains false until approved data sources exist.
  - Keep all controls observation-only.
  - Put market movement evidence first: KOSPI/KOSPI200 1-minute proxy chart, intraday change, short momentum, and volatility context should be visible before generic readiness plumbing.
  - Make the probability card explain “what inputs are currently moving the downside estimate” rather than only showing a headline probability.
- Non-goals:
  - No automated trading, order routing, broker integration, investment advice, or position sizing.
  - No new paid/closed data dependency.
  - No complex ML or backtested prediction claims in this pass.
  - No false KOSPI200 futures claim from Yahoo/yfinance symbols. Until an approved KRX/derivatives source exists, Yahoo KOSPI200 is an index proxy and must be labelled as such.
- Success signals:
  - Korean labels/microcopy across the visible dashboard.
  - Probability, quant readiness, and production readiness cards expose visual gauges/progress without overstating readiness.
  - Derivatives and freshness panels are easier to scan via card/tile status treatments.
  - Existing API, reverse-proxy subpath behavior, lint/typecheck/tests remain passing.

## Personas and jobs
- Primary personas:
  - Personal operator / quant-oriented viewer checking whether the KOSPI Monday downside dashboard is operationally safe and what data is missing.
  - Future maintainer integrating approved public KRX-compatible sources.
- User jobs:
  - Confirm whether the dashboard is safe to view publicly.
  - Understand why live market readiness is blocked.
  - See Monday downside probability status and missing/degraded inputs.
  - Review KOSPI200 expiry/settlement dates and derivative metric availability.
  - Adjust UI polling interval without changing server-wide polling cadence.
  - Check whether current KOSPI/KOSPI200 intraday movement supports downside-risk observation, without treating it as a trading signal.
- Key contexts of use:
  - Desktop browser on a public HTTPS reverse-proxy subpath.
  - Quick operational checks during market-monitoring preparation.
  - Mobile/compact view for status confirmation.

## Information architecture
- Primary navigation:
  - Single-page dashboard; no navigation menu.
- Core routes/screens:
  - `/kospi-risk-watch/` dashboard shell.
  - API-backed panels: probability, quant readiness, production readiness, expiry-settlement, derivatives coverage, data quality, alerts.
- Content hierarchy:
  1. Hero: Korean product title, non-advice guardrail, live/safety semantics.
  2. Polling controls: interval and manual refresh.
  3. Market pulse: KOSPI/KOSPI200 intraday chart, current change, 5/20-minute momentum, range/volatility context, and clear Yahoo-proxy/not-futures labelling.
  4. Monday downside probability: headline gauge plus input evidence table and contribution notes.
  5. KOSPI200 expiry/settlement and derivatives coverage.
  6. Quant/production/source readiness and alerts.

## Design principles
- Principle 1: “정확함이 화려함보다 우선한다.” Visual emphasis must make missing/blocked states clearer, not conceal them.
- Principle 2: “상태는 색상+텍스트+구조로 전달한다.” Do not rely on color alone; every status must include text labels and evidence.
- Tradeoffs:
  - Dense quant information is acceptable, but scanability should improve through gauges, compact labels, and card grouping.
  - Korean-first copy is required, but stable backend enum values may remain visible when they are useful for debugging/readiness contracts.

## Visual language
- Color:
  - Dark navy base with cyan/blue analytical accents.
  - Green for pass/live-ready/available; amber for watch/degraded/safe-observation; red for unavailable/error/blocked.
  - Subtle gradients and rings are allowed if they do not imply false precision.
- Typography:
  - System sans stack with Korean-capable fonts first: Pretendard / Apple SD Gothic Neo / Noto Sans KR / Segoe UI / sans-serif fallback.
  - Large numeric/status values for primary cards; small uppercase/letter-spaced English-style kickers should be replaced with Korean labels where possible.
- Spacing/layout rhythm:
  - Use 16–24px card padding and 10–14px internal gaps.
  - Primary cards can be visually taller and richer; secondary rows should remain compact.
- Shape/radius/elevation:
  - Rounded cards, soft borders, low-glow shadows, glassy dark panels.
  - Gauge/ring components should use CSS-only conic gradients.
- Motion:
  - Minimal; no market-ticker animation. Respect reduced motion by avoiding required animation.
- Imagery/iconography:
  - No external images required. Use text, badges, gauge rings, metric tiles, and structured layout instead of decorative icons.

## Components
- Existing components to reuse:
  - `.card`, `.status`, `.pill`, `.meta`, `.readiness-row`, `.metric-row`, `.freshness-row`, `.alert`.
- New/changed components:
  - `.gauge` / `.gauge-ring` for probability and readiness cards.
  - `.hero-summary` for compact safety/live/data-rights badges.
  - `.score-panel` for primary card visual hierarchy.
  - `.metric-grid` / richer `.metric-row` and `.freshness-row` treatments for scanability.
  - `.market-pulse-card`, `.mini-chart`, `.sparkline`, `.movement-grid`, and `.downside-input-grid` for market-first evidence.
- Variants and states:
  - Computed/fresh/pass/available/live-ready: green.
  - Degraded/stale/watch/partial/operational-shell/production-safe-observation: amber.
  - Unavailable/error/production-blocked: red.
  - Unknown/loading: muted blue-gray.
- Token/component ownership:
  - Keep CSS tokens in `apps/web/src/styles.css`; do not add a new design-system framework.

## Accessibility
- Target standard:
  - Practical WCAG 2.1 AA-oriented contrast/readability for text and controls.
- Keyboard/focus behavior:
  - Native select/button controls remain keyboard accessible.
  - Add visible focus treatments for interactive controls.
- Contrast/readability:
  - Status colors need readable text on dark backgrounds.
  - Korean copy should use sufficient line height.
- Screen-reader semantics:
  - Preserve headings, `aria-label`, and text alternatives through real text, not pseudo-content-only labels.
- Reduced motion and sensory considerations:
  - Avoid autoplay animation; gauges are static.

## Responsive behavior
- Supported breakpoints/devices:
  - Desktop two-column grid; single-column mobile below ~820px.
- Layout adaptations:
  - Hero badges and toolbar wrap.
  - Primary gauges can stack vertically on narrow screens.
- Touch/hover differences:
  - Controls must remain large enough for touch; no hover-only information.

## Interaction states
- Loading:
  - Korean loading copy: “데이터 대기 중…”, “새로고침 중…”.
- Empty:
  - Explain missing approved source or unavailable contribution list in Korean.
- Error:
  - Use Korean API failure copy while preserving non-advice and safe-to-serve semantics.
- Success:
  - Success means verified system/data state, not a trading signal.
- Disabled:
  - No disabled states expected for core controls in current MVP.
- Offline/slow network, if applicable:
  - Dashboard fetch failure should render API-unavailable state and reschedule via selected polling interval.

## Content voice
- Tone:
  - Calm Korean operational language: “관찰 전용”, “승인 데이터 미연결”, “라이브 준비 아님”.
- Terminology:
  - Monday downside probability: “월요일 하락 확률”
  - Expiry-settlement: “만기·결제”
  - Production readiness: “게시 안전성” or “운영 게시 준비도”
  - Quant readiness: “퀀트 준비도”
  - Data freshness: “데이터 신선도”
  - Live ready: “라이브 준비”
  - Safe to serve: “공개 게시 안전”
- Microcopy rules:
  - Every panel with unavailable/live-blocked data should state the limitation plainly.
  - Avoid trade-instruction, recommendation, sizing, or profit framing except inside guardrails that say they are not provided.
  - Backend enum values may be translated for display, but test/debug evidence can retain raw values.
  - Use “KOSPI200 지수 프록시” for Yahoo/yfinance chart data; do not call it “KOSPI200 선물” unless an actual futures source is configured.

## Implementation constraints
- Framework/styling system:
  - Vanilla HTML/CSS/ES modules. No new dependencies.
- Design-token constraints:
  - Extend current CSS custom properties and class names; keep diff reviewable.
- Performance constraints:
  - Static CSS/JS only; no chart libraries.
  - API polling remains bounded by server/client clamp behavior.
- Compatibility constraints:
  - Relative assets and `basePath` behavior must continue to work behind `/kospi-risk-watch/` reverse proxy.
- Test/screenshot expectations:
  - Update static UI and mocked UI-render tests for Korean copy and new visual components.
  - Run `npm run verify` before completion.

## Open questions
- [ ] Should future visual references or screenshots define a stricter brand direction? / owner: user / impact: future `$visual-ralph` pixel-match work.
- [ ] Which exact approved KRX/public data source and license pair should unlock `production-live-ready`? / owner: user/data provider / impact: live dashboard readiness.
