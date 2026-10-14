require('dotenv').config();
const path = require('path');
const logger = require('./src/shared/logger');
const { validateEnv } = require('./src/config/env');

let config;
try {
    config = validateEnv();
} catch (err) {
    logger.fatal(err.message);
    process.exit(1);
}

const { Sequelize } = require('sequelize');
const platform = require('@ai-search/platform');
const { sequelize, connectDB } = require('./src/config/database');
const { createApp } = require('./src/app');

const start = async () => {
    await connectDB();

    if (config.MIGRATE_ON_START) {
        await platform.migrateUp({
            sequelize,
            Sequelize,
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

start().catch((err) => {
    logger.fatal({ err }, 'Failed to start file-upload-service');
    process.exit(1);
});
