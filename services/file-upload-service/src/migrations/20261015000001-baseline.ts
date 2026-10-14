import type { Migration } from '@ai-search/platform';

/**
 * Baseline schema for file-upload-service. Safe on databases previously created by
 * sequelize.sync(): the table is only created if it does not exist.
 */
export const up: Migration = async ({ context: { queryInterface, DataTypes } }) => {
    const tables: string[] = await queryInterface.showAllTables();
    if (tables.includes('file_records')) return;

    await queryInterface.createTable('file_records', {
        id: { type: DataTypes.UUID, primaryKey: true },
        originalName: { type: DataTypes.STRING(512), allowNull: false },
        storedName: { type: DataTypes.STRING(512), allowNull: false },
        mimeType: { type: DataTypes.STRING(128), allowNull: false },
        size: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        path: { type: DataTypes.STRING(1024), allowNull: false },
        // users.id belongs to auth-service; referenced by value, no cross-service FK
        uploadedBy: { type: DataTypes.INTEGER, allowNull: false },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('file_records', ['uploadedBy'], { name: 'file_records_uploaded_by' });
    await queryInterface.addIndex('file_records', ['mimeType'], { name: 'file_records_mime_type' });
};

export const down: Migration = async ({ context: { queryInterface } }) => {
    await queryInterface.dropTable('file_records');
};
