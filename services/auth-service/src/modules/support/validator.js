const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../../shared/middleware/validate');

const ticketId = param('id').isUUID().withMessage('Invalid ticket id');
const message = body('message')
    .isString().withMessage('Message is required')
    .trim()
    .isLength({ min: 1, max: 5000 }).withMessage('Message must be 1-5000 characters');

const validateCreateTicket = [
    body('subject')
        .isString().withMessage('Subject is required')
        .trim()
        .isLength({ min: 1, max: 200 }).withMessage('Subject must be 1-200 characters'),
    message,
    body('priority').optional().isIn(['Low', 'Medium', 'High']).withMessage('Priority must be Low, Medium or High'),
    handleValidationErrors
];

const validateTicketId = [ticketId, handleValidationErrors];

const validateReply = [ticketId, message, handleValidationErrors];

module.exports = { validateCreateTicket, validateTicketId, validateReply };
