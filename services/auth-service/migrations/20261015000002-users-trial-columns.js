/**
 * Free-trial columns. Replaces the ALTER TABLE statements that used to run on every
 * development startup. A no-op on databases that already have them.
 */
module.exports = {
    async up({ context: { queryInterface, Sequelize } }) {
        const columns = await queryInterface.describeTable('users');
        if (!columns.trialEndsAt) {
            await queryInterface.addColumn('users', 'trialEndsAt', { type: Sequelize.DATE, allowNull: true, defaultValue: null });
        }
        if (!columns.trialWarningDays) {
            await queryInterface.addColumn('users', 'trialWarningDays', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 7 });
        }
    },

    async down({ context: { queryInterface } }) {
        await queryInterface.removeColumn('users', 'trialWarningDays');
        await queryInterface.removeColumn('users', 'trialEndsAt');
    },
};
