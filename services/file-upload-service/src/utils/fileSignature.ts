import fs from 'fs';

/**
 * Check that a file's leading bytes match its declared MIME type.
 *
 * The MIME type in a multipart upload comes from the client and can be anything, so
 * without this a script or executable could be stored as "image/png". Only the types
 * the service accepts are listed; anything unlisted is rejected.
 */
const startsWith = (buf: Buffer, bytes: number[], offset = 0): boolean => bytes.every((b, i) => buf[offset + i] === b);
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy .doc / .xls
const RIFF = ascii('RIFF');

// Text files: no NUL bytes in the sample
const isText = (buf: Buffer): boolean => !buf.includes(0x00);

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
    'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
    'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'image/gif': (b) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a')),
    'image/webp': (b) => startsWith(b, RIFF) && startsWith(b, ascii('WEBP'), 8),
    'application/pdf': (b) => startsWith(b, ascii('%PDF-')),
    'application/msword': (b) => startsWith(b, OLE),
    'application/vnd.ms-excel': (b) => startsWith(b, OLE),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) => startsWith(b, ZIP),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (b) => startsWith(b, ZIP),
    'application/zip': (b) => startsWith(b, ZIP),
    'application/x-zip-compressed': (b) => startsWith(b, ZIP),
    'text/plain': isText,
    'text/csv': isText,
    'video/mp4': (b) => startsWith(b, ascii('ftyp'), 4),
    'video/mpeg': (b) => startsWith(b, [0x00, 0x00, 0x01, 0xba]) || startsWith(b, [0x00, 0x00, 0x01, 0xb3]),
    'video/webm': (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]),
    'audio/mpeg': (b) => startsWith(b, ascii('ID3')) || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0),
    'audio/wav': (b) => startsWith(b, RIFF) && startsWith(b, ascii('WAVE'), 8),
    'audio/ogg': (b) => startsWith(b, ascii('OggS')),
};

const SAMPLE_BYTES = 4096;

const readSample = (filePath: string): Buffer => {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buf = Buffer.alloc(SAMPLE_BYTES);
        const bytesRead = fs.readSync(fd, buf, 0, SAMPLE_BYTES, 0);
        return buf.subarray(0, bytesRead);
    } finally {
        fs.closeSync(fd);
    }
};

/**
 * @param filePath - file on disk
 * @param mimeType - declared MIME type
 * @returns true if the content matches the declared type
 */
export const matchesDeclaredType = (filePath: string, mimeType: string): boolean => {
    const check = SIGNATURES[mimeType];
    if (!check) return false;
    const sample = readSample(filePath);
    return sample.length > 0 && check(sample);
};

export const SUPPORTED_TYPES = Object.keys(SIGNATURES);
