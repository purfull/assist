import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../config/database';

/**
 * FileRecord — metadata for each uploaded file.
 *
 * Storage path on disk: UPLOAD_DIR/<uploadedBy>/<storedName>
 * The `id` (UUID) is the public identifier for the file.
 */
export class FileRecord extends Model<InferAttributes<FileRecord>, InferCreationAttributes<FileRecord>> {
    declare id: CreationOptional<string>;
    /** Original filename as provided by the client */
    declare originalName: string;
    /** UUID-based filename stored on disk (e.g. <uuid>.jpg) */
    declare storedName: string;
    declare mimeType: string;
    /** File size in bytes */
    declare size: number;
    /** Relative path on disk: uploads/<userId>/<storedName> */
    declare path: string;
    /** users.id from auth-service (referenced by value, no cross-service FK) */
    declare uploadedBy: number;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}

FileRecord.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: 'UUID — also used as the file download/update/delete key',
    },
    originalName: { type: DataTypes.STRING(512), allowNull: false, comment: 'Original filename as provided by the client' },
    storedName: { type: DataTypes.STRING(512), allowNull: false, comment: 'UUID-based filename stored on disk (e.g. <uuid>.jpg)' },
    mimeType: { type: DataTypes.STRING(128), allowNull: false },
    size: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, comment: 'File size in bytes' },
    path: { type: DataTypes.STRING(1024), allowNull: false, comment: 'Relative path on disk: uploads/<userId>/<storedName>' },
    uploadedBy: { type: DataTypes.INTEGER, allowNull: false, comment: 'FK → users.id from the auth-service users table' },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
}, {
    sequelize,
    tableName: 'file_records',
    timestamps: true,
    indexes: [
        { fields: ['uploadedBy'] },
        { fields: ['mimeType'] },
    ],
});

export default FileRecord;
