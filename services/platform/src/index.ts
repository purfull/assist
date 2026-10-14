import crypto from 'crypto';
import type { Server } from 'http';
import type { Application, ErrorRequestHandler, RequestHandler } from 'express';
import pino, { type Logger } from 'pino';
import pinoHttp, { type HttpLogger } from 'pino-http';

/**
 * Shared runtime plumbing for ai-search services.
 *
 *   import * as platform from '@ai-search/platform';
 *   const logger = platform.createLogger('auth-service');
 *   platform.setTrustProxy(app);
 *   app.use(platform.requestLogger(logger));
 *   platform.healthRoutes(app, { db: () => sequelize.authenticate() });
 *   ... routes ...
 *   app.use(platform.notFoundHandler);
 *   app.use(platform.errorHandler(logger));
 *   platform.startServer({ app, port, logger, onShutdown: [() => sequelize.close()] });
 */

export type { Logger } from 'pino';
export { createMigrator, migrateUp, runMigrationCli } from './migrations';
export { configReporter } from './config';
export type { Migration, MigrationContext, MigratorOptions } from './migrations';

const REDACT_PATHS = [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-internal-token"]',
    'res.headers["set-cookie"]',
];

/** Structured JSON logger. Level from LOG_LEVEL (default info; silent under test). */
export const createLogger = (service: string): Logger => pino({
    name: service,
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service },
});

// Tokens can arrive in the query string (SSE, downloads); keep them out of logs.
const scrubUrl = (url = ''): string => url.replace(/([?&](?:token|code)=)[^&]*/gi, '$1[REDACTED]');

/**
 * Per-request logging with a request ID. Reuses an incoming X-Request-Id (set by the
 * gateway) so one ID follows a request across services, and echoes it in the response.
 */
export const requestLogger = (logger: Logger): HttpLogger => pinoHttp({
    logger,
    genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && /^[\w-]{1,128}$/.test(incoming) ? incoming : crypto.randomUUID();
        req.headers['x-request-id'] = id;
        res.setHeader('X-Request-Id', id);
        return id;
    },
    serializers: {
        req: (req: { id: unknown; method: string; url: string; remoteAddress: string }) => ({
            id: req.id,
            method: req.method,
            url: scrubUrl(req.url),
            remoteAddress: req.remoteAddress,
        }),
    },
    customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
    },
    autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
});

/**
 * Honour X-Forwarded-For from the proxies in front of this service.
 * TRUST_PROXY = number of hops (e.g. 1 behind the gateway) or an Express trust-proxy string.
 */
export const setTrustProxy = (app: Application, defaultValue = '1'): void => {
    const value = process.env.TRUST_PROXY ?? defaultValue;
    app.set('trust proxy', /^\d+$/.test(value) ? parseInt(value, 10) : value);
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
]);

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export type HealthChecks = Record<string, () => unknown>;

/**
 * GET /health        — liveness: the process is up (used by orchestrators to restart).
 * GET /health/ready  — readiness: every dependency check passes (used to route traffic).
 */
export const healthRoutes = (app: Application, checks: HealthChecks = {}, { service }: { service?: string } = {}): void => {
    app.get('/health', (_req, res) => {
        res.json({ service, status: 'ok', timestamp: new Date().toISOString() });
    });

    app.get('/health/ready', async (_req, res) => {
        const results: Record<string, string> = {};
        await Promise.all(Object.entries(checks).map(async ([name, check]) => {
            try {
                await withTimeout(Promise.resolve(check()), 2000);
                results[name] = 'ok';
            } catch (err) {
                results[name] = `error: ${errorMessage(err)}`;
            }
        }));
        const ready = Object.values(results).every((r) => r === 'ok');
        res.status(ready ? 200 : 503).json({ service, status: ready ? 'ready' : 'not_ready', checks: results });
    });
};

export const notFoundHandler: RequestHandler = (_req, res) => {
    res.status(404).json({ error: 'Route not found' });
};

/** An error that carries an HTTP status for the client (4xx keeps its message). */
export class HttpError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
        this.name = 'HttpError';
    }
}

const statusOf = (err: unknown): number => {
    if (typeof err === 'object' && err !== null) {
        const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
        const value = status ?? statusCode;
        if (typeof value === 'number' && Number.isInteger(value)) return value;
    }
    return 500;
};

/**
 * Final error handler. Client errors (4xx) keep their message; server errors return a
 * generic message so internals (SQL, stack details) never reach the client.
 */
export const errorHandler = (logger: Logger): ErrorRequestHandler => (err: unknown, req, res, _next) => {
    const status = statusOf(err);
    const log = req.log ?? logger;
    log[status >= 500 ? 'error' : 'warn']({ err }, 'Request failed');
    if (res.headersSent) {
        res.end();
        return;
    }
    const message = status >= 500 ? 'Internal server error' : errorMessage(err) || 'Request failed';
    res.status(status).json({ error: message });
};

export interface StartServerOptions {
    app: Application;
    port: number;
    logger: Logger;
    /** Run in order after the server stops accepting connections (close DB, Redis, ...) */
    onShutdown?: Array<() => unknown>;
    timeoutMs?: number;
}

/**
 * Start listening and shut down cleanly on SIGTERM/SIGINT: stop accepting connections,
 * run the onShutdown hooks (close DB/Redis), then exit. Forces exit after timeoutMs.
 */
export const startServer = ({ app, port, logger, onShutdown = [], timeoutMs = 10000 }: StartServerOptions): Server => {
    const server = app.listen(port, () => logger.info({ port }, 'Server listening'));
    let shuttingDown = false;

    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info({ signal }, 'Shutting down');
        const timer = setTimeout(() => {
            logger.error('Shutdown timed out; forcing exit');
            process.exit(1);
        }, timeoutMs);
        timer.unref();

        // Long-lived connections (SSE) would otherwise keep server.close() waiting:
        // drop idle ones now, and everything still open halfway through the grace period.
        server.closeIdleConnections();
        setTimeout(() => server.closeAllConnections(), timeoutMs / 2).unref();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        for (const hook of onShutdown) {
            try {
                await hook();
            } catch (err) {
                logger.error({ err }, 'Shutdown hook failed');
            }
        }
        logger.info('Shutdown complete');
        process.exit(0);
    };

    process.on('SIGTERM', (signal) => void shutdown(signal));
    process.on('SIGINT', (signal) => void shutdown(signal));
    return server;
};
