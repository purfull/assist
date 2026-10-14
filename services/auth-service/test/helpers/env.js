/**
 * Test configuration. Require this first in every test file: modules read process.env
 * when they load (JWT keys, OAuth, Razorpay), so it must be set before anything else.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-keys-'));
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
fs.writeFileSync(path.join(keyDir, 'private.pem'), privateKey);
fs.writeFileSync(path.join(keyDir, 'public.pem'), publicKey);

const defaults = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_NAME: 'ai_search_test',
    DB_USER: 'root',
    DB_PASSWORD: '',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '6379',
    JWT_PRIVATE_KEY_PATH: path.join(keyDir, 'private.pem'),
    JWT_PUBLIC_KEY_PATH: path.join(keyDir, 'public.pem'),
    FRONTEND_URL: 'http://localhost:3000',
    MAIL_TRANSPORT: 'log',
    GOOGLE_CLIENT_ID: 'test-google-client',
    GOOGLE_CLIENT_SECRET: 'test-google-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:5000/auth/google/callback',
    RAZORPAY_KEY_ID: 'rzp_test_key',
    RAZORPAY_KEY_SECRET: 'rzp_test_secret',
    INTERNAL_SERVICE_TOKEN: 'test-internal-token-0123456789abcdef',
};

// Explicit environment (e.g. CI database credentials) wins over the defaults
for (const [key, value] of Object.entries(defaults)) {
    if (process.env[key] === undefined) process.env[key] = value;
}
process.env.NODE_ENV = 'test';
process.env.MAIL_TRANSPORT = 'log';

module.exports = { keyDir };
