import 'dotenv/config';
// Must stay the first app import: validates configuration (or exits) before any module
// that reads process.env at load time.
import { config } from './config/validated';
import path from 'path';
import * as platform from '@ai-search/platform';
import logger from './shared/logger';
import { sequelize, connectDB } from './config/database';
import { createApp } from './app';

const start = async (): Promise<void> => {
    await connectDB();

    if (config.MIGRATE_ON_START) {
        await platform.migrateUp({
            sequelize,
            dir: path.join(__dirname, 'migrations'),
            tableName: 'migrations_files',
            logger,
        });
    }

    logger.info({ uploadDir: config.UPLOAD_DIR }, 'Using local upload directory');
    platform.startServer({
        app: createApp(),
        port: config.PORT,
        logger,
        onShutdown: [() => sequelize.close()],
    });
};

start().catch((err: unknown) => {
    logger.fatal({ err }, 'Failed to start file-upload-service');
    process.exit(1);
});
