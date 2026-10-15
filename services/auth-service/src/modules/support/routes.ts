import { Router } from 'express';
import { authenticate } from '../identity';
import {
    createTicket,
    getTickets,
    getTicketById,
    addReply
} from './controller';
import { validateCreateTicket, validateTicketId, validateReply } from './validator';

const router = Router();

// Apply protect middleware to all ticket routes
router.use(authenticate);

router.post('/', validateCreateTicket, createTicket);
router.get('/', getTickets);
router.get('/:id', validateTicketId, getTicketById);
router.post('/:id/reply', validateReply, addReply);

export default router;
