const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

exports.createOrder = async (req, res) => {
    try {
        const { amount } = req.body; // Amount in INR

        if (!amount || amount <= 0) {
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
        console.error('Create order error:', error);
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

        const body = razorpay_order_id + "|" + razorpay_payment_id;

        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature === razorpay_signature) {
            // Payment verified
            const transaction = await Transaction.findOne({ where: { razorpayOrderId: razorpay_order_id } });

            if (!transaction) {
                return res.status(404).json({ error: 'Transaction not found' });
            }

            if (transaction.status === 'success') {
                return res.json({ message: 'Payment already processed' });
            }

            // Update transaction
            transaction.status = 'success';
            transaction.razorpayPaymentId = razorpay_payment_id;
            transaction.razorpaySignature = razorpay_signature;
            await transaction.save();

            // Update user credits
            const user = await User.findByPk(transaction.userId);
            user.credits += transaction.amount;
            await user.save();

            res.json({
                success: true,
                message: 'Payment verified and credits added',
                credits: user.credits
            });
        } else {
            res.status(400).json({ error: 'Invalid payment signature' });
        }
    } catch (error) {
        console.error('Verify payment error:', error);
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
        console.error('Get transactions error:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
};

exports.failPayment = async (req, res) => {
    try {
        const { razorpay_order_id, reason } = req.body;

        if (!razorpay_order_id) {
            return res.status(400).json({ error: 'Order ID is required' });
        }

        const transaction = await Transaction.findOne({ where: { razorpayOrderId: razorpay_order_id } });

        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        if (transaction.status === 'success') {
            return res.status(400).json({ error: 'Cannot fail a successful transaction' });
        }

        transaction.status = 'failed';
        transaction.description = reason || 'Payment cancelled by user';
        await transaction.save();

        res.json({
            success: true,
            message: 'Transaction marked as failed',
            status: 'failed'
        });
    } catch (error) {
        console.error('Fail payment error:', error);
        res.status(500).json({ error: 'Failed to update transaction status' });
    }
};
