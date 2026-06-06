export const FRESHNESS = Object.freeze({
  FRESH: 'fresh',
  STALE: 'stale',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
});

export function createProvenance({ source, observedAt = null, freshness = FRESHNESS.UNAVAILABLE, error = null, details = null } = {}) {
  return {
    source: source ?? 'unknown',
    observedAt,
    freshness,
    error,
    details,
  };
}

export function classifyFreshness({ observedAt, now = new Date(), maxAgeMs = 5 * 60 * 1000, error = null } = {}) {
  if (error) return FRESHNESS.ERROR;
  if (!observedAt) return FRESHNESS.UNAVAILABLE;
  const observed = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (Number.isNaN(observed.getTime())) return FRESHNESS.UNAVAILABLE;
  return now.getTime() - observed.getTime() <= maxAgeMs ? FRESHNESS.FRESH : FRESHNESS.STALE;
}

export function summarizeFreshness(fields = {}) {
  const entries = Object.entries(fields).map(([name, provenance]) => ({
    name,
    source: provenance?.source ?? 'unknown',
    freshness: provenance?.freshness ?? FRESHNESS.UNAVAILABLE,
    observedAt: provenance?.observedAt ?? null,
    error: provenance?.error ?? null,
  }));
  const priority = [FRESHNESS.ERROR, FRESHNESS.UNAVAILABLE, FRESHNESS.STALE, FRESHNESS.FRESH];
  const worst = priority.find((status) => entries.some((entry) => entry.freshness === status)) ?? FRESHNESS.UNAVAILABLE;
  return { overall: worst, fields: entries };
}

export function missingRequiredFields(fields = {}, requiredNames = []) {
  return requiredNames.filter((name) => {
    const provenance = fields[name];
    return !provenance || provenance.freshness === FRESHNESS.UNAVAILABLE || provenance.freshness === FRESHNESS.ERROR;
  });
}
