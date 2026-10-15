import { QueryTypes, type Transaction as DbTransaction } from 'sequelize';
import { sequelize } from '../../shared/config/database';
import { EVENTS, publish } from '../../shared/events';

/**
 * Credit balance — owned by the billing module.
 *
 * The balance still lives in the users.credits column (shared with identity) until it
 * moves to a billing-owned ledger table. Until then, this file is the only code in
 * auth-service allowed to write that column; other modules read it through getBalance().
 */

interface QueryOptions {
    transaction?: DbTransaction;
}

/**
 * Read a user's current credit balance.
 * @returns null if the user does not exist
 */
export const getBalance = async (userId: number, { transaction }: QueryOptions = {}): Promise<number | null> => {
    const rows = await sequelize.query<{ credits: number }>(
        'SELECT credits FROM users WHERE id = :userId',
        { replacements: { userId }, type: QueryTypes.SELECT, transaction },
    );
    return rows[0]?.credits ?? null;
};

/**
 * Atomically add credits to a user's balance.
 * @returns the new balance
 */
export const addCredits = async (userId: number, amount: number, { transaction }: QueryOptions = {}): Promise<number | null> => {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('Credit amount must be a positive integer');
    }

    await sequelize.query(
        'UPDATE users SET credits = credits + :amount WHERE id = :userId',
        { replacements: { amount, userId }, transaction },
    );

    return getBalance(userId, { transaction });
};

/**
 * Tell live clients (SSE) about a new balance. Call after the DB transaction commits.
 */
export const announceBalance = (userId: number, credits: number): Promise<number> =>
    publish(EVENTS.CREDITS_UPDATED, { userId, credits });
