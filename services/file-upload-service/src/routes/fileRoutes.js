'use strict';

const { Router } = require('express');
const { authenticate } = require('@ai-search/shared-auth');
const upload = require('../config/multer');
const {
    uploadFiles,
    listFiles,
    getFile,
    updateFile,
    deleteFile,
} = require('../controllers/fileController');

const router = Router();

/**
 * File Upload Service Routes
 *
 * All routes require JWT authentication via the centralized @ai-search/shared-auth middleware.
 *
 * POST   /files/upload       — Upload one or more files (field: "files", max 10)
 * GET    /files              — List the authenticated user's files (paginated)
 * GET    /files/:fileId      — Download a specific file by UUID
 * PUT    /files/:fileId      — Replace/update a file (field: "file", single)
 * DELETE /files/:fileId      — Delete a file from disk and DB
 */

// Upload one or more files
router.post(
    '/upload',
    authenticate,
    upload.array('files', 10),
    uploadFiles
);

// List user's files
router.get('/', authenticate, listFiles);

// Download / get file metadata
router.get('/:fileId', authenticate, getFile);

// Replace an existing file
router.put(
    '/:fileId',
    authenticate,
    upload.single('file'),
    updateFile
);

// Delete a file
router.delete('/:fileId', authenticate, deleteFile);

module.exports = router;
