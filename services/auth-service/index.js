require('dotenv').config();
const path = require('path');
const logger = require('./src/shared/logger');
const { validateEnv } = require('./src/shared/config/env');

// Validate configuration before loading anything that reads it (keys, OAuth, Razorpay)
let config;
try {
    config = validateEnv();
} catch (err) {
    logger.fatal(err.message);
    process.exit(1);
}

const { Sequelize } = require('sequelize');
const platform = require('@ai-search/platform');
const { sequelize, connectDB } = require('./src/shared/config/database');
const redis = require('./src/shared/config/redis');
const events = require('./src/shared/events');
const { createApp } = require('./src/app');

const start = async () => {
    await connectDB();
    await redis.ping();

    if (config.MIGRATE_ON_START) {
        await platform.migrateUp({
            sequelize,
            Sequelize,
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
            () => redis.quit(),
            () => sequelize.close(),
        ],
    });
};

start().catch((err) => {
    logger.fatal({ err }, 'Failed to start auth-service');
    process.exit(1);
});
