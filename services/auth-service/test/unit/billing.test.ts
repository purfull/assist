/**
 * Billing over HTTP with Razorpay and the database faked: order creation, signature
 * verification, crediting exactly once, failing orders and history.
 */
import '../helpers/env';
import { stubRedis } from '../helpers/useStubRedis';
import '../helpers/captureMail';
import { razorpayOrders } from '../helpers/fakeRazorpay';
import { createSandbox } from '../helpers/stub';
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Application } from 'express';
import request from 'supertest';
import { sequelize } from '../../src/shared/config/database';
import Transaction from '../../src/modules/billing/models/Transaction';
import { createApp } from '../../src/app';
import { fakeInstance, fakeUser } from '../helpers/fakes';
import { signInAs } from '../helpers/auth';

const sandbox = createSandbox();
let app: Application;
let auth: string;
let published: unknown[][];

before(() => {
    app = createApp();
});

beforeEach(() => {
    stubRedis.resetRateLimits();
    auth = signInAs(sandbox, fakeUser());
    published = [];
    sandbox.stub(stubRedis, 'publish', async (...args: unknown[]) => { published.push(args); return 1; });
});

afterEach(() => sandbox.restore());

const sign = (orderId: string, paymentId: string) =>
    crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET ?? '').update(`${orderId}|${paymentId}`).digest('hex');

/** Run sequelize.transaction callbacks inline and answer the credits SQL. */
const fakeDbForVerify = (balanceAfter: number) => {
    sandbox.stub(sequelize, 'transaction', async (fn: (t: unknown) => unknown) => fn({ LOCK: { UPDATE: 'UPDATE' } }));
    return sandbox.stub(sequelize, 'query', async (sql: string) => (sql.startsWith('SELECT') ? [{ credits: balanceAfter }] : [[], 1]));
};

describe('create order', () => {
    test('creates a Razorpay order in paise and a pending transaction for the caller', async () => {
        const orders: Array<Record<string, unknown>> = [];
        razorpayOrders.create = async (o) => { orders.push(o); return { id: 'order_1', amount: o.amount, currency: 'INR' }; };
        const created = sandbox.stub(Transaction, 'create', async (v: object) => fakeInstance(v));

        const res = await request(app).post('/auth/payment/order').set('Authorization', auth).send({ amount: 250 });

        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { id: 'order_1', amount: 25000, currency: 'INR' });
        assert.equal(orders[0]?.amount, 25000);
        assert.deepEqual(
            { ...(created[0]?.[0] as object), description: undefined },
            { userId: 42, amount: 250, status: 'pending', razorpayOrderId: 'order_1', description: undefined },
        );
    });

    test('accepts a numeric string amount', async () => {
        razorpayOrders.create = async (o) => ({ id: 'order_2', amount: o.amount, currency: 'INR' });
        sandbox.stub(Transaction, 'create', async (v: object) => fakeInstance(v));
        const res = await request(app).post('/auth/payment/order').set('Authorization', auth).send({ amount: '10' });
        assert.equal(res.status, 200);
        assert.equal(res.body.amount, 1000);
    });

    test('a Razorpay failure is a generic 500 and records nothing', async () => {
        razorpayOrders.create = async () => { throw new Error('razorpay: bad key rzp_live_secret'); };
        const created = sandbox.stub(Transaction, 'create', async (v: object) => fakeInstance(v));
        const res = await request(app).post('/auth/payment/order').set('Authorization', auth).send({ amount: 100 });
        assert.equal(res.status, 500);
        assert.doesNotMatch(JSON.stringify(res.body), /rzp_|razorpay:/);
        assert.equal(created.length, 0);
    });
});

