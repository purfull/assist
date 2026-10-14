import type { Migration } from '@ai-search/platform';

/**
 * Free-trial columns. Replaces the ALTER TABLE statements that used to run on every
 * development startup. A no-op on databases that already have them.
 */
export const up: Migration = async ({ context: { queryInterface, DataTypes } }) => {
    const columns = await queryInterface.describeTable('users');
    if (!columns.trialEndsAt) {
        await queryInterface.addColumn('users', 'trialEndsAt', { type: DataTypes.DATE, allowNull: true, defaultValue: null });
    }
    if (!columns.trialWarningDays) {
        await queryInterface.addColumn('users', 'trialWarningDays', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 7 });
    }
};

export const down: Migration = async ({ context: { queryInterface } }) => {
    await queryInterface.removeColumn('users', 'trialWarningDays');
    await queryInterface.removeColumn('users', 'trialEndsAt');
};
