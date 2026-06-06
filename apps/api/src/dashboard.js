import { buildExpirySettlementRisk, buildRiskAlerts, computeDownsideProbability, createProvenance, summarizeFreshness } from '../../../packages/core/src/index.js';

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
  const isMock = source.startsWith('mock-');
  const isPlaceholder = source.includes('placeholder') || source === 'unconfigured';
  return {
    source,
    observedAt: snapshot.observedAt ?? null,
    polledAt: snapshot.polledAt ?? null,
    freshness: snapshot.freshness ?? 'unavailable',
    message: snapshot.message ?? null,
    error: snapshot.error ?? null,
    mode: isMock ? 'mock-fixture' : isPlaceholder ? 'unavailable-placeholder' : 'external-source',
    liveData: !isMock && !isPlaceholder && snapshot.freshness === 'fresh',
    label: isMock
      ? 'Mock fixture — not live market data'
      : isPlaceholder
        ? 'Unavailable placeholder — no live market data configured'
        : 'Configured external source',
  };
}

export function buildDashboardState(snapshot, { asOf = new Date() } = {}) {
  const expirySettlement = buildExpirySettlementRisk({ asOf });
  const sourceFreshnessSummary = summarizeSnapshotFreshness(snapshot);
  const probability = computeDownsideProbability({
    historicalMondayDownRate: snapshot.values?.historicalMondayDownRate ?? null,
    recentMomentum: snapshot.values?.recentMomentum ?? null,
    volatilityZScore: snapshot.values?.volatilityZScore ?? null,
    expiryRiskLevel: expirySettlement.riskLevel,
    provenance: snapshot.fields ?? {},
  });
  const alerts = buildRiskAlerts({ probabilityResult: probability, expiryRisk: expirySettlement });
  return {
    snapshot,
    sourceStatus: buildSourceStatus(snapshot),
    sourceFreshnessSummary,
    probability,
    expirySettlement,
    alerts,
  };
}
