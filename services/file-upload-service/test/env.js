/**
 * Test configuration; require first in every test file (modules read env on load).
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-svc-test-'));

const defaults = {
    LOG_LEVEL: 'silent',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_NAME: 'ai_search_test',
    DB_USER: 'root',
    DB_PASSWORD: '',
};
for (const [key, value] of Object.entries(defaults)) {
    if (process.env[key] === undefined) process.env[key] = value;
}
Object.assign(process.env, {
    NODE_ENV: 'test',
    UPLOAD_DIR: uploadDir,
    JWT_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
});
delete process.env.JWT_JWKS_URL;

/** Mint an access token the way auth-service does. */
const accessToken = (userId, extra = {}) => jwt.sign(
    { typ: 'access', userId, email: `u${userId}@example.com`, isVerified: true, ...extra },
    privateKey,
    { algorithm: 'RS256', issuer: 'ai-search-auth', audience: 'ai-search', expiresIn: '5m' }
);

// Minimal valid file contents for each type used in tests
const SAMPLES = {
    png: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
    pdf: Buffer.from('%PDF-1.4\n%test\n'),
    text: Buffer.from('hello,world\n'),
};

module.exports = { uploadDir, accessToken, SAMPLES };
