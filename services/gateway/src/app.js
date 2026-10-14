const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const platform = require('@ai-search/platform');

/**
 * Build the gateway app. The gateway is the only internet-facing component, so it owns
 * edge concerns: security headers, CORS, coarse rate limiting, request IDs, client IP
 * forwarding and upstream timeouts. Services behind it must not be reachable directly.
 */
const createApp = (config, logger) => {
    const app = express();
    app.disable('x-powered-by');
    platform.setTrustProxy(app, config.TRUST_PROXY);

    app.use(platform.requestLogger(logger));
    app.use(helmet({
        // Files and API responses are fetched cross-origin by the frontend
        crossOriginResourcePolicy: { policy: 'cross-origin' },
    }));
    app.use(cors({
        origin: config.ALLOWED_ORIGINS,
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
        exposedHeaders: ['X-Request-Id'],
    }));

    // Coarse per-IP limit at the edge. Services keep their own, stricter per-route limits.
    // In-memory store: with several gateway replicas, each enforces the limit separately.
    app.use(rateLimit({
        windowMs: 60 * 1000,
        max: config.RATE_LIMIT_PER_MINUTE,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests, please try again later' },
        skip: (req) => req.path.startsWith('/health'),
    }));

    platform.healthRoutes(app, {}, { service: 'gateway' });

    const upstreamError = (err, req, res) => {
        (req.log || logger).error({ err, url: req.originalUrl }, 'Upstream request failed');
        if (res.headersSent) return res.end();
        const timedOut = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
        res.status(timedOut ? 504 : 502).json({ error: 'Service temporarily unavailable' });
    };

    const proxy = (context, target, { timeout = config.PROXY_TIMEOUT_MS } = {}) =>
        createProxyMiddleware(context, {
            target,
            changeOrigin: true,
            xfwd: true, // X-Forwarded-For / -Proto so services see the real client
            proxyTimeout: timeout,
            timeout,
            onError: upstreamError,
            logLevel: 'silent', // failures are logged by upstreamError with the request id
        });

    // SSE streams stay open indefinitely, so they must not get the normal timeout.
    // Registered first so it wins over the generic /auth proxy.
    app.use(proxy((path) => path === '/auth/credits/stream', config.AUTH_SERVICE_URL, { timeout: 0 }));
    app.use(proxy('/auth', config.AUTH_SERVICE_URL));
    app.use(proxy('/tickets', config.AUTH_SERVICE_URL));
    app.use(proxy('/files', config.FILE_UPLOAD_SERVICE_URL));

    app.use(platform.notFoundHandler);
    app.use(platform.errorHandler(logger));
    return app;
};

module.exports = { createApp };
