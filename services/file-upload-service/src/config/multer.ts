import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

/**
 * Default set of allowed MIME types.
 * Can be overridden via ALLOWED_MIME_TYPES env var (comma-separated).
 */
const DEFAULT_ALLOWED_MIME_TYPES = new Set([
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    // image/svg+xml is deliberately excluded: SVG can carry scripts (stored XSS)
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    // Video
    'video/mp4',
    'video/mpeg',
    'video/webm',
    // Audio
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    // Archives
    'application/zip',
    'application/x-zip-compressed',
]);

const getAllowedMimeTypes = (): Set<string> => {
    if (process.env.ALLOWED_MIME_TYPES) {
        return new Set(process.env.ALLOWED_MIME_TYPES.split(',').map((t) => t.trim().toLowerCase()));
    }
    return DEFAULT_ALLOWED_MIME_TYPES;
};

const getMaxFileSizeBytes = (): number => {
    const mb = parseFloat(process.env.MAX_FILE_SIZE_MB ?? '') || 10;
    return mb * 1024 * 1024;
};

const storage = multer.diskStorage({
    /**
     * Save files under: UPLOAD_DIR/<userId>/<uuid>.<ext>
     * The userId comes from req.user, set by the authenticate middleware.
     */
    destination: (req, _file, cb) => {
        const baseDir = path.resolve(process.env.UPLOAD_DIR || 'uploads');
        const userId = req.user ? String(req.user.userId) : 'anonymous';
        const userDir = path.join(baseDir, userId);

        // Create the user-specific directory if it does not exist. Errors must go to the
        // callback: a throw here escapes multer's stream handling and crashes the process.
        fs.mkdir(userDir, { recursive: true }, (err) => cb(err ?? null, userDir));
    },

    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${uuidv4()}${ext}`);
    },
});

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
    if (getAllowedMimeTypes().has(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `File type "${file.mimetype}" is not allowed`));
    }
};

/**
 * Multer upload instance.
 * - Accepts up to 10 files per request on the field name "files"
 * - Per-user disk storage: uploads/<userId>/<uuid>.<ext>
 * - Enforces MIME type allowlist and file size limit
 */
const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: getMaxFileSizeBytes(),
        files: 10, // max 10 files per request
    },
});

export default upload;
