const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate } = require('../middleware/authMiddleware');

/**
 * @route   POST /auth/payment/order
 * @desc    Create a Razorpay order
 * @access  Private
 */
router.post('/order', authenticate, paymentController.createOrder);

/**
 * @route   POST /auth/payment/verify
 * @desc    Verify Razorpay payment signature
 * @access  Private
 */
router.post('/verify', authenticate, paymentController.verifyPayment);

/**
 * @route   POST /auth/payment/fail
 * @desc    Mark Razorpay payment as failed/cancelled
 * @access  Private
 */
router.post('/fail', authenticate, paymentController.failPayment);

/**
 * @route   GET /auth/payment/transactions
 * @desc    Get transaction history
 * @access  Private
 */
router.get('/transactions', authenticate, paymentController.getTransactions);

module.exports = router;
