'use strict';

const fs = require('fs');
const path = require('path');
const FileRecord = require('../models/FileRecord');
const { matchesDeclaredType } = require('../utils/fileSignature');
const { sequelize } = require('../config/database');
const logger = require('../shared/logger');

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
            logger.error({ err, path: absolutePath }, 'Failed to delete file');
        }
    }
};

/**
 * Remove files multer already wrote to disk for a request that is being rejected.
 * @param {Array<{ path: string }>} files
 */
const removeUploaded = (files = []) => files.forEach((file) => unlinkSilent(file.path));

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

        const mismatched = req.files.find((file) => !matchesDeclaredType(file.path, file.mimetype));
        if (mismatched) {
            removeUploaded(req.files);
            return res.status(415).json({
                error: `File "${mismatched.originalname}" does not match its declared type ${mismatched.mimetype}`,
            });
        }

        // All records are created in one transaction; if any insert fails, none are kept
        // and the files already written to disk are removed (no orphans).
        let records;
        try {
            records = await sequelize.transaction((transaction) => Promise.all(
                req.files.map((file) => FileRecord.create({
                    originalName: file.originalname,
                    storedName: file.filename,
                    mimeType: file.mimetype,
                    size: file.size,
                    // Relative path from project root for DB storage
                    path: path.relative(process.cwd(), file.path),
                    uploadedBy: userId,
                }, { transaction }))
            ));
        } catch (error) {
            removeUploaded(req.files);
            throw error;
        }

        return res.status(201).json({
            message: `${records.length} file(s) uploaded successfully`,
            files: records.map(formatRecord),
        });
    } catch (error) {
        req.log.error({ err: error }, '[uploadFiles]');
        return res.status(500).json({ error: 'Upload failed' });
    }
};

/**
 * GET /files
 * List all files belonging to the authenticated user.
 */
const listFiles = async (req, res) => {
    try {
        const { userId } = req.user;
        const { mimeType } = req.query;
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

        const where = { uploadedBy: userId };
        if (typeof mimeType === 'string' && mimeType) where.mimeType = mimeType;

        const { count, rows } = await FileRecord.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            limit,
            offset: (page - 1) * limit,
        });

        return res.json({
            total: count,
            page,
            limit,
            files: rows.map(formatRecord),
        });
    } catch (error) {
        req.log.error({ err: error }, '[listFiles]');
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
            req.log.error({ err: err }, '[getFile] stream error');
            res.status(500).end();
        });
        stream.pipe(res);
    } catch (error) {
        req.log.error({ err: error }, '[getFile]');
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

        if (!req.file) {
            return res.status(400).json({ error: 'No replacement file provided' });
        }

        const record = await FileRecord.findByPk(fileId);
        if (!record || record.uploadedBy !== userId) {
            removeUploaded([req.file]);
            return res.status(record ? 403 : 404).json({ error: record ? 'Access denied' : 'File not found' });
        }

        if (!matchesDeclaredType(req.file.path, req.file.mimetype)) {
            removeUploaded([req.file]);
            return res.status(415).json({ error: `File does not match its declared type ${req.file.mimetype}` });
        }

        // Point the record at the new file first; only then delete the old one, so a failed
        // DB update never leaves the record pointing at a deleted file.
        const oldPath = resolveFilePath(record);
        try {
            await record.update({
                originalName: req.file.originalname,
                storedName: req.file.filename,
                mimeType: req.file.mimetype,
                size: req.file.size,
                path: path.relative(process.cwd(), req.file.path),
            });
        } catch (error) {
            removeUploaded([req.file]);
            throw error;
        }
        unlinkSilent(oldPath);

        return res.json({
            message: 'File updated successfully',
            file: formatRecord(record),
        });
    } catch (error) {
        req.log.error({ err: error }, '[updateFile]');
        return res.status(500).json({ error: 'File update failed' });
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

        // Remove the DB record first, then the file: if the delete fails the file is still served
        const absolutePath = resolveFilePath(record);
        await record.destroy();
        unlinkSilent(absolutePath);

        return res.json({ message: 'File deleted successfully', fileId });
    } catch (error) {
        req.log.error({ err: error }, '[deleteFile]');
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
