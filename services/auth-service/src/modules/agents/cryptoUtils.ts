import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';

/**
 * Derives a 32-byte AES key from the KEY_SECRET env variable.
 */
const getAesKey = (): Buffer => {
    const keySecret = process.env.KEY_SECRET;
    if (!keySecret) {
        throw new Error('KEY_SECRET is not set; refusing to encrypt API keys with a default secret.');
    }
    return crypto.createHash('sha256').update(keySecret).digest(); // always 32 bytes
};

/**
 * AES-256-CBC encrypt a plaintext string.
 * Returns: "iv_hex:ciphertext_hex"
 */
export const encryptKey = (plaintext: string): string => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, getAesKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
};

/**
 * AES-256-CBC decrypt a ciphertext produced by encryptKey.
 */
export const decryptKey = (ciphertext: string): string => {
    const [ivHex, encryptedHex] = ciphertext.split(':');
    if (!ivHex || !encryptedHex) {
        throw new Error('Malformed ciphertext: expected "iv:ciphertext"');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getAesKey(), iv);
    const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
    return decrypted.toString('utf8');
};

/**
 * SHA-256 hash of a plaintext key — used for fast lookup without decryption.
 */
export const hashKey = (plaintext: string): string => {
    return crypto.createHash('sha256').update(plaintext).digest('hex');
};

