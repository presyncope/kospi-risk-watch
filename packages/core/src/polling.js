export const POLLING_LIMITS = Object.freeze({
  minIntervalMs: 30_000,
  maxIntervalMs: 30 * 60_000,
  defaultIntervalMs: 5 * 60_000,
});

export function normalizePollingConfig(config = {}) {
  const requested = Number(config.intervalMs ?? POLLING_LIMITS.defaultIntervalMs);
  const intervalMs = Math.min(POLLING_LIMITS.maxIntervalMs, Math.max(POLLING_LIMITS.minIntervalMs, Number.isFinite(requested) ? requested : POLLING_LIMITS.defaultIntervalMs));
  return {
    intervalMs,
    active: config.active !== false,
  };
}
