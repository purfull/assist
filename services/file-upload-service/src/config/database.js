const { Sequelize } = require('sequelize');
const logger = require('../shared/logger');

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        dialect: 'mysql',
        logging: (sql) => logger.debug({ sql }, 'SQL'),
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000,
        },
    }
);

/**
 * Verify the database is reachable. Schema changes are applied by migrations
 * (npm run migrate), never by sequelize.sync() at startup.
 */
const connectDB = async () => {
    await sequelize.authenticate();
    logger.info('MySQL connected');
};

module.exports = { sequelize, connectDB };
