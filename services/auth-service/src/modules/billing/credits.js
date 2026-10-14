const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../shared/config/database');
const { EVENTS, publish } = require('../../shared/events');

/**
 * Credit balance — owned by the billing module.
 *
 * The balance still lives in the users.credits column (shared with identity) until it
 * moves to a billing-owned ledger table. Until then, this file is the only code in
 * auth-service allowed to write that column; other modules read it through getBalance().
 */

/**
 * Atomically add credits to a user's balance.
 * @param {number} userId
 * @param {number} amount - positive integer
 * @param {{ transaction?: import('sequelize').Transaction }} [options]
 * @returns {Promise<number>} the new balance
 */
const addCredits = async (userId, amount, { transaction } = {}) => {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('Credit amount must be a positive integer');
    }

    await sequelize.query(
        'UPDATE users SET credits = credits + :amount WHERE id = :userId',
        { replacements: { amount, userId }, transaction }
    );

    return getBalance(userId, { transaction });
};

/**
 * Read a user's current credit balance.
 * @param {number} userId
 * @param {{ transaction?: import('sequelize').Transaction }} [options]
 * @returns {Promise<number|null>} null if the user does not exist
 */
const getBalance = async (userId, { transaction } = {}) => {
    const rows = await sequelize.query(
        'SELECT credits FROM users WHERE id = :userId',
        { replacements: { userId }, type: QueryTypes.SELECT, transaction }
    );
    return rows.length ? rows[0].credits : null;
};

/**
 * Tell live clients (SSE) about a new balance. Call after the DB transaction commits.
 */
const announceBalance = (userId, credits) => publish(EVENTS.CREDITS_UPDATED, { userId, credits });

module.exports = { addCredits, getBalance, announceBalance };
