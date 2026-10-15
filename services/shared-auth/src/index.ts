import crypto, { type KeyObject } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { RequestHandler } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';

/**
 * Centralized JWT authentication middleware.
 * Shared across all ai-search microservices.
 *
 * Usage:
 *   import { authenticate, requireVerified } from '@ai-search/shared-auth';
 *   router.use(authenticate);
 *
 * Verifies RS256 access tokens issued by auth-service. Key source, in order:
 *   1. JWT_JWKS_URL — auth-service's /auth/.well-known/jwks.json (preferred; supports rotation)
 *   2. JWT_PUBLIC_KEY (PEM string) or JWT_PUBLIC_KEY_PATH
 *   3. services/keys/public.pem (local development only)
 * JWT_ISSUER / JWT_AUDIENCE must match the auth-service values (defaults: ai-search-auth / ai-search).
 */

/** The authenticated user attached to req.user. */
export interface AuthUser {
    userId: number;
    email: string;
    isVerified: boolean;
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        interface User extends AuthUser {}
        interface Request {
            user?: User | undefined;
        }
    }
}

interface AccessTokenClaims extends JwtPayload {
    typ?: string;
    userId?: number;
    email?: string;
    isVerified?: boolean;
}

interface Jwk extends crypto.JsonWebKey {
    kid?: string;
    use?: string;
}

const ISSUER = process.env.JWT_ISSUER || 'ai-search-auth';
const AUDIENCE = process.env.JWT_AUDIENCE || 'ai-search';

const JWKS_TTL_MS = 10 * 60 * 1000;      // refresh the key set every 10 minutes
const JWKS_MIN_REFETCH_MS = 30 * 1000;   // but at most every 30s when an unknown kid appears

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

let cachedPublicKey: string | undefined;

const loadStaticPublicKey = (): string | undefined => {
    if (cachedPublicKey) return cachedPublicKey;

    let publicKey = process.env.JWT_PUBLIC_KEY;
    if (!publicKey && process.env.JWT_PUBLIC_KEY_PATH) {
        try {
            publicKey = fs.readFileSync(process.env.JWT_PUBLIC_KEY_PATH, 'utf8');
        } catch (err) {
            console.error('[shared-auth] Failed to read JWT_PUBLIC_KEY_PATH:', errorMessage(err));
        }
    }
    // Fallback for local monorepo development only, where auth-service generates keys
    // (__dirname is services/shared-auth/src or /dist)
    if (!publicKey && process.env.NODE_ENV !== 'production') {
        try {
            publicKey = fs.readFileSync(path.join(__dirname, '../../keys/public.pem'), 'utf8');
        } catch {
            // Ignore
        }
    }

    cachedPublicKey = publicKey;
    return publicKey;
};

const jwks: { keys: Map<string, KeyObject>; fetchedAt: number; inflight: Promise<void> | null } = {
    keys: new Map(),
    fetchedAt: 0,
    inflight: null,
};

const fetchJwks = async (url: string): Promise<void> => {
    if (!jwks.inflight) {
        jwks.inflight = (async () => {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
                if (!res.ok) throw new Error(`JWKS request failed with ${res.status}`);
                const body = (await res.json()) as { keys?: Jwk[] };
                const keys = new Map<string, KeyObject>();
                for (const jwk of body.keys ?? []) {
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

const getJwksKey = async (url: string, kid: string): Promise<KeyObject | undefined> => {
    const age = Date.now() - jwks.fetchedAt;
    const stale = age > JWKS_TTL_MS;
    const unknownKid = !jwks.keys.has(kid) && age > JWKS_MIN_REFETCH_MS;
    if (stale || unknownKid) {
        try {
            await fetchJwks(url);
        } catch (err) {
            // Keep serving with the keys we already have; fail only if we have none
            console.error('[shared-auth] Failed to refresh JWKS:', errorMessage(err));
        }
    }
    return jwks.keys.get(kid);
};

const resolveKey = async (token: string): Promise<KeyObject | string | undefined> => {
    const url = process.env.JWT_JWKS_URL;
    if (!url) return loadStaticPublicKey();

    const kid = jwt.decode(token, { complete: true })?.header.kid;
    return kid ? getJwksKey(url, kid) : undefined;
};

const extractToken = (authHeader: string | undefined, queryToken: unknown): string | undefined => {
    if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7);
    // Allow token via query string (useful for SSE / file downloads)
    return typeof queryToken === 'string' && queryToken ? queryToken : undefined;
};

/**
 * Verifies the Bearer token from the Authorization header (or ?token query param).
 * Only access tokens (typ: "access") are accepted — refresh and reset tokens are rejected.
 * Attaches { userId, email, isVerified } to req.user on success.
 */
export const authenticate: RequestHandler = async (req, res, next) => {
    const token = extractToken(req.headers.authorization, req.query.token);
    if (!token) {
        res.status(401).json({ error: 'Please sign in to continue' });
        return;
    }

    let key: KeyObject | string | undefined;
    try {
        key = await resolveKey(token);
    } catch {
        key = undefined;
    }

    if (!key) {
        if (!process.env.JWT_JWKS_URL) {
            console.error('[shared-auth] JWT_PUBLIC_KEY is not set in environment or file');
            res.status(500).json({ error: 'Server configuration error' });
            return;
        }
        // Unknown or missing kid
        res.status(401).json({ error: 'Invalid token, please sign in again' });
        return;
    }

    let claims: AccessTokenClaims;
    try {
        const decoded = jwt.verify(token, key, {
            algorithms: ['RS256'],
            issuer: ISSUER,
            audience: AUDIENCE,
        });
        if (typeof decoded === 'string') throw new Error('Unexpected string payload');
        claims = decoded;
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            res.status(401).json({ error: 'Session expired, please sign in again' });
            return;
        }
        res.status(401).json({ error: 'Invalid token, please sign in again' });
        return;
    }

    if (claims.typ !== 'access' || typeof claims.userId !== 'number') {
        res.status(401).json({ error: 'Invalid token, please sign in again' });
        return;
    }

    req.user = {
        userId: claims.userId,
        email: claims.email ?? '',
        isVerified: claims.isVerified ?? false,
    };

    next();
};

/**
 * Ensures the authenticated user has verified their email.
 * Must be used after `authenticate`.
 */
export const requireVerified: RequestHandler = (req, res, next) => {
    if (!req.user?.isVerified) {
        res.status(403).json({ error: 'Email verification required' });
        return;
    }
    next();
};

/** Test hook: forget cached keys. */
export const _resetKeyCache = (): void => {
    cachedPublicKey = undefined;
    jwks.keys = new Map();
    jwks.fetchedAt = 0;
};
