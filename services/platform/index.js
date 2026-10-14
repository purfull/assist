'use strict';

const crypto = require('crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');

/**
 * Shared runtime plumbing for ai-search services.
 *
 *   const platform = require('@ai-search/platform');
 *   const logger = platform.createLogger('auth-service');
 *   platform.setTrustProxy(app);
 *   app.use(platform.requestLogger(logger));
 *   platform.healthRoutes(app, { db: () => sequelize.authenticate() });
 *   ... routes ...
 *   app.use(platform.notFoundHandler);
 *   app.use(platform.errorHandler(logger));
 *   platform.startServer({ app, port, logger, onShutdown: [() => sequelize.close()] });
 */

const REDACT_PATHS = [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-internal-token"]',
    'res.headers["set-cookie"]',
];

/** Structured JSON logger. Level from LOG_LEVEL (default info; silent under test). */
const createLogger = (service) => pino({
    name: service,
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service },
});

// Tokens can arrive in the query string (SSE, downloads); keep them out of logs.
const scrubUrl = (url = '') => url.replace(/([?&](?:token|code)=)[^&]*/gi, '$1[REDACTED]');

/**
 * Per-request logging with a request ID. Reuses an incoming X-Request-Id (set by the
 * gateway) so one ID follows a request across services, and echoes it in the response.
 */
const requestLogger = (logger) => pinoHttp({
    logger,
    genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && /^[\w-]{1,128}$/.test(incoming) ? incoming : crypto.randomUUID();
        req.headers['x-request-id'] = id;
        res.setHeader('X-Request-Id', id);
        return id;
    },
    serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: scrubUrl(req.url), remoteAddress: req.remoteAddress }),
    },
    customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
    },
    autoLogging: { ignore: (req) => req.url.startsWith('/health') },
});

/**
 * Honour X-Forwarded-For from the proxies in front of this service.
 * TRUST_PROXY = number of hops (e.g. 1 behind the gateway) or an Express trust-proxy string.
 */
const setTrustProxy = (app, defaultValue = '1') => {
    const value = process.env.TRUST_PROXY ?? defaultValue;
    app.set('trust proxy', /^\d+$/.test(value) ? parseInt(value, 10) : value);
};

const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
]);

/**
 * GET /health        — liveness: the process is up (used by orchestrators to restart).
 * GET /health/ready  — readiness: every dependency check passes (used to route traffic).
 * @param {import('express').Application} app
 * @param {Record<string, () => Promise<unknown>>} checks
 */
const healthRoutes = (app, checks = {}, { service } = {}) => {
    app.get('/health', (req, res) => res.json({ service, status: 'ok', timestamp: new Date().toISOString() }));

    app.get('/health/ready', async (req, res) => {
        const results = {};
        await Promise.all(Object.entries(checks).map(async ([name, check]) => {
            try {
                await withTimeout(Promise.resolve(check()), 2000);
                results[name] = 'ok';
            } catch (err) {
                results[name] = `error: ${err.message}`;
            }
        }));
        const ready = Object.values(results).every((r) => r === 'ok');
        res.status(ready ? 200 : 503).json({ service, status: ready ? 'ready' : 'not_ready', checks: results });
    });
};

const notFoundHandler = (req, res) => {
    res.status(404).json({ error: 'Route not found' });
};

/**
 * Final error handler. Client errors (4xx) keep their message; server errors return a
 * generic message so internals (SQL, stack details) never reach the client.
 */
const errorHandler = (logger) => (err, req, res, next) => {
    const status = Number.isInteger(err.status || err.statusCode) ? (err.status || err.statusCode) : 500;
    (req.log || logger)[status >= 500 ? 'error' : 'warn']({ err }, 'Request failed');
    if (res.headersSent) return res.end();
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message || 'Request failed' });
};

/**
 * Start listening and shut down cleanly on SIGTERM/SIGINT: stop accepting connections,
 * run the onShutdown hooks (close DB/Redis), then exit. Forces exit after timeoutMs.
 */
const startServer = ({ app, port, logger, onShutdown = [], timeoutMs = 10000 }) => {
    const server = app.listen(port, () => logger.info({ port }, 'Server listening'));
    let shuttingDown = false;

    const shutdown = async (signal) => {
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
        server.closeIdleConnections?.();
        setTimeout(() => server.closeAllConnections?.(), timeoutMs / 2).unref();
        await new Promise((resolve) => server.close(resolve));
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

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    return server;
};

const { createMigrator, migrateUp, runCli: runMigrationCli } = require('./migrations');

module.exports = {
    createMigrator,
    migrateUp,
    runMigrationCli,
    createLogger,
    requestLogger,
    setTrustProxy,
    healthRoutes,
    notFoundHandler,
    errorHandler,
    startServer,
};
