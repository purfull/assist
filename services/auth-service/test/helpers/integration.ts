/**
 * Integration test setup: real MySQL + Redis.
 *
 * Runs only with INTEGRATION=1. Uses the database named by DB_NAME (default
 * ai_search_test), which is DROPPED and rebuilt from migrations. Never point it at
 * a database you care about.
 */
import path from 'path';
import type { Sequelize } from 'sequelize';
import type Redis from 'ioredis';
import { migrateUp } from '@ai-search/platform';
import { sequelize as appSequelize } from '../../src/shared/config/database';
import logger from '../../src/shared/logger';

export const enabled = process.env.INTEGRATION === '1';

export const resetDatabase = async (sequelize: Sequelize): Promise<void> => {
    if (!/test/i.test(sequelize.getDatabaseName())) {
        throw new Error(`Refusing to reset non-test database "${sequelize.getDatabaseName()}"`);
    }
    const queryInterface = sequelize.getQueryInterface();
    const tables: string[] = await queryInterface.showAllTables();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tables) await queryInterface.dropTable(table);
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
};

/** Apply auth-service migrations. Import this helper after './env' and './captureMail'. */
export const migrate = () =>
    migrateUp({
        sequelize: appSequelize,
        dir: path.join(__dirname, '../../src/migrations'),
        tableName: 'migrations_auth',
        logger,
    });

// Remove rate-limit counters so repeated runs from one IP aren't throttled
export const clearRateLimits = async (redis: Redis): Promise<void> => {
    const keys = await redis.keys('rl:*');
    if (keys.length) await redis.del(...keys);
};
