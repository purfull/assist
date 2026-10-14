import type { Request, RequestHandler } from 'express';
import { verifyAccessToken } from './utils/jwtUtils';
import User from './models/User';
import type { AuthUser } from './types';

const extractToken = (req: Request): string | undefined => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7);
    // Query parameter for SSE, where browsers can't set headers
    const { token } = req.query;
    return typeof token === 'string' && token ? token : undefined;
};

/**
 * Verify the JWT access token and load the user, so deleted users lose access at once.
 */
export const authenticate: RequestHandler = async (req, res, next) => {
    const token = extractToken(req);
    if (!token) {
        res.status(401).json({ error: 'Please sign in to continue' });
        return;
    }

    try {
        const decoded = verifyAccessToken(token);
        const user = await User.findByPk(decoded.userId);
        if (!user) {
            res.status(401).json({ error: 'Session invalid, please sign in again' });
            return;
        }
        req.user = { userId: user.id, email: user.email, isVerified: user.isVerified };
    } catch {
        res.status(401).json({ error: 'Session expired, please sign in again' });
        return;
    }
    next();
};

/** Require a verified email. Must run after authenticate. */
export const requireVerified: RequestHandler = (req, res, next) => {
    if (!req.user?.isVerified) {
        res.status(403).json({ error: 'Email verification required' });
        return;
    }
    next();
};

/**
 * The authenticated user. Only call in handlers mounted after `authenticate`;
 * throws if the route was wired without it.
 */
export const currentUser = (req: { user?: AuthUser | undefined }): AuthUser => {
    if (!req.user) throw new Error('currentUser() called on a route without authenticate');
    return req.user;
};
