import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../../shared/config/database';

export class Notification extends Model<InferAttributes<Notification>, InferCreationAttributes<Notification>> {
    declare id: CreationOptional<number>;
    declare userId: number;
    declare message: string;
    declare isRead: CreationOptional<boolean>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}

Notification.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    // users.id is owned by the identity module; referenced by id only
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
    message: { type: DataTypes.TEXT, allowNull: false },
    isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
}, {
    sequelize,
    tableName: 'notifications',
    timestamps: true,
});

export default Notification;
