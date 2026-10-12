const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Agent = sequelize.define('Agent', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    publicKey: {
        type: DataTypes.STRING(512),
        allowNull: true,
        unique: true,
        comment: 'AES-256-CBC encrypted API key (iv:ciphertext)'
    },
    secretKey: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        comment: 'SHA-256 hash of the API key for fast lookup'
    },
    settings: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {
            rateLimitMin: 60,
            rateLimitHour: 1000,
            whitelistedIps: [],
            whitelistedDomains: [],
            blockedCountries: [],
            blockedUsers: [],
            blockedIps: []
        }
    },
    creditCost: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    },
    status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active'
    }
}, {
    tableName: 'agents',
    timestamps: true
});

module.exports = Agent;
