const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        dialect: 'mysql',
        logging: process.env.NODE_ENV === 'development' ? console.log : false,
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        }
    }
);

const connectDB = async () => {
    try {
        await sequelize.authenticate();
        console.log('✓ MySQL Database connected successfully');

        // Sync models in development
        if (process.env.NODE_ENV === 'development') {
            await sequelize.sync();
            console.log('✓ Database models synchronized');



            try {
                // Add trialEndsAt column for 30-day free trial feature
                await sequelize.query("ALTER TABLE users ADD COLUMN trialEndsAt DATETIME DEFAULT NULL;");
                console.log('✓ users.trialEndsAt column added');
            } catch (err) {
                // Column already exists — safe to ignore
                if (!err.message.includes('Duplicate column')) {
                    console.log('Note: trialEndsAt column adjustment skipped:', err.message);
                }
            }

            try {
                // Add trialWarningDays column for free trial warning threshold
                await sequelize.query("ALTER TABLE users ADD COLUMN trialWarningDays INT NOT NULL DEFAULT 7;");
                console.log('✓ users.trialWarningDays column added');
            } catch (err) {
                // Column already exists — safe to ignore
                if (!err.message.includes('Duplicate column')) {
                    console.log('Note: trialWarningDays column adjustment skipped:', err.message);
                }
            }
        }
    } catch (error) {
        console.error('✗ Unable to connect to database:', error.message);
        process.exit(1);
    }
};

module.exports = { sequelize, connectDB };
