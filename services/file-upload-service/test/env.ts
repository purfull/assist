/**
 * Test configuration; import first in every test file (modules read env on load).
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
export const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-svc-test-'));

const defaults: Record<string, string> = {
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
    JWT_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }) as string,
});
delete process.env.JWT_JWKS_URL;

/** Mint an access token the way auth-service does. */
export const accessToken = (userId: number, extra: object = {}): string => jwt.sign(
    { typ: 'access', userId, email: `u${userId}@example.com`, isVerified: true, ...extra },
    privateKey,
    { algorithm: 'RS256', issuer: 'ai-search-auth', audience: 'ai-search', expiresIn: '5m' }
);

// Minimal valid file contents for each type used in tests
export const SAMPLES = {
    png: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
    pdf: Buffer.from('%PDF-1.4\n%test\n'),
    text: Buffer.from('hello,world\n'),
};

