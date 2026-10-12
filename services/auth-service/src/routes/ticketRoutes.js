const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const {
    createTicket,
    getTickets,
    getTicketById,
    addReply
} = require('../controllers/ticketController');

const router = express.Router();

// Apply protect middleware to all ticket routes
router.use(authenticate);

router.post('/', createTicket);
router.get('/', getTickets);
router.get('/:id', getTicketById);
router.post('/:id/reply', addReply);

module.exports = router;
