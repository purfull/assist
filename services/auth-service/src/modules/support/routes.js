const express = require('express');
const { authenticate } = require('../identity');
const {
    createTicket,
    getTickets,
    getTicketById,
    addReply
} = require('./controller');
const { validateCreateTicket, validateTicketId, validateReply } = require('./validator');

const router = express.Router();

// Apply protect middleware to all ticket routes
router.use(authenticate);

router.post('/', validateCreateTicket, createTicket);
router.get('/', getTickets);
router.get('/:id', validateTicketId, getTicketById);
router.post('/:id/reply', validateReply, addReply);

module.exports = router;
