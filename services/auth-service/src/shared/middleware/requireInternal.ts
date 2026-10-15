import crypto from 'crypto';
import type { RequestHandler } from 'express';
import logger from '../logger';

/**
 * Middleware for service-to-service endpoints.
 * Callers must send the shared INTERNAL_SERVICE_TOKEN in the X-Internal-Token header.
 */
export const requireInternal: RequestHandler = (req, res, next) => {
    const expected = process.env.INTERNAL_SERVICE_TOKEN;
    const received = req.headers['x-internal-token'];

    if (!expected) {
        logger.error('INTERNAL_SERVICE_TOKEN is not configured; rejecting internal request');
        res.status(503).json({ error: 'Service unavailable' });
        return;
    }

    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(typeof received === 'string' ? received : '');
    if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    next();
};
