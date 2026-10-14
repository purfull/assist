const express = require('express');
const rateLimit = require('express-rate-limit');
const platform = require('@ai-search/platform');
const logger = require('./shared/logger');
const { sequelize } = require('./config/database');
const fileRoutes = require('./routes/fileRoutes');

const uploadErrorHandler = (err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        const maxMb = process.env.MAX_FILE_SIZE_MB || 10;
        return res.status(413).json({ error: `File too large. Maximum allowed size is ${maxMb} MB.` });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files. Maximum 10 files per request.' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(415).json({ error: err.message || 'Unsupported file type.' });
    }
    next(err);
};

/**
 * Build the file-upload-service app. CORS and security headers are handled by the
 * gateway; this service must only be reachable through it.
 */
const createApp = () => {
    const app = express();
    app.disable('x-powered-by');
    platform.setTrustProxy(app, '1');

    app.use(platform.requestLogger(logger));
    platform.healthRoutes(app, { mysql: () => sequelize.authenticate() }, { service: 'file-upload-service' });

    app.use(express.json({ limit: '100kb' }));
    app.use(express.urlencoded({ extended: true, limit: '100kb' }));

    // In-memory counters: per instance. Move to a shared store if this service is scaled out.
    app.use(rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 200,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests, please try again later.' },
    }));
    // Stricter limit for upload endpoints
    app.use('/files/upload', rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 50,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Upload rate limit exceeded, please try again later.' },
    }));

    app.use('/files', fileRoutes);

    app.use(uploadErrorHandler);
    app.use(platform.notFoundHandler);
    app.use(platform.errorHandler(logger));
    return app;
};

module.exports = { createApp };
