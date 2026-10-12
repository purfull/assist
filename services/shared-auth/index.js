'use strict';

const jwt = require('jsonwebtoken');

/**
 * Centralized JWT authentication middleware.
 * Shared across all ai-search microservices.
 *
 * Usage:
 *   const { authenticate, requireVerified } = require('@ai-search/shared-auth');
 *   router.use(authenticate);
 *
 * Reads the JWT_ACCESS_SECRET env var — ensure each service's .env defines it
 * with the same value as the auth-service.
 */

/**
 * Verifies the Bearer token from the Authorization header (or ?token query param).
 * Attaches { userId, email, isVerified } to req.user on success.
 *
 * @type {import('express').RequestHandler}
 */
const authenticate = (req, res, next) => {
    try {
        let token;
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.query.token) {
            // Allow token via query string (useful for SSE / file downloads)
            token = req.query.token;
        }

        if (!token) {
            return res.status(401).json({ error: 'Please sign in to continue' });
        }

        // Support passing the raw PEM string or a path to the file
        let publicKey = process.env.JWT_PUBLIC_KEY;
        if (!publicKey && process.env.JWT_PUBLIC_KEY_PATH) {
            try {
                publicKey = require('fs').readFileSync(process.env.JWT_PUBLIC_KEY_PATH, 'utf8');
            } catch (err) {
                console.error('[shared-auth] Failed to read JWT_PUBLIC_KEY_PATH:', err.message);
            }
        }
        // Fallback for local monorepo development where auth-service generates keys
        if (!publicKey) {
            try {
                publicKey = require('fs').readFileSync(require('path').join(__dirname, '../keys/public.pem'), 'utf8');
            } catch (err) {
                // Ignore
            }
        }

        if (!publicKey) {
            console.error('[shared-auth] JWT_PUBLIC_KEY is not set in environment or file');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

        req.user = {
            userId: decoded.userId,
            email: decoded.email,
            isVerified: decoded.isVerified ?? false,
        };

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Session expired, please sign in again' });
        }
        return res.status(401).json({ error: 'Invalid token, please sign in again' });
    }
};

/**
 * Ensures the authenticated user has verified their email.
 * Must be used after `authenticate`.
 *
 * @type {import('express').RequestHandler}
 */
const requireVerified = (req, res, next) => {
    if (!req.user || !req.user.isVerified) {
        return res.status(403).json({ error: 'Email verification required' });
    }
    next();
};

module.exports = { authenticate, requireVerified };
