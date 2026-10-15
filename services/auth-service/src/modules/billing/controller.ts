import crypto from 'crypto';
import type { RequestHandler } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import Razorpay from 'razorpay';
import Transaction from './models/Transaction';
import { sequelize } from '../../shared/config/database';
import { addCredits, announceBalance } from './credits';
import { currentUser } from '../identity';

type Handler<Body = unknown> = RequestHandler<ParamsDictionary, unknown, Body>;

interface CreateOrderBody { amount: number | string }
interface VerifyPaymentBody { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
interface FailPaymentBody { razorpay_order_id: string; reason?: string }

type VerifyOutcome =
    | { kind: 'notFound' }
    | { kind: 'alreadyProcessed' }
    | { kind: 'credited'; userId: number; credits: number | null };

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID ?? '',
    key_secret: process.env.RAZORPAY_KEY_SECRET ?? '',
});

/**
 * Create a Razorpay order and a pending transaction.
 */
export const createOrder: Handler<CreateOrderBody> = async (req, res) => {
    try {
        const amount = Number(req.body.amount); // Amount in INR (numeric strings accepted)

        // Credits are stored as integers, so only whole rupee amounts are accepted
        if (!Number.isInteger(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const order = await razorpay.orders.create({
            amount: amount * 100, // smallest currency unit (paise)
            currency: 'INR',
            receipt: `receipt_${Date.now()}`,
        });

        await Transaction.create({
            userId: currentUser(req).userId,
            amount,
            status: 'pending',
            razorpayOrderId: order.id,
            description: `Adding ${amount} credits`,
        });

        return res.json({ id: order.id, amount: order.amount, currency: order.currency });
    } catch (error) {
        req.log.error({ err: error }, 'Create order error');
        return res.status(500).json({ error: 'Failed to create payment order' });
    }
};

/**
 * Verify the Razorpay signature and credit the user exactly once.
 */
export const verifyPayment: Handler<VerifyPaymentBody> = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const { userId } = currentUser(req);

        const expectedSignature = Buffer.from(
            crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET ?? '')
                .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                .digest('hex'),
        );
        const receivedSignature = Buffer.from(razorpay_signature);
        if (
            expectedSignature.length !== receivedSignature.length ||
            !crypto.timingSafeEqual(expectedSignature, receivedSignature)
        ) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }

        // Lock the transaction row so concurrent verify calls for the same order
        // can't both credit the user.
        const outcome = await sequelize.transaction(async (t): Promise<VerifyOutcome> => {
            const transaction = await Transaction.findOne({
                where: { razorpayOrderId: razorpay_order_id, userId },
                lock: t.LOCK.UPDATE,
                transaction: t,
            });
            if (!transaction) return { kind: 'notFound' };
            if (transaction.status === 'success') return { kind: 'alreadyProcessed' };

            await transaction.update({
                status: 'success',
                razorpayPaymentId: razorpay_payment_id,
                razorpaySignature: razorpay_signature,
            }, { transaction: t });

            // Atomic increment instead of read-modify-write on the user row
            const credits = await addCredits(transaction.userId, transaction.amount, { transaction: t });
            return { kind: 'credited', userId: transaction.userId, credits };
        });

        if (outcome.kind === 'notFound') {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        if (outcome.kind === 'alreadyProcessed') {
            return res.json({ message: 'Payment already processed' });
        }

        // Push the new balance to any open credit streams (after commit)
        if (outcome.credits !== null) {
            announceBalance(outcome.userId, outcome.credits).catch((err: unknown) =>
                req.log.error({ err }, 'Failed to announce credit balance'));
        }

        return res.json({
            success: true,
            message: 'Payment verified and credits added',
            credits: outcome.credits,
        });
    } catch (error) {
        req.log.error({ err: error }, 'Verify payment error');
        return res.status(500).json({ error: 'Payment verification failed' });
    }
};

/**
 * Transaction history for the current user.
 */
export const getTransactions: Handler = async (req, res) => {
    try {
        const transactions = await Transaction.findAll({
            where: { userId: currentUser(req).userId },
            order: [['createdAt', 'DESC']],
        });
        return res.json({ transactions });
    } catch (error) {
        req.log.error({ err: error }, 'Get transactions error');
        return res.status(500).json({ error: 'Failed to fetch transactions' });
    }
};

/**
 * Mark a pending order as failed/cancelled.
 */
export const failPayment: Handler<FailPaymentBody> = async (req, res) => {
    try {
        const { razorpay_order_id, reason } = req.body;
        const { userId } = currentUser(req);

        // Only pending orders owned by the caller can be marked failed. The conditional
        // update also prevents racing a concurrent successful verification.
        const [updated] = await Transaction.update(
            {
                status: 'failed',
                description: reason ? reason.slice(0, 255) : 'Payment cancelled by user',
            },
            { where: { razorpayOrderId: razorpay_order_id, userId, status: 'pending' } },
        );

        if (updated === 0) {
            const transaction = await Transaction.findOne({ where: { razorpayOrderId: razorpay_order_id, userId } });
            if (!transaction) {
                return res.status(404).json({ error: 'Transaction not found' });
            }
            if (transaction.status === 'success') {
                return res.status(400).json({ error: 'Cannot fail a successful transaction' });
            }
        }

        return res.json({ success: true, message: 'Transaction marked as failed', status: 'failed' });
    } catch (error) {
        req.log.error({ err: error }, 'Fail payment error');
        return res.status(500).json({ error: 'Failed to update transaction status' });
    }
};
