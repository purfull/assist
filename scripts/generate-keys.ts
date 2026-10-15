/**
 * Generate an RSA key pair for local JWT signing into services/keys/ (git-ignored).
 * Used by local development and docker compose. Production keys come from your
 * secrets manager, never from this script.
 *
 * Usage: npm run keys:generate [-- --force]   (runs with tsx)
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const dir = path.join(__dirname, '../services/keys');
const privatePath = path.join(dir, 'private.pem');
const publicPath = path.join(dir, 'public.pem');

if (fs.existsSync(privatePath) && !process.argv.includes('--force')) {
    console.log(`Keys already exist in ${dir} (use --force to replace them; existing sessions will be invalidated).`);
    process.exit(0);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

fs.mkdirSync(dir, { recursive: true });
// World-readable on purpose: docker compose mounts this directory into containers that run
// as a different, non-root user. Acceptable for throwaway development keys only.
fs.writeFileSync(privatePath, privateKey, { mode: 0o644 });
fs.writeFileSync(publicPath, publicKey, { mode: 0o644 });
console.log(`Generated development JWT keys in ${dir}`);
