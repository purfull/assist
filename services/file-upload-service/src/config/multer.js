'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

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
    'image/svg+xml',
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

const getAllowedMimeTypes = () => {
    if (process.env.ALLOWED_MIME_TYPES) {
        return new Set(
            process.env.ALLOWED_MIME_TYPES.split(',').map((t) => t.trim().toLowerCase())
        );
    }
    return DEFAULT_ALLOWED_MIME_TYPES;
};

const getMaxFileSizeBytes = () => {
    const mb = parseFloat(process.env.MAX_FILE_SIZE_MB) || 10;
    return mb * 1024 * 1024;
};

const storage = multer.diskStorage({
    /**
     * Save files under: UPLOAD_DIR/<userId>/<uuid>.<ext>
     * The userId is extracted from req.user set by the authenticate middleware.
     */
    destination: (req, file, cb) => {
        const baseDir = path.resolve(process.env.UPLOAD_DIR || 'uploads');
        const userId = req.user ? String(req.user.userId) : 'anonymous';
        const userDir = path.join(baseDir, userId);

        // Create the user-specific directory if it does not exist
        fs.mkdirSync(userDir, { recursive: true });
        cb(null, userDir);
    },

    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueName = `${uuidv4()}${ext}`;
        cb(null, uniqueName);
    },
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = getAllowedMimeTypes();
    if (allowedTypes.has(file.mimetype)) {
        cb(null, true);
    } else {
        cb(
            new multer.MulterError(
                'LIMIT_UNEXPECTED_FILE',
                `File type "${file.mimetype}" is not allowed`
            ),
            false
        );
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

module.exports = upload;
