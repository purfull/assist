const { DataTypes } = require('sequelize');
const { sequelize } = require('../../../shared/config/database');

const Ticket = sequelize.define('Ticket', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        // users.id is owned by the identity module; referenced by id only
        references: {
            model: 'users',
            key: 'id'
        }
    },
    subject: {
        type: DataTypes.STRING,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('Open', 'Closed'),
        defaultValue: 'Open'
    },
    priority: {
        type: DataTypes.ENUM('Low', 'Medium', 'High'),
        defaultValue: 'Medium'
    },
    replies: {
        type: DataTypes.JSON,
        defaultValue: []
    }
}, {
    timestamps: true,
    tableName: 'tickets'
});

module.exports = Ticket;
