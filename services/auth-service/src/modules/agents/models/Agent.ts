import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../../shared/config/database';

export interface AgentSettings {
    rateLimitMin: number;
    rateLimitHour: number;
    whitelistedIps: string[];
    whitelistedDomains: string[];
    blockedCountries: string[];
    blockedUsers: string[];
    blockedIps: string[];
}

/** agents — written by another codebase that shares this database (module not mounted). */
export class Agent extends Model<InferAttributes<Agent>, InferCreationAttributes<Agent>> {
    declare id: CreationOptional<number>;
    declare userId: number;
    declare name: string;
    /** AES-256-CBC encrypted API key (iv:ciphertext) */
    declare publicKey: CreationOptional<string | null>;
    /** SHA-256 hash of the API key for fast lookup */
    declare secretKey: CreationOptional<string | null>;
    declare settings: CreationOptional<AgentSettings | null>;
    declare creditCost: CreationOptional<number>;
    declare status: CreationOptional<'active' | 'inactive'>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}

Agent.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
    name: { type: DataTypes.STRING, allowNull: false },
    publicKey: {
        type: DataTypes.STRING(512),
        allowNull: true,
        unique: true,
        comment: 'AES-256-CBC encrypted API key (iv:ciphertext)',
    },
    secretKey: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        comment: 'SHA-256 hash of the API key for fast lookup',
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
            blockedIps: [],
        },
    },
    creditCost: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
}, {
    sequelize,
    tableName: 'agents',
    timestamps: true,
});

export default Agent;
