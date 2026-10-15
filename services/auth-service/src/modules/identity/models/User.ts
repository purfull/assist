import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../../shared/config/database';

/**
 * users — owned by the identity module, except `credits`, which only
 * billing/credits.ts may write. Identity reads it for responses.
 */
export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
    declare id: CreationOptional<number>;
    declare email: string;
    declare name: CreationOptional<string | null>;
    /** bcrypt hash; null for OAuth-only users */
    declare password: CreationOptional<string | null>;
    declare googleId: CreationOptional<string | null>;
    declare isVerified: CreationOptional<boolean>;
    declare phone: CreationOptional<string | null>;
    declare companyName: CreationOptional<string | null>;
    declare billingAddress: CreationOptional<string | null>;
    declare city: CreationOptional<string | null>;
    declare state: CreationOptional<string | null>;
    declare zipCode: CreationOptional<string | null>;
    declare country: CreationOptional<string | null>;
    declare taxId: CreationOptional<string | null>;
    declare credits: CreationOptional<number>;
    declare trialEndsAt: CreationOptional<Date | null>;
    declare trialWarningDays: CreationOptional<number>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}

User.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true } },
    name: { type: DataTypes.STRING, allowNull: true },
    password: { type: DataTypes.STRING, allowNull: true },
    googleId: { type: DataTypes.STRING, allowNull: true, unique: true },
    isVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
    phone: { type: DataTypes.STRING, allowNull: true },
    companyName: { type: DataTypes.STRING, allowNull: true },
    billingAddress: { type: DataTypes.STRING, allowNull: true },
    city: { type: DataTypes.STRING, allowNull: true },
    state: { type: DataTypes.STRING, allowNull: true },
    zipCode: { type: DataTypes.STRING, allowNull: true },
    country: { type: DataTypes.STRING, allowNull: true },
    taxId: { type: DataTypes.STRING, allowNull: true },
    credits: { type: DataTypes.INTEGER, defaultValue: 0 },
    trialEndsAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    trialWarningDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 7 },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
}, {
    sequelize,
    tableName: 'users',
    timestamps: true,
    indexes: [
        { fields: ['email'] },
        { fields: ['googleId'] },
    ],
});

export default User;
