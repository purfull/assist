const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keysDir = path.join(__dirname, '../../../keys');
const privateKeyPath = path.join(keysDir, 'private.pem');
const publicKeyPath = path.join(keysDir, 'public.pem');

// Automatically generate keys if they don't exist
if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
    if (!fs.existsSync(keysDir)) {
        fs.mkdirSync(keysDir, { recursive: true });
    }
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    fs.writeFileSync(privateKeyPath, privateKey);
    fs.writeFileSync(publicKeyPath, publicKey);
    console.log('✓ RSA keys generated successfully for JWT signing/verification.');
}

const PRIVATE_KEY = fs.readFileSync(privateKeyPath, 'utf8');
const PUBLIC_KEY = fs.readFileSync(publicKeyPath, 'utf8');

/**
 * Generate access token
 * @param {object} payload - Token payload (userId, email)
 * @returns {string} - JWT access token
 */
const generateAccessToken = (payload) => {
    return jwt.sign(payload, PRIVATE_KEY, {
        algorithm: 'RS256',
        expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m'
    });
};

/**
 * Generate refresh token
 * @param {object} payload - Token payload (userId)
 * @returns {string} - JWT refresh token
 */
const generateRefreshToken = (payload) => {
    return jwt.sign(payload, PRIVATE_KEY, {
        algorithm: 'RS256',
        expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d'
    });
};

/**
 * Generate password reset token
 * @param {object} payload - Token payload (userId, purpose)
 * @returns {string} - JWT reset token
 */
const generateResetToken = (payload) => {
    return jwt.sign(payload, PRIVATE_KEY, {
        algorithm: 'RS256',
        expiresIn: '1h'
    });
};

/**
 * Verify access token
 * @param {string} token - JWT access token
 * @returns {object} - Decoded token payload
 */
const verifyAccessToken = (token) => {
    try {
        return jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });
    } catch (error) {
        throw new Error('Session expired, please sign in again');
    }
};

/**
 * Verify refresh token
 * @param {string} token - JWT refresh token
 * @returns {object} - Decoded token payload
 */
const verifyRefreshToken = (token) => {
    try {
        return jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });
    } catch (error) {
        throw new Error('Session expired, please sign in again');
    }
};

/**
 * Get the public key to expose to external microservices
 */
const getPublicKey = () => {
    return PUBLIC_KEY;
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    generateResetToken,
    verifyAccessToken,
    verifyRefreshToken,
    getPublicKey
};