describe('verify payment', () => {
    const paymentBody = (orderId = 'order_1', paymentId = 'pay_1') =>
        ({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(orderId, paymentId) });

    test('rejects a signature for different payment details', async () => {
        const body = { ...paymentBody(), razorpay_payment_id: 'pay_other' };
        const lookups = sandbox.stub(Transaction, 'findOne', async () => null);
        const res = await request(app).post('/auth/payment/verify').set('Authorization', auth).send(body);
        assert.equal(res.status, 400);
        assert.equal(lookups.length, 0, 'nothing is read before the signature checks out');
    });

    test("an order that isn't the caller's is 404", async () => {
        fakeDbForVerify(0);
        const lookups = sandbox.stub(Transaction, 'findOne', async () => null);
        const res = await request(app).post('/auth/payment/verify').set('Authorization', auth).send(paymentBody());
        assert.equal(res.status, 404);
        const options = lookups[0]?.[0] as { where: object; lock: unknown };
        assert.deepEqual(options.where, { razorpayOrderId: 'order_1', userId: 42 });
        assert.equal(options.lock, 'UPDATE', 'row is locked for the update');
    });

    test('an already-processed order is not credited again', async () => {
        const queries = fakeDbForVerify(510);
        sandbox.stub(Transaction, 'findOne', async () => fakeInstance({ status: 'success', userId: 42, amount: 500 }));
        const res = await request(app).post('/auth/payment/verify').set('Authorization', auth).send(paymentBody());
        assert.equal(res.status, 200);
        assert.equal(res.body.message, 'Payment already processed');
        assert.equal(queries.length, 0, 'no credit SQL ran');
        assert.equal(published.length, 0);
    });

    test('a valid payment marks the order paid, credits atomically and announces the balance', async () => {
        const queries = fakeDbForVerify(510);
        const order = fakeInstance({ status: 'pending', userId: 42, amount: 500 });
        sandbox.stub(Transaction, 'findOne', async () => order);

        const res = await request(app).post('/auth/payment/verify').set('Authorization', auth).send(paymentBody());

        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { success: true, message: 'Payment verified and credits added', credits: 510 });
        assert.equal(order.status, 'success');
        assert.equal(order.updates[0]?.razorpayPaymentId, 'pay_1');
        const update = queries.find(([sql]) => String(sql).startsWith('UPDATE'));
        assert.match(String(update?.[0]), /credits = credits \+ :amount/, 'increment happens in SQL, not read-modify-write');
        assert.deepEqual((update?.[1] as { replacements: object }).replacements, { amount: 500, userId: 42 });
        assert.deepEqual(published[0], ['credit:update', JSON.stringify({ userId: 42, credits: 510 })]);
    });
});

describe('fail payment and history', () => {
    test("marks only the caller's pending order as failed", async () => {
        const updates = sandbox.stub(Transaction, 'update', async () => [1]);
        const res = await request(app).post('/auth/payment/fail').set('Authorization', auth).send({ razorpay_order_id: 'order_1', reason: 'cancelled' });
        assert.equal(res.status, 200);
        const [values, options] = updates[0] as [{ status: string; description: string }, { where: object }];
        assert.equal(values.status, 'failed');
        assert.equal(values.description, 'cancelled');
        assert.deepEqual(options.where, { razorpayOrderId: 'order_1', userId: 42, status: 'pending' });
    });

    test("someone else's or unknown order is 404", async () => {
        sandbox.stub(Transaction, 'update', async () => [0]);
        sandbox.stub(Transaction, 'findOne', async () => null);
        const res = await request(app).post('/auth/payment/fail').set('Authorization', auth).send({ razorpay_order_id: 'order_x' });
        assert.equal(res.status, 404);
    });

    test('a successful payment cannot be marked failed', async () => {
        sandbox.stub(Transaction, 'update', async () => [0]);
        sandbox.stub(Transaction, 'findOne', async () => fakeInstance({ status: 'success' }));
        const res = await request(app).post('/auth/payment/fail').set('Authorization', auth).send({ razorpay_order_id: 'order_1' });
        assert.equal(res.status, 400);
    });

    test('long reasons are truncated to the column size', async () => {
        const updates = sandbox.stub(Transaction, 'update', async () => [1]);
        await request(app).post('/auth/payment/fail').set('Authorization', auth).send({ razorpay_order_id: 'order_1', reason: 'x'.repeat(255) });
        assert.equal((updates[0]?.[0] as { description: string }).description.length, 255);
    });

    test('history is scoped to the caller, newest first', async () => {
        const queries = sandbox.stub(Transaction, 'findAll', async () => []);
        const res = await request(app).get('/auth/payment/transactions').set('Authorization', auth);
        assert.equal(res.status, 200);
        assert.deepEqual(queries[0]?.[0], { where: { userId: 42 }, order: [['createdAt', 'DESC']] });
    });
});
