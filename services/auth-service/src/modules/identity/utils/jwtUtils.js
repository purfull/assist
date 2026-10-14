const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/logger');

const ISSUER = process.env.JWT_ISSUER || 'ai-search-auth';
const AUDIENCE = process.env.JWT_AUDIENCE || 'ai-search';

// Token types. Every token carries `typ` so one kind can never be accepted as another
// (e.g. a refresh or password-reset token used as an access token).
const TOKEN_TYPES = {
    ACCESS: 'access',
    REFRESH: 'refresh',
    RESET: 'reset'
};

/**
 * Load the RSA key pair.
 * Priority: JWT_PRIVATE_KEY / JWT_PUBLIC_KEY (PEM strings) → *_PATH env vars → local dev keys dir.
 * Keys are only auto-generated outside production; in production missing keys are fatal,
 * because each instance generating its own key pair would break token verification.
 */
const loadKeys = () => {
    const readPath = (p) => fs.readFileSync(p, 'utf8');

    let privateKey = process.env.JWT_PRIVATE_KEY;
    let publicKey = process.env.JWT_PUBLIC_KEY;
    if (!privateKey && process.env.JWT_PRIVATE_KEY_PATH) privateKey = readPath(process.env.JWT_PRIVATE_KEY_PATH);
    if (!publicKey && process.env.JWT_PUBLIC_KEY_PATH) publicKey = readPath(process.env.JWT_PUBLIC_KEY_PATH);
    if (privateKey && publicKey) return { privateKey, publicKey };

    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT keys are not configured. Set JWT_PRIVATE_KEY(_PATH) and JWT_PUBLIC_KEY(_PATH).');
    }

    // Local development only: keys live in services/keys (git-ignored)
    const keysDir = path.join(__dirname, '../../../../../keys');
    const privateKeyPath = path.join(keysDir, 'private.pem');
    const publicKeyPath = path.join(keysDir, 'public.pem');

    if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
        fs.mkdirSync(keysDir, { recursive: true });
        const generated = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        fs.writeFileSync(privateKeyPath, generated.privateKey, { mode: 0o600 });
        fs.writeFileSync(publicKeyPath, generated.publicKey);
        logger.warn('Generated development RSA keys in services/keys (do not commit)');
    }

    return { privateKey: readPath(privateKeyPath), publicKey: readPath(publicKeyPath) };
};

const { privateKey: PRIVATE_KEY, publicKey: PUBLIC_KEY } = loadKeys();

// Key id: RFC 7638 JWK thumbprint of the public key. Tokens carry it in their header so
// verifiers can pick the right key from the JWKS, which allows key rotation later.
const PUBLIC_JWK = crypto.createPublicKey(PUBLIC_KEY).export({ format: 'jwk' });
const KEY_ID = crypto
    .createHash('sha256')
    .update(JSON.stringify({ e: PUBLIC_JWK.e, kty: PUBLIC_JWK.kty, n: PUBLIC_JWK.n }))
    .digest('base64url');

const sign = (payload, typ, expiresIn, options = {}) => {
    return jwt.sign({ ...payload, typ }, PRIVATE_KEY, {
        algorithm: 'RS256',
        keyid: KEY_ID,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn,
        ...options
    });
};

const verify = (token, typ) => {
    try {
        const decoded = jwt.verify(token, PUBLIC_KEY, {
            algorithms: ['RS256'],
            issuer: ISSUER,
            audience: AUDIENCE
        });
        if (decoded.typ !== typ) throw new Error('Unexpected token type');
        return decoded;
    } catch (error) {
        throw new Error('Session expired, please sign in again');
    }
};

/**
 * Generate access token
 * @param {object} payload - Token payload (userId, email)
 * @returns {string} - JWT access token
 */
const generateAccessToken = (payload) => {
    return sign(payload, TOKEN_TYPES.ACCESS, process.env.JWT_ACCESS_EXPIRY || '15m');
};

/**
 * Generate refresh token
 * @param {object} payload - Token payload (userId)
 * @returns {string} - JWT refresh token
 */
const generateRefreshToken = (payload) => {
    return sign(payload, TOKEN_TYPES.REFRESH, process.env.JWT_REFRESH_EXPIRY || '7d', {
        jwtid: crypto.randomUUID()
    });
};

/**
 * Generate password reset token. Carries a jti so it can be made single-use.
 * @param {object} payload - Token payload (userId)
 * @returns {{ token: string, jti: string }}
 */
const generateResetToken = (payload) => {
    const jti = crypto.randomUUID();
    const token = sign(payload, TOKEN_TYPES.RESET, '1h', { jwtid: jti });
    return { token, jti };
};

/**
 * Verify access token
 * @param {string} token - JWT access token
 * @returns {object} - Decoded token payload
 */
const verifyAccessToken = (token) => verify(token, TOKEN_TYPES.ACCESS);

/**
 * Verify refresh token
 * @param {string} token - JWT refresh token
 * @returns {object} - Decoded token payload
 */
const verifyRefreshToken = (token) => verify(token, TOKEN_TYPES.REFRESH);

/**
 * Verify password reset token
 * @param {string} token - JWT reset token
 * @returns {object} - Decoded token payload (includes jti)
 */
const verifyResetToken = (token) => verify(token, TOKEN_TYPES.RESET);

/**
 * SHA-256 of a refresh token. Only this hash is stored in refresh_tokens, so a leaked
 * table can't be replayed as sessions. Fixed 64 chars regardless of token length.
 * @param {string} token
 * @returns {string}
 */
const hashRefreshToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Get the public key to expose to external microservices
 */
const getPublicKey = () => {
    return PUBLIC_KEY;
};

/**
 * Public signing keys as a JSON Web Key Set (served at /auth/.well-known/jwks.json)
 */
const getJwks = () => ({
    keys: [{ ...PUBLIC_JWK, kid: KEY_ID, use: 'sig', alg: 'RS256' }]
});

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    generateResetToken,
    verifyAccessToken,
    verifyRefreshToken,
    verifyResetToken,
    hashRefreshToken,
    getPublicKey,
    getJwks
};
