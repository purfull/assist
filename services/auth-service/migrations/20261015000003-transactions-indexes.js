/**
 * Indexes for the payment lookups (by order id on verify/fail, by user on history).
 * Previously these were full table scans.
 */
const INDEXES = [
    { name: 'transactions_razorpay_order_id', fields: ['razorpayOrderId'] },
    { name: 'transactions_user_id', fields: ['userId'] },
];

module.exports = {
    async up({ context: { queryInterface } }) {
        const existing = new Set((await queryInterface.showIndex('transactions')).map((i) => i.name));
        for (const index of INDEXES) {
            if (!existing.has(index.name)) await queryInterface.addIndex('transactions', index.fields, { name: index.name });
        }
    },

    async down({ context: { queryInterface } }) {
        for (const index of INDEXES) await queryInterface.removeIndex('transactions', index.name);
    },
};
