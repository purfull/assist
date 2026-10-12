'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * FileRecord model — stores metadata for each uploaded file.
 *
 * Storage path on disk: UPLOAD_DIR/<uploadedBy>/<storedName>
 * The `id` (UUID) is used as the public identifier for the file.
 */
const FileRecord = sequelize.define(
    'FileRecord',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            comment: 'UUID — also used as the file download/update/delete key',
        },
        originalName: {
            type: DataTypes.STRING(512),
            allowNull: false,
            comment: 'Original filename as provided by the client',
        },
        storedName: {
            type: DataTypes.STRING(512),
            allowNull: false,
            comment: 'UUID-based filename stored on disk (e.g. <uuid>.jpg)',
        },
        mimeType: {
            type: DataTypes.STRING(128),
            allowNull: false,
        },
        size: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            comment: 'File size in bytes',
        },
        path: {
            type: DataTypes.STRING(1024),
            allowNull: false,
            comment: 'Relative path on disk: uploads/<userId>/<storedName>',
        },
        uploadedBy: {
            type: DataTypes.INTEGER,
            allowNull: false,
            comment: 'FK → users.id from the auth-service users table',
        },
    },
    {
        tableName: 'file_records',
        timestamps: true, // adds createdAt, updatedAt
        indexes: [
            { fields: ['uploadedBy'] },
            { fields: ['mimeType'] },
        ],
    }
);

module.exports = FileRecord;
