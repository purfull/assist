const { verifyAccessToken } = require('../utils/jwtUtils');
const User = require('../models/User');

/**
 * Middleware to verify JWT access token
 */
const authenticate = async (req, res, next) => {
    try {
        // Get token from Authorization header or query parameter for SSE
        let token;
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7); // Remove 'Bearer ' prefix
        } else if (req.query.token) {
            token = req.query.token;
        }

        if (!token) {
            return res.status(401).json({ error: 'Please sign in to continue' });
        }

        // Verify token
        const decoded = verifyAccessToken(token);

        // Get user from database
        const user = await User.findByPk(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'Session invalid, please sign in again' });
        }

        // Attach user to request
        req.user = {
            userId: user.id,
            email: user.email,
            isVerified: user.isVerified
        };

        next();
    } catch (error) {
        return res.status(401).json({ error: 'Session expired, please sign in again' });
    }
};

/**
 * Middleware to check if user is verified
 */
const requireVerified = (req, res, next) => {
    if (!req.user || !req.user.isVerified) {
        return res.status(403).json({ error: 'Email verification required' });
    }
    next();
};

module.exports = {
    authenticate,
    requireVerified
};
