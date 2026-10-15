import type { ClientRequest, IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import express, { type Application, type Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware, type Filter } from 'http-proxy-middleware';
import * as platform from '@ai-search/platform';
import type { GatewayConfig } from './config';

/**
 * Build the gateway app. The gateway is the only internet-facing component, so it owns
 * edge concerns: security headers, CORS, coarse rate limiting, request IDs, client IP
 * forwarding and upstream timeouts. Services behind it must not be reachable directly.
 */
export const createApp = (config: GatewayConfig, logger: platform.Logger): Application => {
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

    const upstreamError = (err: Error & { code?: string }, req: IncomingMessage, res: ServerResponse | Socket): void => {
        ((req as Request).log ?? logger).error({ err, url: (req as Request).originalUrl }, 'Upstream request failed');
        if (!('setHeader' in res)) {
            res.destroy(); // WebSocket upgrade; not used, but keep the type honest
            return;
        }
        if (res.headersSent) {
            res.end();
            return;
        }
        const timedOut = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
        res.writeHead(timedOut ? 504 : 502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service temporarily unavailable' }));
    };

    // When the client goes away before the response finished (e.g. a closed browser tab on
    // an SSE stream), abort the upstream request too. http-proxy only listens for the
    // request's 'aborted' event, which Node no longer emits once a GET has been received,
    // so without this every closed stream leaks an open connection to the service.
    const abortUpstreamOnClientClose = (proxyReq: ClientRequest, _req: IncomingMessage, res: ServerResponse): void => {
        res.on('close', () => {
            if (!res.writableFinished) proxyReq.destroy();
        });
    };

    const proxy = (context: Filter, target: string, { timeout = config.PROXY_TIMEOUT_MS } = {}) =>
        createProxyMiddleware(context, {
            target,
            changeOrigin: true,
            xfwd: true, // X-Forwarded-For / -Proto so services see the real client
            // Upstream timeout only. http-proxy's `timeout` option is the *client* socket
            // timeout: it would cut the browser's connection before the 504 can be sent.
            proxyTimeout: timeout,
            onError: upstreamError,
            onProxyReq: abortUpstreamOnClientClose,
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
