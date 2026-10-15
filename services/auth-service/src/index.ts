import 'dotenv/config';
// Must stay the first app import: validates configuration (or exits) before any module
// that reads process.env at load time.
import { config } from './shared/config/validated';
import path from 'path';
import * as platform from '@ai-search/platform';
import logger from './shared/logger';
import { sequelize, connectDB } from './shared/config/database';
import redis, { closeRedis } from './shared/config/redis';
import * as events from './shared/events';
import { createApp } from './app';

const start = async (): Promise<void> => {
    await connectDB();
    await redis.ping();

    if (config.MIGRATE_ON_START) {
        await platform.migrateUp({
            sequelize,
            dir: path.join(__dirname, 'migrations'),
            tableName: 'migrations_auth',
            logger,
        });
    }

    platform.startServer({
        app: createApp(),
        port: config.PORT,
        logger,
        onShutdown: [
            () => events.close(),
            () => closeRedis(redis),
            () => sequelize.close(),
        ],
    });
};

start().catch((err: unknown) => {
    logger.fatal({ err }, 'Failed to start auth-service');
    process.exit(1);
});
