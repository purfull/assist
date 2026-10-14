const express = require('express');
const router = express.Router();
const paymentController = require('./controller');
const { authenticate } = require('../identity');
const { validateCreateOrder, validateVerifyPayment, validateFailPayment } = require('./validator');

/**
 * @route   POST /auth/payment/order
 * @desc    Create a Razorpay order
 * @access  Private
 */
router.post('/order', authenticate, validateCreateOrder, paymentController.createOrder);

/**
 * @route   POST /auth/payment/verify
 * @desc    Verify Razorpay payment signature
 * @access  Private
 */
router.post('/verify', authenticate, validateVerifyPayment, paymentController.verifyPayment);

/**
 * @route   POST /auth/payment/fail
 * @desc    Mark Razorpay payment as failed/cancelled
 * @access  Private
 */
router.post('/fail', authenticate, validateFailPayment, paymentController.failPayment);

/**
 * @route   GET /auth/payment/transactions
 * @desc    Get transaction history
 * @access  Private
 */
router.get('/transactions', authenticate, paymentController.getTransactions);

module.exports = router;
