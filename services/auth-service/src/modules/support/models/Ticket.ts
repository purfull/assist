import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../../shared/config/database';

export interface TicketReply {
    id: string;
    senderId: number;
    senderModel: 'User';
    message: string;
    createdAt: string;
}

export class Ticket extends Model<InferAttributes<Ticket>, InferCreationAttributes<Ticket>> {
    declare id: CreationOptional<string>;
    declare userId: number;
    declare subject: string;
    declare status: CreationOptional<'Open' | 'Closed'>;
    declare priority: CreationOptional<'Low' | 'Medium' | 'High'>;
    declare replies: CreationOptional<TicketReply[]>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}

Ticket.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    // users.id is owned by the identity module; referenced by id only
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
    subject: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM('Open', 'Closed'), defaultValue: 'Open' },
    priority: { type: DataTypes.ENUM('Low', 'Medium', 'High'), defaultValue: 'Medium' },
    replies: { type: DataTypes.JSON, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
}, {
    sequelize,
    tableName: 'tickets',
    timestamps: true,
});

export default Ticket;
