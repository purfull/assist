const { body } = require('express-validator');
const { handleValidationErrors } = require('../../shared/middleware/validate');

const razorpayId = (field) => body(field)
    .isString().withMessage(`${field} is required`)
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage(`${field} must be 1-100 characters`);

const validateCreateOrder = [
    body('amount')
        .isInt({ min: 1, max: 1000000 }).withMessage('Amount must be a whole number between 1 and 1,000,000')
        .toInt(),
    handleValidationErrors
];

const validateVerifyPayment = [
    razorpayId('razorpay_order_id'),
    razorpayId('razorpay_payment_id'),
    body('razorpay_signature')
        .isString()
        .isHexadecimal().withMessage('Invalid payment signature')
        .isLength({ min: 64, max: 64 }).withMessage('Invalid payment signature'),
    handleValidationErrors
];

const validateFailPayment = [
    razorpayId('razorpay_order_id'),
    body('reason').optional().isString().trim().isLength({ max: 255 }),
    handleValidationErrors
];

module.exports = { validateCreateOrder, validateVerifyPayment, validateFailPayment };
