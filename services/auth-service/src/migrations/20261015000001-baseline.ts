import type { ModelAttributes } from 'sequelize';
import type { Migration, MigrationContext } from '@ai-search/platform';

/**
 * Baseline schema for the tables auth-service owns.
 *
 * Written to be safe on databases previously created by sequelize.sync(): each table
 * is only created if it does not exist. agents / agent_logs are owned by another
 * codebase and are deliberately not created here.
 */
const timestamps = (DataTypes: MigrationContext['DataTypes']) => ({
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
});

const userFk = (DataTypes: MigrationContext['DataTypes'], onDelete?: 'CASCADE') => ({
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onUpdate: 'CASCADE',
    ...(onDelete ? { onDelete } : {}),
});

export const up: Migration = async ({ context: { queryInterface, DataTypes } }) => {
    const existing = new Set(await queryInterface.showAllTables());
    const createIfMissing = async (name: string, attributes: ModelAttributes) => {
        if (!existing.has(name)) await queryInterface.createTable(name, attributes);
    };

    await createIfMissing('users', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        email: { type: DataTypes.STRING, allowNull: false, unique: true },
        name: { type: DataTypes.STRING, allowNull: true },
        password: { type: DataTypes.STRING, allowNull: true },
        googleId: { type: DataTypes.STRING, allowNull: true, unique: true },
        isVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
        phone: { type: DataTypes.STRING, allowNull: true },
        companyName: { type: DataTypes.STRING, allowNull: true },
        billingAddress: { type: DataTypes.STRING, allowNull: true },
        city: { type: DataTypes.STRING, allowNull: true },
        state: { type: DataTypes.STRING, allowNull: true },
        zipCode: { type: DataTypes.STRING, allowNull: true },
        country: { type: DataTypes.STRING, allowNull: true },
        taxId: { type: DataTypes.STRING, allowNull: true },
        credits: { type: DataTypes.INTEGER, defaultValue: 0 },
        trialEndsAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
        trialWarningDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 7 },
        ...timestamps(DataTypes),
    });

    await createIfMissing('refresh_tokens', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        userId: userFk(DataTypes, 'CASCADE'),
        token: { type: DataTypes.STRING(500), allowNull: false, unique: true },
        expiresAt: { type: DataTypes.DATE, allowNull: false },
        userAgent: { type: DataTypes.STRING, allowNull: true },
        ipAddress: { type: DataTypes.STRING, allowNull: true },
        lastUsedAt: { type: DataTypes.DATE, allowNull: true },
        ...timestamps(DataTypes),
    });

    await createIfMissing('transactions', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        userId: { type: DataTypes.INTEGER, allowNull: false },
        amount: { type: DataTypes.INTEGER, allowNull: false },
        currency: { type: DataTypes.STRING, defaultValue: 'INR' },
        status: { type: DataTypes.ENUM('pending', 'success', 'failed'), defaultValue: 'pending' },
        razorpayOrderId: { type: DataTypes.STRING, allowNull: true },
        razorpayPaymentId: { type: DataTypes.STRING, allowNull: true },
        razorpaySignature: { type: DataTypes.STRING, allowNull: true },
        type: { type: DataTypes.ENUM('credit_add', 'usage'), defaultValue: 'credit_add' },
        description: { type: DataTypes.STRING, allowNull: true },
        ...timestamps(DataTypes),
    });

    await createIfMissing('tickets', {
        id: { type: DataTypes.UUID, primaryKey: true },
        userId: userFk(DataTypes),
        subject: { type: DataTypes.STRING, allowNull: false },
        status: { type: DataTypes.ENUM('Open', 'Closed'), defaultValue: 'Open' },
        priority: { type: DataTypes.ENUM('Low', 'Medium', 'High'), defaultValue: 'Medium' },
        replies: { type: DataTypes.JSON },
        ...timestamps(DataTypes),
    });

    await createIfMissing('notifications', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        userId: userFk(DataTypes),
        message: { type: DataTypes.TEXT, allowNull: false },
        isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
        ...timestamps(DataTypes),
    });
};

export const down: Migration = async ({ context: { queryInterface } }) => {
    for (const table of ['notifications', 'tickets', 'transactions', 'refresh_tokens', 'users']) {
        await queryInterface.dropTable(table);
    }
};
