import { normalizePollingConfig } from '../../../packages/core/src/index.js';

export class PollingCoordinator {
  constructor({ adapter, config = {}, clock = () => new Date() }) {
    this.adapter = adapter;
    this.clock = clock;
    this.config = normalizePollingConfig(config);
    this.cache = null;
    this.lastError = null;
    this.inFlight = null;
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
        this.cache = {
          ...snapshot,
          polledAt: this.clock().toISOString(),
          polling: this.getConfig(),
        };
        this.lastError = null;
        return this.cache;
      })
      .catch((error) => {
        this.lastError = error;
        this.cache = {
          source: this.adapter.source ?? 'unknown',
          observedAt: this.clock().toISOString(),
          polledAt: this.clock().toISOString(),
          freshness: 'error',
          error: error.message,
          message: 'Adapter polling failed.',
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

  async snapshot({ force = false } = {}) {
    if (force || !this.cache) return this.pollNow();
    return this.cache;
  }
}
