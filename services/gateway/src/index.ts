import 'dotenv/config';
import * as platform from '@ai-search/platform';
import { loadConfig, type GatewayConfig } from './config';
import { createApp } from './app';

const logger = platform.createLogger('gateway');

let config: GatewayConfig;
try {
    config = loadConfig();
} catch (err) {
    logger.fatal((err as Error).message);
    process.exit(1);
}

platform.startServer({ app: createApp(config, logger), port: config.PORT, logger });
