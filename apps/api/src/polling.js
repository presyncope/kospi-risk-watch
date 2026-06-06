import { normalizePollingConfig } from '../../../packages/core/src/index.js';

export class PollingCoordinator {
  constructor({ adapter, config = {}, clock = () => new Date() }) {
    this.adapter = adapter;
    this.clock = clock;
    this.config = normalizePollingConfig(config);
    this.cache = null;
    this.lastError = null;
    this.inFlight = null;
    this.lastPollAtMs = null;
  }

  getConfig() {
    return { ...this.config };
  }

  updateConfig(nextConfig = {}) {
    this.config = normalizePollingConfig({ ...this.config, ...nextConfig });
    return this.getConfig();
  }

  getCachedSnapshot() {
    return this.cache;
  }

  async pollNow() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.adapter.getSnapshot()
      .then((snapshot) => {
        const polledAt = this.clock();
        this.lastPollAtMs = polledAt.getTime();
        this.cache = {
          ...snapshot,
          polledAt: polledAt.toISOString(),
          polling: this.getConfig(),
        };
        this.lastError = null;
        return this.cache;
      })
      .catch((error) => {
        const polledAt = this.clock();
        this.lastError = error;
        this.lastPollAtMs = polledAt.getTime();
        this.cache = {
          source: this.adapter.source ?? 'unknown',
          observedAt: polledAt.toISOString(),
          polledAt: polledAt.toISOString(),
          freshness: 'error',
          error: 'adapter_polling_failed',
          message: 'Adapter polling failed; details are hidden from the public dashboard.',
          capabilities: { sourceApproval: 'error', readinessAllowed: false },
          fields: {},
          values: {},
          polling: this.getConfig(),
        };
        return this.cache;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  shouldPoll({ force = false } = {}) {
    if (!this.cache) return true;
    if (!force) return false;
    if (this.lastPollAtMs == null) return true;
    return this.clock().getTime() - this.lastPollAtMs >= this.config.intervalMs;
  }

  async snapshot({ force = false } = {}) {
    const shouldPoll = this.shouldPoll({ force });
    if (shouldPoll) return this.pollNow();
    return {
      ...this.cache,
      polling: {
        ...this.getConfig(),
        forceRefreshLimited: force === true,
      },
    };
  }
}
