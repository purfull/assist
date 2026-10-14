/**
 * Baseline schema for the tables auth-service owns.
 *
 * Written to be safe on databases previously created by sequelize.sync(): each table
 * is only created if it does not exist. agents / agent_logs are owned by another
 * codebase and are deliberately not created here.
 */
const timestamps = (Sequelize) => ({
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
});

const userFk = (Sequelize, onDelete) => ({
    type: Sequelize.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onUpdate: 'CASCADE',
    ...(onDelete ? { onDelete } : {}),
});

module.exports = {
    async up({ context: { queryInterface, Sequelize } }) {
        const existing = new Set((await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName)));
        const createIfMissing = async (name, attributes) => {
            if (!existing.has(name)) await queryInterface.createTable(name, attributes);
        };

        await createIfMissing('users', {
            id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            email: { type: Sequelize.STRING, allowNull: false, unique: true },
            name: { type: Sequelize.STRING, allowNull: true },
            password: { type: Sequelize.STRING, allowNull: true },
            googleId: { type: Sequelize.STRING, allowNull: true, unique: true },
            isVerified: { type: Sequelize.BOOLEAN, defaultValue: false },
            phone: { type: Sequelize.STRING, allowNull: true },
            companyName: { type: Sequelize.STRING, allowNull: true },
            billingAddress: { type: Sequelize.STRING, allowNull: true },
            city: { type: Sequelize.STRING, allowNull: true },
            state: { type: Sequelize.STRING, allowNull: true },
            zipCode: { type: Sequelize.STRING, allowNull: true },
            country: { type: Sequelize.STRING, allowNull: true },
            taxId: { type: Sequelize.STRING, allowNull: true },
            credits: { type: Sequelize.INTEGER, defaultValue: 0 },
            trialEndsAt: { type: Sequelize.DATE, allowNull: true, defaultValue: null },
            trialWarningDays: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 7 },
            ...timestamps(Sequelize),
        });

        await createIfMissing('refresh_tokens', {
            id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            userId: userFk(Sequelize, 'CASCADE'),
            token: { type: Sequelize.STRING(500), allowNull: false, unique: true },
            expiresAt: { type: Sequelize.DATE, allowNull: false },
            userAgent: { type: Sequelize.STRING, allowNull: true },
            ipAddress: { type: Sequelize.STRING, allowNull: true },
            lastUsedAt: { type: Sequelize.DATE, allowNull: true },
            ...timestamps(Sequelize),
        });

        await createIfMissing('transactions', {
            id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            userId: { type: Sequelize.INTEGER, allowNull: false },
            amount: { type: Sequelize.INTEGER, allowNull: false },
            currency: { type: Sequelize.STRING, defaultValue: 'INR' },
            status: { type: Sequelize.ENUM('pending', 'success', 'failed'), defaultValue: 'pending' },
            razorpayOrderId: { type: Sequelize.STRING, allowNull: true },
            razorpayPaymentId: { type: Sequelize.STRING, allowNull: true },
            razorpaySignature: { type: Sequelize.STRING, allowNull: true },
            type: { type: Sequelize.ENUM('credit_add', 'usage'), defaultValue: 'credit_add' },
            description: { type: Sequelize.STRING, allowNull: true },
            ...timestamps(Sequelize),
        });

        await createIfMissing('tickets', {
            id: { type: Sequelize.UUID, primaryKey: true },
            userId: userFk(Sequelize),
            subject: { type: Sequelize.STRING, allowNull: false },
            status: { type: Sequelize.ENUM('Open', 'Closed'), defaultValue: 'Open' },
            priority: { type: Sequelize.ENUM('Low', 'Medium', 'High'), defaultValue: 'Medium' },
            replies: { type: Sequelize.JSON },
            ...timestamps(Sequelize),
        });

        await createIfMissing('notifications', {
            id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            userId: userFk(Sequelize),
            message: { type: Sequelize.TEXT, allowNull: false },
            isRead: { type: Sequelize.BOOLEAN, defaultValue: false },
            ...timestamps(Sequelize),
        });
    },

    async down({ context: { queryInterface } }) {
        for (const table of ['notifications', 'tickets', 'transactions', 'refresh_tokens', 'users']) {
            await queryInterface.dropTable(table);
        }
    },
};
