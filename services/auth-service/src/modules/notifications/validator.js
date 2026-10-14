const { param } = require('express-validator');
const { handleValidationErrors } = require('../../shared/middleware/validate');

const validateNotificationId = [
    param('id').isInt({ min: 1 }).withMessage('Invalid notification id'),
    handleValidationErrors
];

module.exports = { validateNotificationId };
