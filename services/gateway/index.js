require('dotenv').config();
const platform = require('@ai-search/platform');
const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

const logger = platform.createLogger('gateway');

let config;
try {
    config = loadConfig();
} catch (err) {
    logger.fatal(err.message);
    process.exit(1);
}

const app = createApp(config, logger);
platform.startServer({ app, port: config.PORT, logger });
