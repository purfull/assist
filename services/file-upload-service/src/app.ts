import express, { type Application, type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { MulterError } from 'multer';
import * as platform from '@ai-search/platform';
import logger from './shared/logger';
import { sequelize } from './config/database';
import fileRoutes from './routes/fileRoutes';

/** Turn multer limit errors into client errors; everything else goes to the error handler. */
const uploadErrorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
    if (err instanceof MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            const maxMb = process.env.MAX_FILE_SIZE_MB || 10;
            res.status(413).json({ error: `File too large. Maximum allowed size is ${maxMb} MB.` });
            return;
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            res.status(400).json({ error: 'Too many files. Maximum 10 files per request.' });
            return;
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            res.status(415).json({ error: err.message || 'Unsupported file type.' });
            return;
        }
    }
    next(err);
};

/**
 * Build the file-upload-service app. CORS and security headers are handled by the
 * gateway; this service must only be reachable through it.
 */
export const createApp = (): Application => {
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
