import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../../shared/config/database';

export type TransactionStatus = 'pending' | 'success' | 'failed';
export type TransactionType = 'credit_add' | 'usage';

export class Transaction extends Model<InferAttributes<Transaction>, InferCreationAttributes<Transaction>> {
    declare id: CreationOptional<number>;
    declare userId: number;
    /** Whole rupees; also the number of credits granted */
    declare amount: number;
    declare currency: CreationOptional<string>;
    declare status: CreationOptional<TransactionStatus>;
    declare razorpayOrderId: CreationOptional<string | null>;
    declare razorpayPaymentId: CreationOptional<string | null>;
    declare razorpaySignature: CreationOptional<string | null>;
    declare type: CreationOptional<TransactionType>;
    declare description: CreationOptional<string | null>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}

Transaction.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING, defaultValue: 'INR' },
    status: { type: DataTypes.ENUM('pending', 'success', 'failed'), defaultValue: 'pending' },
    razorpayOrderId: { type: DataTypes.STRING, allowNull: true },
    razorpayPaymentId: { type: DataTypes.STRING, allowNull: true },
    razorpaySignature: { type: DataTypes.STRING, allowNull: true },
    type: { type: DataTypes.ENUM('credit_add', 'usage'), defaultValue: 'credit_add' },
    description: { type: DataTypes.STRING, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
}, {
    sequelize,
    tableName: 'transactions',
    timestamps: true,
});

export default Transaction;
