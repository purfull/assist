const crypto = require('crypto');
const logger = require('../logger');

/**
 * Middleware for service-to-service endpoints.
 * Callers must send the shared INTERNAL_SERVICE_TOKEN in the X-Internal-Token header.
 */
const requireInternal = (req, res, next) => {
    const expected = process.env.INTERNAL_SERVICE_TOKEN;
    const received = req.headers['x-internal-token'];

    if (!expected) {
        logger.error('INTERNAL_SERVICE_TOKEN is not configured; rejecting internal request');
        return res.status(503).json({ error: 'Service unavailable' });
    }

    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(typeof received === 'string' ? received : '');
    if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
};

module.exports = { requireInternal };
