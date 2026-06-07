import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NON_ADVICE_NOTICE, normalizePollingConfig } from '../../../packages/core/src/index.js';
import { createAdapterFromEnv } from '../../../packages/data-adapters/src/index.js';
import { buildDashboardState } from './dashboard.js';
import { loadEnvFile } from './env.js';
import { PollingCoordinator } from './polling.js';

const rootDir = fileURLToPath(new URL('../../..', import.meta.url));
const webDir = join(rootDir, 'apps/web');

const MAX_JSON_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
]);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

async function readJsonBody(req) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) throw new HttpError(413, 'request_body_too_large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json_body');
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = normalize(requested).replace(/^\/+/, '');
  const filePath = join(webDir, safePath);
  if (!filePath.startsWith(webDir)) {
    json(res, 403, { error: 'forbidden' });
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    json(res, 404, { error: 'not_found' });
  }
}

export function createAppServer({ adapter = createAdapterFromEnv(), pollingConfig = {} } = {}) {
  const polling = new PollingCoordinator({ adapter, config: pollingConfig });

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/api/health') {
        json(res, 200, { ok: true, service: 'kospi-dashboard-api', nonAdvice: NON_ADVICE_NOTICE });
        return;
      }
      if (url.pathname === '/api/polling' && req.method === 'GET') {
        json(res, 200, polling.getConfig());
        return;
      }
      if (url.pathname === '/api/polling' && req.method === 'POST') {
        const clientPolling = normalizePollingConfig(await readJsonBody(req));
        json(res, 200, {
          ...clientPolling,
          scope: 'client',
          mutable: false,
          serverIntervalMs: polling.getConfig().intervalMs,
        });
        return;
      }
      if (url.pathname === '/api/snapshot') {
        json(res, 200, await polling.snapshot({ force: url.searchParams.get('force') === 'true' }));
        return;
      }
      if (url.pathname === '/api/dashboard') {
        const snapshot = await polling.snapshot({ force: url.searchParams.get('force') === 'true' });
        json(res, 200, buildDashboardState(snapshot, { service: { ok: true } }));
        return;
      }
      if (url.pathname === '/api/readiness') {
        const snapshot = await polling.snapshot({ force: url.searchParams.get('force') === 'true' });
        const dashboard = buildDashboardState(snapshot, { service: { ok: true } });
        const productionReadiness = dashboard.productionReadiness;
        json(res, 200, {
          ok: true,
          serviceOk: true,
          service: 'kospi-dashboard-api',
          status: productionReadiness.status,
          ready: productionReadiness.liveReady,
          liveReady: productionReadiness.liveReady,
          safeToServe: productionReadiness.safeToServe,
          nonAdvice: NON_ADVICE_NOTICE,
          polling: snapshot.polling,
          observedAt: snapshot.observedAt ?? null,
          polledAt: snapshot.polledAt ?? null,
          sourceStatus: dashboard.sourceStatus,
          quantReadiness: dashboard.quantReadiness,
          productionReadiness,
        });
        return;
      }
      await serveStatic(req, res);
    } catch (error) {
      if (error.statusCode) {
        json(res, error.statusCode, { error: error.message });
        return;
      }
      json(res, 500, { error: 'internal_error', message: 'Unexpected local server error.' });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnvFile();
  const port = Number(process.env.PORT ?? 4173);
  // Server snapshot cache/poll cadence; clamped by normalizePollingConfig to [30s, 30m].
  // The client UI auto-syncs its refresh interval to this advertised value.
  const pollingConfig = process.env.POLLING_INTERVAL_MS ? { intervalMs: Number(process.env.POLLING_INTERVAL_MS) } : {};
  createAppServer({ pollingConfig }).listen(port, () => {
    console.log(`KOSPI dashboard local server listening on http://localhost:${port}`);
  });
}
