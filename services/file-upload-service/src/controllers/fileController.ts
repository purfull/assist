import fs from 'fs';
import path from 'path';
import type { Request, RequestHandler } from 'express';
import type { WhereOptions } from 'sequelize';
import FileRecord from '../models/FileRecord';
import { matchesDeclaredType } from '../utils/fileSignature';
import { sequelize } from '../config/database';
import logger from '../shared/logger';
import type { AuthUser } from '@ai-search/shared-auth';

type FileParams = { fileId: string };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** The authenticated user; routes are mounted behind shared-auth's authenticate. */
const currentUser = (req: { user?: AuthUser | undefined }): AuthUser => {
    if (!req.user) throw new Error('Route reached without authentication');
    return req.user;
};

/** Resolve the absolute path for a stored file from its DB record. */
const resolveFilePath = (record: FileRecord): string => path.resolve(record.path);

/** Delete a file from disk silently (ignore ENOENT). */
const unlinkSilent = (absolutePath: string): void => {
    try {
        fs.unlinkSync(absolutePath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            logger.error({ err, path: absolutePath }, 'Failed to delete file');
        }
    }
};

/** Remove files multer already wrote to disk for a request that is being rejected. */
const removeUploaded = (files: Array<{ path: string }> = []): void => files.forEach((file) => unlinkSilent(file.path));

const uploadedFiles = (req: Request): Express.Multer.File[] => (Array.isArray(req.files) ? req.files : []);

/** Format a FileRecord for API responses (omit internal disk path). */
const formatRecord = (record: FileRecord) => ({
    id: record.id,
    originalName: record.originalName,
    mimeType: record.mimeType,
    size: record.size,
    uploadedBy: record.uploadedBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
});

/** parseInt of a query value, or `fallback` when missing, non-numeric or 0. */
const intOr = (value: unknown, fallback: number): number =>
    (typeof value === 'string' ? parseInt(value, 10) : NaN) || fallback;

// ─────────────────────────────────────────────────────────────────────────────
// Controllers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /files/upload — upload one or more files (multipart field: "files").
 */
export const uploadFiles: RequestHandler = async (req, res) => {
    try {
        const { userId } = currentUser(req);
        const files = uploadedFiles(req);

        if (files.length === 0) {
            return res.status(400).json({ error: 'No files were uploaded' });
        }

        const mismatched = files.find((file) => !matchesDeclaredType(file.path, file.mimetype));
        if (mismatched) {
            removeUploaded(files);
            return res.status(415).json({
                error: `File "${mismatched.originalname}" does not match its declared type ${mismatched.mimetype}`,
            });
        }

        // All records are created in one transaction; if any insert fails, none are kept
        // and the files already written to disk are removed (no orphans).
        let records: FileRecord[];
        try {
            records = await sequelize.transaction((transaction) => Promise.all(
                files.map((file) => FileRecord.create({
                    originalName: file.originalname,
                    storedName: file.filename,
                    mimeType: file.mimetype,
                    size: file.size,
                    // Relative path from project root for DB storage
                    path: path.relative(process.cwd(), file.path),
                    uploadedBy: userId,
                }, { transaction })),
            ));
        } catch (error) {
            removeUploaded(files);
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
 * GET /files — list the authenticated user's files (paginated, max 100 per page).
 */
export const listFiles: RequestHandler = async (req, res) => {
    try {
        const { userId } = currentUser(req);
        const { mimeType } = req.query;
        const page = Math.max(intOr(req.query.page, 1), 1);
        const limit = Math.min(Math.max(intOr(req.query.limit, 20), 1), 100);

        const where: WhereOptions<FileRecord> = typeof mimeType === 'string' && mimeType
            ? { uploadedBy: userId, mimeType }
            : { uploadedBy: userId };

        const { count, rows } = await FileRecord.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            limit,
            offset: (page - 1) * limit,
        });

        return res.json({ total: count, page, limit, files: rows.map(formatRecord) });
    } catch (error) {
        req.log.error({ err: error }, '[listFiles]');
        return res.status(500).json({ error: 'Failed to retrieve files' });
    }
};

/**
 * GET /files/:fileId — stream the file for download; must belong to the requesting user.
 */
export const getFile: RequestHandler<FileParams> = async (req, res) => {
    try {
        const record = await FileRecord.findByPk(req.params.fileId);
        if (!record) {
            return res.status(404).json({ error: 'File not found' });
        }
        if (record.uploadedBy !== currentUser(req).userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const absolutePath = resolveFilePath(record);
        if (!fs.existsSync(absolutePath)) {
            return res.status(410).json({ error: 'File no longer exists on server' });
        }

        res.setHeader('Content-Type', record.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(record.originalName)}"`);
        res.setHeader('Content-Length', record.size);

        const stream = fs.createReadStream(absolutePath);
        stream.on('error', (err) => {
            req.log.error({ err }, '[getFile] stream error');
            res.status(500).end();
        });
        stream.pipe(res);
        return undefined;
    } catch (error) {
        req.log.error({ err: error }, '[getFile]');
        return res.status(500).json({ error: 'Failed to retrieve file' });
    }
};

/**
 * PUT /files/:fileId — replace a file (multipart field "file"); must belong to the user.
 */
export const updateFile: RequestHandler<FileParams> = async (req, res) => {
    try {
        const { userId } = currentUser(req);
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No replacement file provided' });
        }

        const record = await FileRecord.findByPk(req.params.fileId);
        if (!record || record.uploadedBy !== userId) {
            removeUploaded([file]);
            return res.status(record ? 403 : 404).json({ error: record ? 'Access denied' : 'File not found' });
        }

        if (!matchesDeclaredType(file.path, file.mimetype)) {
            removeUploaded([file]);
            return res.status(415).json({ error: `File does not match its declared type ${file.mimetype}` });
        }

        // Point the record at the new file first; only then delete the old one, so a failed
        // DB update never leaves the record pointing at a deleted file.
        const oldPath = resolveFilePath(record);
        try {
            await record.update({
                originalName: file.originalname,
                storedName: file.filename,
                mimeType: file.mimetype,
                size: file.size,
                path: path.relative(process.cwd(), file.path),
            });
        } catch (error) {
            removeUploaded([file]);
            throw error;
        }
        unlinkSilent(oldPath);

        return res.json({ message: 'File updated successfully', file: formatRecord(record) });
    } catch (error) {
        req.log.error({ err: error }, '[updateFile]');
        return res.status(500).json({ error: 'File update failed' });
    }
};

/**
 * DELETE /files/:fileId — delete the record, then the file; must belong to the user.
 */
export const deleteFile: RequestHandler<FileParams> = async (req, res) => {
    try {
        const { fileId } = req.params;
        const record = await FileRecord.findByPk(fileId);
        if (!record) {
            return res.status(404).json({ error: 'File not found' });
        }
        if (record.uploadedBy !== currentUser(req).userId) {
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
