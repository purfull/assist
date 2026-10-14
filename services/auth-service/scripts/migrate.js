#!/usr/bin/env node
// Usage: npm run migrate [-- up|down|pending|executed]
require('dotenv').config();
const path = require('path');
const { Sequelize } = require('sequelize');
const { runMigrationCli } = require('@ai-search/platform');
const { sequelize } = require('../src/shared/config/database');
const logger = require('../src/shared/logger');

runMigrationCli({
    sequelize,
    Sequelize,
    dir: path.join(__dirname, '../migrations'),
    tableName: 'migrations_auth',
    logger,
});
