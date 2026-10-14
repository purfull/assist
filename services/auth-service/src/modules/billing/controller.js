const Razorpay = require('razorpay');
const crypto = require('crypto');
const Transaction = require('./models/Transaction');
const { sequelize } = require('../../shared/config/database');
const { addCredits, announceBalance } = require('./credits');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

exports.createOrder = async (req, res) => {
    try {
        const amount = Number(req.body.amount); // Amount in INR (numeric strings accepted)

        // Credits are stored as integers, so only whole rupee amounts are accepted
        if (!Number.isInteger(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const options = {
            amount: amount * 100, // amount in the smallest currency unit (paise)
            currency: 'INR',
            receipt: `receipt_${Date.now()}`,
        };

        const order = await razorpay.orders.create(options);

        // Create a pending transaction record
        await Transaction.create({
            userId: req.user.userId,
            amount: amount,
            status: 'pending',
            razorpayOrderId: order.id,
            description: `Adding ${amount} credits`
        });

        res.json({
            id: order.id,
            amount: order.amount,
            currency: order.currency
        });
    } catch (error) {
        req.log.error({ err: error }, 'Create order error');
        res.status(500).json({ error: 'Failed to create payment order' });
    }
};

exports.verifyPayment = async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        } = req.body;

        if (
            typeof razorpay_order_id !== 'string' ||
            typeof razorpay_payment_id !== 'string' ||
            typeof razorpay_signature !== 'string'
        ) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }

        const body = razorpay_order_id + "|" + razorpay_payment_id;

        const expectedSignature = Buffer.from(
            crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                .update(body)
                .digest('hex')
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
        const result = await sequelize.transaction(async (t) => {
            const transaction = await Transaction.findOne({
                where: { razorpayOrderId: razorpay_order_id, userId: req.user.userId },
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            if (!transaction) {
                return { notFound: true };
            }

            if (transaction.status === 'success') {
                return { alreadyProcessed: true };
            }

            // Update transaction
            await transaction.update({
                status: 'success',
                razorpayPaymentId: razorpay_payment_id,
                razorpaySignature: razorpay_signature
            }, { transaction: t });

            // Atomic increment instead of read-modify-write on the user row
            const credits = await addCredits(transaction.userId, transaction.amount, { transaction: t });
            return { userId: transaction.userId, credits };
        });

        if (result.notFound) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        if (result.alreadyProcessed) {
            return res.json({ message: 'Payment already processed' });
        }

        // Push the new balance to any open credit streams (after commit)
        announceBalance(result.userId, result.credits).catch((err) =>
            req.log.error({ err }, 'Failed to announce credit balance')
        );

        res.json({
            success: true,
            message: 'Payment verified and credits added',
            credits: result.credits
        });
    } catch (error) {
        req.log.error({ err: error }, 'Verify payment error');
        res.status(500).json({ error: 'Payment verification failed' });
    }
};

exports.getTransactions = async (req, res) => {
    try {
        const transactions = await Transaction.findAll({
            where: { userId: req.user.userId },
            order: [['createdAt', 'DESC']]
        });
        res.json({ transactions });
    } catch (error) {
        req.log.error({ err: error }, 'Get transactions error');
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
};

exports.failPayment = async (req, res) => {
    try {
        const { razorpay_order_id, reason } = req.body;

        if (!razorpay_order_id) {
            return res.status(400).json({ error: 'Order ID is required' });
        }

        // Only pending orders owned by the caller can be marked failed. The conditional
        // update also prevents racing a concurrent successful verification.
        const [updated] = await Transaction.update(
            {
                status: 'failed',
                description: typeof reason === 'string' && reason ? reason.slice(0, 255) : 'Payment cancelled by user'
            },
            { where: { razorpayOrderId: razorpay_order_id, userId: req.user.userId, status: 'pending' } }
        );

        if (updated === 0) {
            const transaction = await Transaction.findOne({
                where: { razorpayOrderId: razorpay_order_id, userId: req.user.userId }
            });
            if (!transaction) {
                return res.status(404).json({ error: 'Transaction not found' });
            }
            if (transaction.status === 'success') {
                return res.status(400).json({ error: 'Cannot fail a successful transaction' });
            }
        }

        res.json({
            success: true,
            message: 'Transaction marked as failed',
            status: 'failed'
        });
    } catch (error) {
        req.log.error({ err: error }, 'Fail payment error');
        res.status(500).json({ error: 'Failed to update transaction status' });
    }
};
