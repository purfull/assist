import express, { type Application } from 'express';
import cookieParser from 'cookie-parser';
import * as platform from '@ai-search/platform';
import logger from './shared/logger';
import { sequelize } from './shared/config/database';
import redis from './shared/config/redis';
import { generalLimiter } from './shared/middleware/rateLimiter';

// Bounded-context modules. Each exposes its public API from its index.ts;
// see src/modules/README.md for ownership and import rules.
import * as identity from './modules/identity';
import * as billing from './modules/billing';
import * as notifications from './modules/notifications';
import * as support from './modules/support';

/**
 * Build the auth-service app. CORS and security headers are handled by the gateway;
 * this service must only be reachable through it.
 */
export const createApp = (): Application => {
    const app = express();
    app.disable('x-powered-by');
    platform.setTrustProxy(app, '1');

    app.use(platform.requestLogger(logger));

    // Health checks sit before rate limiting so probes are never throttled
    platform.healthRoutes(app, {
        mysql: () => sequelize.authenticate(),
        redis: () => redis.ping(),
    }, { service: 'auth-service' });

    app.use(express.json({ limit: '100kb' }));
    app.use(express.urlencoded({ extended: true, limit: '100kb' }));
    app.use(cookieParser());
    app.use(generalLimiter);
    app.use(identity.passport.initialize());

    // Routes (public URLs unchanged)
    app.use('/auth/payment', billing.router);
    app.use('/auth', identity.router);
    app.use('/auth', notifications.router);
    app.use('/tickets', support.router);

    app.use(platform.notFoundHandler);
    app.use(platform.errorHandler(logger));
    return app;
};
