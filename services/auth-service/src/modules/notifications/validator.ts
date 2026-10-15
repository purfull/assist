import { param } from 'express-validator';
import { handleValidationErrors } from '../../shared/middleware/validate';

export const validateNotificationId = [
    param('id').isInt({ min: 1 }).withMessage('Invalid notification id'),
    handleValidationErrors
];

