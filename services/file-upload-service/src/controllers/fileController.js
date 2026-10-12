'use strict';

const fs = require('fs');
const path = require('path');
const FileRecord = require('../models/FileRecord');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the absolute path for a stored file from its DB record.
 * @param {FileRecord} record
 * @returns {string}
 */
const resolveFilePath = (record) => path.resolve(record.path);

/**
 * Delete a file from disk silently (ignore ENOENT).
 * @param {string} absolutePath
 */
const unlinkSilent = (absolutePath) => {
    try {
        fs.unlinkSync(absolutePath);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error(`[file-controller] Failed to delete file at ${absolutePath}:`, err.message);
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Controllers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /files/upload
 * Upload one or more files (multipart field: "files").
 * Requires authentication.
 */
const uploadFiles = async (req, res) => {
    try {
        const { userId } = req.user;

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files were uploaded' });
        }

        const baseUploadDir = path.resolve(process.env.UPLOAD_DIR || 'uploads');

        const records = await Promise.all(
            req.files.map((file) => {
                // Compute relative path from project root for DB storage
                const relativePath = path.relative(process.cwd(), file.path);

                return FileRecord.create({
                    originalName: file.originalname,
                    storedName: file.filename,
                    mimeType: file.mimetype,
                    size: file.size,
                    path: relativePath,
                    uploadedBy: userId,
                });
            })
        );

        return res.status(201).json({
            message: `${records.length} file(s) uploaded successfully`,
            files: records.map(formatRecord),
        });
    } catch (error) {
        console.error('[uploadFiles]', error);
        return res.status(500).json({ error: 'Upload failed', detail: error.message });
    }
};

/**
 * GET /files
 * List all files belonging to the authenticated user.
 */
const listFiles = async (req, res) => {
    try {
        const { userId } = req.user;
        const { page = 1, limit = 20, mimeType } = req.query;

        const where = { uploadedBy: userId };
        if (mimeType) where.mimeType = mimeType;

        const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

        const { count, rows } = await FileRecord.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit, 10),
            offset,
        });

        return res.json({
            total: count,
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            files: rows.map(formatRecord),
        });
    } catch (error) {
        console.error('[listFiles]', error);
        return res.status(500).json({ error: 'Failed to retrieve files' });
    }
};

/**
 * GET /files/:fileId
 * Return metadata and stream the file for download.
 * Requires authentication; file must belong to the requesting user.
 */
const getFile = async (req, res) => {
    try {
        const { fileId } = req.params;
        const { userId } = req.user;

        const record = await FileRecord.findByPk(fileId);
        if (!record) {
            return res.status(404).json({ error: 'File not found' });
        }
        if (record.uploadedBy !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const absolutePath = resolveFilePath(record);
        if (!fs.existsSync(absolutePath)) {
            return res.status(410).json({ error: 'File no longer exists on server' });
        }

        res.setHeader('Content-Type', record.mimeType);
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${encodeURIComponent(record.originalName)}"`
        );
        res.setHeader('Content-Length', record.size);

        const stream = fs.createReadStream(absolutePath);
        stream.on('error', (err) => {
            console.error('[getFile] stream error:', err);
            res.status(500).end();
        });
        stream.pipe(res);
    } catch (error) {
        console.error('[getFile]', error);
        return res.status(500).json({ error: 'Failed to retrieve file' });
    }
};

/**
 * PUT /files/:fileId
 * Replace an existing file with a new upload.
 * - Deletes the old file from disk
 * - Updates the DB record with new file metadata
 * Requires authentication; file must belong to the requesting user.
 */
const updateFile = async (req, res) => {
    try {
        const { fileId } = req.params;
        const { userId } = req.user;

        const record = await FileRecord.findByPk(fileId);
        if (!record) {
            return res.status(404).json({ error: 'File not found' });
        }
        if (record.uploadedBy !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No replacement file provided' });
        }

        // Delete old file from disk
        unlinkSilent(resolveFilePath(record));

        // Update record with new file metadata
        const relativePath = path.relative(process.cwd(), req.file.path);
        await record.update({
            originalName: req.file.originalname,
            storedName: req.file.filename,
            mimeType: req.file.mimetype,
            size: req.file.size,
            path: relativePath,
        });

        return res.json({
            message: 'File updated successfully',
            file: formatRecord(record),
        });
    } catch (error) {
        console.error('[updateFile]', error);
        return res.status(500).json({ error: 'File update failed', detail: error.message });
    }
};

/**
 * DELETE /files/:fileId
 * Deletes a file from disk and removes its DB record.
 * Requires authentication; file must belong to the requesting user.
 */
const deleteFile = async (req, res) => {
    try {
        const { fileId } = req.params;
        const { userId } = req.user;

        const record = await FileRecord.findByPk(fileId);
        if (!record) {
            return res.status(404).json({ error: 'File not found' });
        }
        if (record.uploadedBy !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Remove from disk first, then DB
        unlinkSilent(resolveFilePath(record));
        await record.destroy();

        return res.json({ message: 'File deleted successfully', fileId });
    } catch (error) {
        console.error('[deleteFile]', error);
        return res.status(500).json({ error: 'Failed to delete file' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Serialization helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a FileRecord for API responses (omit internal disk path).
 * @param {FileRecord} record
 * @returns {object}
 */
const formatRecord = (record) => ({
    id: record.id,
    originalName: record.originalName,
    mimeType: record.mimeType,
    size: record.size,
    uploadedBy: record.uploadedBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
});

module.exports = { uploadFiles, listFiles, getFile, updateFile, deleteFile };
