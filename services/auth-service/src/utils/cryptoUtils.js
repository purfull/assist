const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const KEY_SECRET = process.env.KEY_SECRET || 'default_secret_key_must_be_32_ch'; // 32 chars

/**
 * Derives a 32-byte AES key from the KEY_SECRET env variable.
 */
const getAesKey = () => {
    return crypto.createHash('sha256').update(KEY_SECRET).digest(); // always 32 bytes
};

/**
 * AES-256-CBC encrypt a plaintext string.
 * Returns: "iv_hex:ciphertext_hex"
 */
const encryptKey = (plaintext) => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, getAesKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
};

/**
 * AES-256-CBC decrypt a ciphertext produced by encryptKey.
 */
const decryptKey = (ciphertext) => {
    const [ivHex, encryptedHex] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getAesKey(), iv);
    const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
    return decrypted.toString('utf8');
};

/**
 * SHA-256 hash of a plaintext key — used for fast lookup without decryption.
 */
const hashKey = (plaintext) => {
    return crypto.createHash('sha256').update(plaintext).digest('hex');
};

module.exports = { encryptKey, decryptKey, hashKey };
