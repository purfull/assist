'use strict';

const path = require('path');
const { Umzug, SequelizeStorage } = require('umzug');

/**
 * Schema migrations with Umzug.
 *
 * Each service keeps its own migrations folder and its own bookkeeping table
 * (e.g. migrations_auth), since services share one MySQL instance but own different tables.
 *
 * Migration files export `up` and `down`, receiving { context: { queryInterface, Sequelize } }.
 */
const createMigrator = ({ sequelize, Sequelize, dir, tableName, logger }) => new Umzug({
    migrations: { glob: path.join(dir, '*.js').split(path.sep).join('/') },
    context: { queryInterface: sequelize.getQueryInterface(), Sequelize },
    storage: new SequelizeStorage({ sequelize, tableName }),
    logger: {
        info: (event) => logger.info(event, 'migration'),
        warn: (event) => logger.warn(event, 'migration'),
        error: (event) => logger.error(event, 'migration'),
        debug: (event) => logger.debug(event, 'migration'),
    },
});

/**
 * Apply pending migrations while holding a MySQL named lock, so several instances
 * starting at once (MIGRATE_ON_START) don't run the same migration twice.
 * The lock lives on one pinned connection for the whole run.
 */
const migrateUp = async ({ sequelize, Sequelize, dir, tableName, logger, lockTimeoutSeconds = 60 }) => {
    const migrator = createMigrator({ sequelize, Sequelize, dir, tableName, logger });
    const lockName = `${sequelize.getDatabaseName()}.${tableName}`;

    return sequelize.transaction(async (transaction) => {
        const [[{ acquired }]] = await sequelize.query(
            'SELECT GET_LOCK(:lockName, :timeout) AS acquired',
            { replacements: { lockName, timeout: lockTimeoutSeconds }, transaction }
        );
        if (acquired !== 1) {
            throw new Error(`Could not acquire migration lock "${lockName}" within ${lockTimeoutSeconds}s`);
        }
        try {
            const applied = await migrator.up();
            logger.info({ applied: applied.map((m) => m.name) }, 'Migrations up to date');
            return applied;
        } finally {
            await sequelize.query('SELECT RELEASE_LOCK(:lockName)', { replacements: { lockName }, transaction });
        }
    });
};

/**
 * Tiny CLI: node scripts/migrate.js [up|down|pending|executed]
 */
const runCli = async (options, command = process.argv[2] || 'up') => {
    const { sequelize, logger } = options;
    try {
        if (command === 'up') {
            await migrateUp(options);
        } else {
            const migrator = createMigrator(options);
            if (command === 'down') {
                const reverted = await migrator.down();
                logger.info({ reverted: reverted.map((m) => m.name) }, 'Reverted last migration');
            } else if (command === 'pending' || command === 'executed') {
                const list = command === 'pending' ? await migrator.pending() : await migrator.executed();
                // Plain output for humans running the CLI
                process.stdout.write(`${list.map((m) => m.name).join('\n') || `(no ${command} migrations)`}\n`);
            } else {
                throw new Error(`Unknown command "${command}". Use up | down | pending | executed.`);
            }
        }
        await sequelize.close();
    } catch (err) {
        logger.fatal({ err }, 'Migration command failed');
        await sequelize.close().catch(() => {});
        process.exit(1);
    }
};

module.exports = { createMigrator, migrateUp, runCli };
