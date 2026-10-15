import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../../shared/config/database';

/** agent_logs — written by another codebase that shares this database (module not mounted). */
export class AgentLog extends Model<InferAttributes<AgentLog>, InferCreationAttributes<AgentLog>> {
    declare id: CreationOptional<number>;
    declare agentId: number;
    declare userId: number;
    declare query: CreationOptional<string | null>;
    declare ipAddress: CreationOptional<string | null>;
    declare userAgent: CreationOptional<string | null>;
    declare location: CreationOptional<string | null>;
    declare country: CreationOptional<string | null>;
    declare status: CreationOptional<string>;
    declare creditsDeducted: CreationOptional<number>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}

AgentLog.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    agentId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'agents', key: 'id' } },
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
    query: { type: DataTypes.TEXT, allowNull: true },
    ipAddress: { type: DataTypes.STRING, allowNull: true },
    userAgent: { type: DataTypes.STRING, allowNull: true },
    location: { type: DataTypes.STRING, allowNull: true },
    country: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, defaultValue: 'success' },
    creditsDeducted: { type: DataTypes.INTEGER, defaultValue: 1 },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
}, {
    sequelize,
    tableName: 'agent_logs',
    timestamps: true,
});

export default AgentLog;
