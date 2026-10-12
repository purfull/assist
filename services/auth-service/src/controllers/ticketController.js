const Ticket = require('../models/Ticket');
const User = require('../models/User');

// @desc    Create a new support ticket
// @route   POST /auth/tickets
// @access  Private
const createTicket = async (req, res) => {
    try {
        const { subject, priority, message } = req.body;
        const userId = req.user.userId; // From authMiddleware

        if (!subject || !message) {
            return res.status(400).json({ error: 'Subject and initial message are required.' });
        }

        const newReply = {
            id: require('crypto').randomUUID(),
            senderId: parseInt(userId, 10),
            senderModel: 'User',
            message: message,
            createdAt: new Date().toISOString()
        };

        const ticket = await Ticket.create({
            userId,
            subject,
            priority: priority || 'Medium',
            replies: [newReply]
        });

        res.status(201).json(ticket);
    } catch (error) {
        console.error('Error in createTicket:', error);
        res.status(500).json({ error: 'Server error while creating ticket' });
    }
};

// @desc    Get user's all tickets
// @route   GET /auth/tickets
// @access  Private
const getTickets = async (req, res) => {
    try {
        const userId = req.user.userId;
        const tickets = await Ticket.findAll({
            where: { userId },
            order: [['createdAt', 'DESC']]
        });
        res.status(200).json(tickets);
    } catch (error) {
        console.error('Error in getTickets:', error);
        res.status(500).json({ error: 'Server error while fetching tickets' });
    }
};

// @desc    Get single ticket details
// @route   GET /auth/tickets/:id
// @access  Private
const getTicketById = async (req, res) => {
    try {
        const ticketId = req.params.id;
        const userId = req.user.userId;

        const ticket = await Ticket.findOne({
            where: { id: ticketId, userId }
        });

        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        res.status(200).json(ticket);
    } catch (error) {
        console.error('Error in getTicketById:', error);
        res.status(500).json({ error: 'Server error while fetching ticket' });
    }
};

// @desc    Add a reply to a ticket
// @route   POST /auth/tickets/:id/reply
// @access  Private
const addReply = async (req, res) => {
    try {
        const { message } = req.body;
        const ticketId = req.params.id;
        const userId = req.user.userId;

        if (!message) {
            return res.status(400).json({ error: 'Message cannot be empty.' });
        }

        const ticket = await Ticket.findOne({
            where: { id: ticketId, userId }
        });

        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found.' });
        }

        const newReply = {
            id: require('crypto').randomUUID(),
            senderId: parseInt(userId, 10),
            senderModel: 'User',
            message: message,
            createdAt: new Date().toISOString()
        };

        // Sequelize JSON updates: create a new array based on the old one
        const updatedReplies = [...ticket.replies, newReply];

        ticket.replies = updatedReplies;
        // Mark the json field as changed to ensure Sequelize saves it
        ticket.changed('replies', true);

        await ticket.save();

        res.status(200).json(ticket);
    } catch (error) {
        console.error('Error in addReply:', error);
        res.status(500).json({ error: 'Server error while replying to ticket' });
    }
};

module.exports = {
    createTicket,
    getTickets,
    getTicketById,
    addReply
};
