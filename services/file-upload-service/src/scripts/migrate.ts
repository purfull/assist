// Usage: npm run migrate [-- up|down|pending|executed]   (npm run migrate:dev from source)
import 'dotenv/config';
import path from 'path';
import { runMigrationCli } from '@ai-search/platform';
import { sequelize } from '../config/database';
import logger from '../shared/logger';

void runMigrationCli({
    sequelize,
    dir: path.join(__dirname, '../migrations'),
    tableName: 'migrations_files',
    logger,
});
