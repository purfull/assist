const express = require('express');
const cookieParser = require('cookie-parser');
const platform = require('@ai-search/platform');
const logger = require('./shared/logger');
const { sequelize } = require('./shared/config/database');
const redis = require('./shared/config/redis');
const { generalLimiter } = require('./shared/middleware/rateLimiter');

// Bounded-context modules. Each exposes its public API from its index.js;
// see src/modules/README.md for ownership and import rules.
const identity = require('./modules/identity');
const billing = require('./modules/billing');
const notifications = require('./modules/notifications');
const support = require('./modules/support');

/**
 * Build the auth-service app. CORS and security headers are handled by the gateway;
 * this service must only be reachable through it.
 */
const createApp = () => {
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

module.exports = { createApp };
