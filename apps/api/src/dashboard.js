import { FRESHNESS, buildDerivativesMarketContext, buildExpirySettlementRisk, buildProductionReadinessAssessment, buildQuantReadinessAssessment, buildRiskAlerts, computeDownsideProbability, createProvenance, evaluateLiveSourceApproval, normalizeHolidaySet, summarizeFreshness } from '../../../packages/core/src/index.js';

export function summarizeSnapshotFreshness(snapshot = {}) {
  const fields = { ...(snapshot.fields ?? {}) };
  fields.adapter = createProvenance({
    source: snapshot.source ?? 'unknown',
    observedAt: snapshot.observedAt ?? snapshot.polledAt ?? null,
    freshness: snapshot.freshness ?? 'unavailable',
    error: snapshot.error ?? null,
    details: snapshot.message ?? null,
  });
  return summarizeFreshness(fields);
}

export function buildSourceStatus(snapshot = {}) {
  const source = snapshot.source ?? 'unknown';
  const capabilities = snapshot.capabilities ?? {};
  const isMock = capabilities.mock === true;
  const sourceApproval = evaluateLiveSourceApproval({ source, capabilities });
  const approval = sourceApproval.approval;
  const isApprovedLive = sourceApproval.approved && snapshot.freshness === FRESHNESS.FRESH;
  const hasSourceError = snapshot.freshness === FRESHNESS.ERROR || Boolean(snapshot.error);
  const isPlaceholder = approval === 'placeholder' || approval === 'unconfigured' || source === 'unconfigured';
  let mode = 'external-source-unapproved';
  let label = 'External source — not approved for live readiness';
  if (hasSourceError) {
    mode = 'source-error';
    label = 'Adapter polling error — no live market data verified';
  } else if (isMock) {
    mode = 'mock-fixture';
    label = 'Mock fixture — not live market data';
  } else if (isPlaceholder) {
    mode = 'unavailable-placeholder';
    label = 'Unavailable placeholder — no live market data configured';
  } else if (isApprovedLive) {
    mode = 'approved-public-live-source';
    label = 'Approved free/public live market source';
  }
  return {
    source,
    observedAt: snapshot.observedAt ?? null,
    polledAt: snapshot.polledAt ?? null,
    freshness: snapshot.freshness ?? FRESHNESS.UNAVAILABLE,
    message: snapshot.message ?? null,
    error: snapshot.error ?? null,
    mode,
    liveData: isApprovedLive,
    approval,
    requestedApproval: sourceApproval.requestedApproval ?? approval,
    approvalReason: sourceApproval.reason,
    license: capabilities.license ?? 'unspecified',
    label,
  };
}

export function buildDashboardState(snapshot, { asOf = new Date(), service = {} } = {}) {
  const holidaySet = snapshot.fields?.holidayCalendar?.freshness === FRESHNESS.FRESH
    ? normalizeHolidaySet(snapshot.values?.holidayCalendar)
    : null;
  const expirySettlement = buildExpirySettlementRisk({ asOf, holidays: holidaySet });
  const sourceFreshnessSummary = summarizeSnapshotFreshness(snapshot);
  const probability = computeDownsideProbability({
    historicalMondayDownRate: snapshot.values?.historicalMondayDownRate ?? null,
    recentMomentum: snapshot.values?.recentMomentum ?? null,
    volatilityZScore: snapshot.values?.volatilityZScore ?? null,
    expiryRiskLevel: expirySettlement.riskLevel,
    provenance: snapshot.fields ?? {},
  });
  const derivativesMarket = buildDerivativesMarketContext({ snapshot, expirySettlement });
  const alerts = buildRiskAlerts({ probabilityResult: probability, expiryRisk: expirySettlement });
  const sourceStatus = buildSourceStatus(snapshot);
  const quantReadiness = buildQuantReadinessAssessment({
    snapshot,
    sourceStatus,
    probability,
    derivativesMarket,
    expirySettlement,
  });
  const productionReadiness = buildProductionReadinessAssessment({
    snapshot,
    sourceStatus,
    quantReadiness,
    probability,
    derivativesMarket,
    expirySettlement,
    service,
  });
  return {
    snapshot,
    sourceStatus,
    sourceFreshnessSummary,
    probability,
    expirySettlement,
    derivativesMarket,
    quantReadiness,
    productionReadiness,
    alerts,
  };
}
