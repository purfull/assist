import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../../shared/config/database';
import User from './User';

/** One row per signed-in device. */
export class RefreshToken extends Model<InferAttributes<RefreshToken>, InferCreationAttributes<RefreshToken>> {
    declare id: CreationOptional<number>;
    declare userId: number;
    /** SHA-256 hex of the refresh token (see hashRefreshToken), never the token itself */
    declare token: string;
    declare expiresAt: Date;
    declare userAgent: CreationOptional<string | null>;
    declare ipAddress: CreationOptional<string | null>;
    declare lastUsedAt: CreationOptional<Date>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}

RefreshToken.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: User, key: 'id' } },
    token: { type: DataTypes.STRING(500), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    userAgent: { type: DataTypes.STRING, allowNull: true },
    ipAddress: { type: DataTypes.STRING, allowNull: true },
    lastUsedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
}, {
    sequelize,
    tableName: 'refresh_tokens',
    timestamps: true,
    indexes: [
        { fields: ['userId'] },
        { fields: ['token'] },
    ],
});

// Associations (both models are in the identity module)
User.hasMany(RefreshToken, { foreignKey: 'userId', onDelete: 'CASCADE' });
RefreshToken.belongsTo(User, { foreignKey: 'userId' });

export default RefreshToken;
