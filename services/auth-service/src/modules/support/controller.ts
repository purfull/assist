import crypto from 'crypto';
import type { RequestHandler } from 'express';
import Ticket, { type TicketReply } from './models/Ticket';
import { currentUser } from '../identity';

type TicketParams = { id: string };
interface CreateTicketBody { subject: string; message: string; priority?: 'Low' | 'Medium' | 'High' }
interface ReplyBody { message: string }

const newReply = (userId: number, message: string): TicketReply => ({
    id: crypto.randomUUID(),
    senderId: userId,
    senderModel: 'User',
    message,
    createdAt: new Date().toISOString(),
});

/**
 * POST /tickets — create a support ticket with its first message
 */
export const createTicket: RequestHandler<Record<string, string>, unknown, CreateTicketBody> = async (req, res) => {
    try {
        const { subject, priority, message } = req.body;
        const { userId } = currentUser(req);

        const ticket = await Ticket.create({
            userId,
            subject,
            priority: priority ?? 'Medium',
            replies: [newReply(userId, message)],
        });

        return res.status(201).json(ticket);
    } catch (error) {
        req.log.error({ err: error }, 'Error in createTicket');
        return res.status(500).json({ error: 'Server error while creating ticket' });
    }
};

/**
 * GET /tickets — the current user's tickets, newest first
 */
export const getTickets: RequestHandler = async (req, res) => {
    try {
        const tickets = await Ticket.findAll({
            where: { userId: currentUser(req).userId },
            order: [['createdAt', 'DESC']],
        });
        return res.status(200).json(tickets);
    } catch (error) {
        req.log.error({ err: error }, 'Error in getTickets');
        return res.status(500).json({ error: 'Server error while fetching tickets' });
    }
};

/**
 * GET /tickets/:id — one ticket, only if it belongs to the current user
 */
export const getTicketById: RequestHandler<TicketParams> = async (req, res) => {
    try {
        const ticket = await Ticket.findOne({
            where: { id: req.params.id, userId: currentUser(req).userId },
        });
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }
        return res.status(200).json(ticket);
    } catch (error) {
        req.log.error({ err: error }, 'Error in getTicketById');
        return res.status(500).json({ error: 'Server error while fetching ticket' });
    }
};

/**
 * POST /tickets/:id/reply — append a reply to the current user's ticket
 */
export const addReply: RequestHandler<TicketParams, unknown, ReplyBody> = async (req, res) => {
    try {
        const { userId } = currentUser(req);
        const ticket = await Ticket.findOne({
            where: { id: req.params.id, userId },
        });
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found.' });
        }

        // Sequelize JSON updates: assign a new array and mark the field changed
        ticket.replies = [...ticket.replies, newReply(userId, req.body.message)];
        ticket.changed('replies', true);
        await ticket.save();

        return res.status(200).json(ticket);
    } catch (error) {
        req.log.error({ err: error }, 'Error in addReply');
        return res.status(500).json({ error: 'Server error while replying to ticket' });
    }
};
