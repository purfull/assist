import { Router } from 'express';
import * as paymentController from './controller';
import { authenticate } from '../identity';
import { validateCreateOrder, validateVerifyPayment, validateFailPayment } from './validator';

const router = Router();

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

export default router;
