/**
 * Baseline schema for file-upload-service. Safe on databases previously created by
 * sequelize.sync(): the table is only created if it does not exist.
 */
module.exports = {
    async up({ context: { queryInterface, Sequelize } }) {
        const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
        if (tables.includes('file_records')) return;

        await queryInterface.createTable('file_records', {
            id: { type: Sequelize.UUID, primaryKey: true },
            originalName: { type: Sequelize.STRING(512), allowNull: false },
            storedName: { type: Sequelize.STRING(512), allowNull: false },
            mimeType: { type: Sequelize.STRING(128), allowNull: false },
            size: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false },
            path: { type: Sequelize.STRING(1024), allowNull: false },
            // users.id belongs to auth-service; referenced by value, no cross-service FK
            uploadedBy: { type: Sequelize.INTEGER, allowNull: false },
            createdAt: { type: Sequelize.DATE, allowNull: false },
            updatedAt: { type: Sequelize.DATE, allowNull: false },
        });
        await queryInterface.addIndex('file_records', ['uploadedBy'], { name: 'file_records_uploaded_by' });
        await queryInterface.addIndex('file_records', ['mimeType'], { name: 'file_records_mime_type' });
    },

    async down({ context: { queryInterface } }) {
        await queryInterface.dropTable('file_records');
    },
};
