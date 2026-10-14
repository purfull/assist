import type { Migration } from '@ai-search/platform';

/**
 * Indexes for the payment lookups (by order id on verify/fail, by user on history).
 * Previously these were full table scans.
 */
const INDEXES = [
    { name: 'transactions_razorpay_order_id', fields: ['razorpayOrderId'] },
    { name: 'transactions_user_id', fields: ['userId'] },
];

export const up: Migration = async ({ context: { queryInterface } }) => {
    // Sequelize types showIndex loosely; MySQL returns one entry per index with its name
    const indexes = (await queryInterface.showIndex('transactions')) as Array<{ name: string }>;
    const existing = new Set(indexes.map((i) => i.name));
    for (const index of INDEXES) {
        if (!existing.has(index.name)) await queryInterface.addIndex('transactions', index.fields, { name: index.name });
    }
};

export const down: Migration = async ({ context: { queryInterface } }) => {
    for (const index of INDEXES) await queryInterface.removeIndex('transactions', index.name);
};
