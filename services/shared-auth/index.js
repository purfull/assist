'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

/**
 * Centralized JWT authentication middleware.
 * Shared across all ai-search microservices.
 *
 * Usage:
 *   const { authenticate, requireVerified } = require('@ai-search/shared-auth');
 *   router.use(authenticate);
 *
 * Verifies RS256 access tokens issued by auth-service. Key source, in order:
 *   1. JWT_JWKS_URL — auth-service's /auth/.well-known/jwks.json (preferred; supports rotation)
 *   2. JWT_PUBLIC_KEY (PEM string) or JWT_PUBLIC_KEY_PATH
 *   3. services/keys/public.pem (local development only)
 * JWT_ISSUER / JWT_AUDIENCE must match the auth-service values (defaults: ai-search-auth / ai-search).
 */

const ISSUER = process.env.JWT_ISSUER || 'ai-search-auth';
const AUDIENCE = process.env.JWT_AUDIENCE || 'ai-search';

const JWKS_TTL_MS = 10 * 60 * 1000;      // refresh the key set every 10 minutes
const JWKS_MIN_REFETCH_MS = 30 * 1000;   // but at most every 30s when an unknown kid appears

let cachedPublicKey;

const loadStaticPublicKey = () => {
    if (cachedPublicKey) return cachedPublicKey;

    let publicKey = process.env.JWT_PUBLIC_KEY;
    if (!publicKey && process.env.JWT_PUBLIC_KEY_PATH) {
        try {
            publicKey = fs.readFileSync(process.env.JWT_PUBLIC_KEY_PATH, 'utf8');
        } catch (err) {
            console.error('[shared-auth] Failed to read JWT_PUBLIC_KEY_PATH:', err.message);
        }
    }
    // Fallback for local monorepo development only, where auth-service generates keys
    if (!publicKey && process.env.NODE_ENV !== 'production') {
        try {
            publicKey = fs.readFileSync(path.join(__dirname, '../keys/public.pem'), 'utf8');
        } catch (err) {
            // Ignore
        }
    }

    cachedPublicKey = publicKey;
    return publicKey;
};

const jwks = { keys: new Map(), fetchedAt: 0, inflight: null };

const fetchJwks = async (url) => {
    if (!jwks.inflight) {
        jwks.inflight = (async () => {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
                if (!res.ok) throw new Error(`JWKS request failed with ${res.status}`);
                const body = await res.json();
                const keys = new Map();
                for (const jwk of body.keys || []) {
                    if (jwk.kty === 'RSA' && jwk.kid && (!jwk.use || jwk.use === 'sig')) {
                        keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
                    }
                }
                jwks.keys = keys;
                jwks.fetchedAt = Date.now();
            } finally {
                jwks.inflight = null;
            }
        })();
    }
    return jwks.inflight;
};

const getJwksKey = async (url, kid) => {
    const age = Date.now() - jwks.fetchedAt;
    const stale = age > JWKS_TTL_MS;
    const unknownKid = !jwks.keys.has(kid) && age > JWKS_MIN_REFETCH_MS;
    if (stale || unknownKid) {
        try {
            await fetchJwks(url);
        } catch (err) {
            // Keep serving with the keys we already have; fail only if we have none
            console.error('[shared-auth] Failed to refresh JWKS:', err.message);
        }
    }
    return jwks.keys.get(kid);
};

const resolveKey = async (token) => {
    const url = process.env.JWT_JWKS_URL;
    if (!url) return loadStaticPublicKey();

    const decoded = jwt.decode(token, { complete: true });
    const kid = decoded && decoded.header && decoded.header.kid;
    return kid ? getJwksKey(url, kid) : undefined;
};

/**
 * Verifies the Bearer token from the Authorization header (or ?token query param).
 * Only access tokens (typ: "access") are accepted — refresh and reset tokens are rejected.
 * Attaches { userId, email, isVerified } to req.user on success.
 *
 * @type {import('express').RequestHandler}
 */
const authenticate = async (req, res, next) => {
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

    let key;
    try {
        key = await resolveKey(token);
    } catch (err) {
        key = undefined;
    }

    if (!key) {
        if (!process.env.JWT_JWKS_URL) {
            console.error('[shared-auth] JWT_PUBLIC_KEY is not set in environment or file');
            return res.status(500).json({ error: 'Server configuration error' });
        }
        // Unknown or missing kid
        return res.status(401).json({ error: 'Invalid token, please sign in again' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, key, {
            algorithms: ['RS256'],
            issuer: ISSUER,
            audience: AUDIENCE,
        });
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Session expired, please sign in again' });
        }
        return res.status(401).json({ error: 'Invalid token, please sign in again' });
    }

    if (decoded.typ !== 'access') {
        return res.status(401).json({ error: 'Invalid token, please sign in again' });
    }

    req.user = {
        userId: decoded.userId,
        email: decoded.email,
        isVerified: decoded.isVerified ?? false,
    };

    next();
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

/** Test hook: forget cached keys. */
const _resetKeyCache = () => {
    cachedPublicKey = undefined;
    jwks.keys = new Map();
    jwks.fetchedAt = 0;
};

module.exports = { authenticate, requireVerified, _resetKeyCache };
