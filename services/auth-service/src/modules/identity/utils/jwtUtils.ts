import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import logger from '../../../shared/logger';

const ISSUER = process.env.JWT_ISSUER || 'ai-search-auth';
const AUDIENCE = process.env.JWT_AUDIENCE || 'ai-search';

/**
 * Token types. Every token carries `typ` so one kind can never be accepted as another
 * (e.g. a refresh or password-reset token used as an access token).
 */
export type TokenType = 'access' | 'refresh' | 'reset';

export interface AccessTokenPayload {
    userId: number;
    email: string;
    isVerified: boolean;
}

export interface UserIdPayload {
    userId: number;
}

/** Claims of a verified token: our payload plus typ and the registered JWT claims. */
export type VerifiedToken<T> = T & JwtPayload & { typ: TokenType };

type ExpiresIn = NonNullable<SignOptions['expiresIn']>;

/**
 * Load the RSA key pair.
 * Priority: JWT_PRIVATE_KEY / JWT_PUBLIC_KEY (PEM strings) → *_PATH env vars → local dev keys dir.
 * Keys are only auto-generated outside production; in production missing keys are fatal,
 * because each instance generating its own key pair would break token verification.
 */
const loadKeys = (): { privateKey: string; publicKey: string } => {
    const readPath = (p: string): string => fs.readFileSync(p, 'utf8');

    let privateKey = process.env.JWT_PRIVATE_KEY;
    let publicKey = process.env.JWT_PUBLIC_KEY;
    if (!privateKey && process.env.JWT_PRIVATE_KEY_PATH) privateKey = readPath(process.env.JWT_PRIVATE_KEY_PATH);
    if (!publicKey && process.env.JWT_PUBLIC_KEY_PATH) publicKey = readPath(process.env.JWT_PUBLIC_KEY_PATH);
    if (privateKey && publicKey) return { privateKey, publicKey };

    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT keys are not configured. Set JWT_PRIVATE_KEY(_PATH) and JWT_PUBLIC_KEY(_PATH).');
    }

    // Local development only: keys live in services/keys (git-ignored).
    // __dirname is src/modules/identity/utils or the same path under dist/.
    const keysDir = path.join(__dirname, '../../../../../keys');
    const privateKeyPath = path.join(keysDir, 'private.pem');
    const publicKeyPath = path.join(keysDir, 'public.pem');

    if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
        fs.mkdirSync(keysDir, { recursive: true });
        const generated = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
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

const sign = (payload: object, typ: TokenType, expiresIn: ExpiresIn, options: SignOptions = {}): string =>
    jwt.sign({ ...payload, typ }, PRIVATE_KEY, {
        algorithm: 'RS256',
        keyid: KEY_ID,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn,
        ...options,
    });

const verify = <T>(token: string, typ: TokenType): VerifiedToken<T> => {
    try {
        const decoded = jwt.verify(token, PUBLIC_KEY, {
            algorithms: ['RS256'],
            issuer: ISSUER,
            audience: AUDIENCE,
        });
        if (typeof decoded === 'string' || decoded.typ !== typ) throw new Error('Unexpected token type');
        return decoded as VerifiedToken<T>;
    } catch {
        throw new Error('Session expired, please sign in again');
    }
};

/** Generate access token */
export const generateAccessToken = (payload: AccessTokenPayload): string =>
    sign(payload, 'access', (process.env.JWT_ACCESS_EXPIRY || '15m') as ExpiresIn);

/** Generate refresh token (unique per call via jti) */
export const generateRefreshToken = (payload: UserIdPayload): string =>
    sign(payload, 'refresh', (process.env.JWT_REFRESH_EXPIRY || '7d') as ExpiresIn, { jwtid: crypto.randomUUID() });

/** Generate password reset token. Its jti is stored in Redis so the link can be used once. */
export const generateResetToken = (payload: UserIdPayload): { token: string; jti: string } => {
    const jti = crypto.randomUUID();
    const token = sign(payload, 'reset', '1h', { jwtid: jti });
    return { token, jti };
};

export const verifyAccessToken = (token: string): VerifiedToken<AccessTokenPayload> =>
    verify<AccessTokenPayload>(token, 'access');

export const verifyRefreshToken = (token: string): VerifiedToken<UserIdPayload> =>
    verify<UserIdPayload>(token, 'refresh');

export const verifyResetToken = (token: string): VerifiedToken<UserIdPayload> =>
    verify<UserIdPayload>(token, 'reset');

/**
 * SHA-256 of a refresh token. Only this hash is stored in refresh_tokens, so a leaked
 * table can't be replayed as sessions. Fixed 64 chars regardless of token length.
 */
export const hashRefreshToken = (token: string): string =>
    crypto.createHash('sha256').update(token).digest('hex');

/** Get the public key (PEM) to expose to external microservices */
export const getPublicKey = (): string => PUBLIC_KEY;

/** Public signing keys as a JSON Web Key Set (served at /auth/.well-known/jwks.json) */
export const getJwks = (): { keys: Array<crypto.JsonWebKey & { kid: string; use: 'sig'; alg: 'RS256' }> } => ({
    keys: [{ ...PUBLIC_JWK, kid: KEY_ID, use: 'sig', alg: 'RS256' }],
});
