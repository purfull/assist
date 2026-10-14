/**
 * Billing module — public API.
 *
 * Owns: payment orders and transactions (Razorpay), the credit balance.
 * Other modules may only import from this file, never from billing internals.
 */
const router = require('./routes');
const { getBalance } = require('./credits');

module.exports = {
    router,
    getBalance
};
