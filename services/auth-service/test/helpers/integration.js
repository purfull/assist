/**
 * Integration test setup: real MySQL + Redis.
 *
 * Runs only with INTEGRATION=1. Uses the database named by DB_NAME (default
 * ai_search_test), which is DROPPED and rebuilt from migrations. Never point it at
 * a database you care about.
 */
const path = require('path');

const enabled = process.env.INTEGRATION === '1';

// Capture outgoing email instead of sending it; tests read OTPs and reset links from here
const sentEmails = [];
const installMailCapture = () => {
    const file = require.resolve('../../src/shared/config/mailer');
    require.cache[file] = {
        id: file, filename: file, loaded: true,
        exports: { sendEmail: async (msg) => { sentEmails.push(msg); return { success: true }; } },
    };
};

const lastEmailTo = (to) => [...sentEmails].reverse().find((m) => m.to === to);

const resetDatabase = async (sequelize) => {
    if (!/test/i.test(sequelize.getDatabaseName())) {
        throw new Error(`Refusing to reset non-test database "${sequelize.getDatabaseName()}"`);
    }
    const tables = await sequelize.getQueryInterface().showAllTables();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of tables) await sequelize.getQueryInterface().dropTable(typeof t === 'string' ? t : t.tableName);
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
};

const migrate = async () => {
    const { Sequelize } = require('sequelize');
    const platform = require('@ai-search/platform');
    const { sequelize } = require('../../src/shared/config/database');
    return platform.migrateUp({
        sequelize,
        Sequelize,
        dir: path.join(__dirname, '../../migrations'),
        tableName: 'migrations_auth',
        logger: require('../../src/shared/logger'),
    });
};

// Remove rate-limit counters so repeated runs from one IP aren't throttled
const clearRateLimits = async (redis) => {
    const keys = await redis.keys('rl:*');
    if (keys.length) await redis.del(...keys);
};

module.exports = { enabled, installMailCapture, sentEmails, lastEmailTo, resetDatabase, migrate, clearRateLimits };
