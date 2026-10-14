/**
 * Integration tests against real MySQL + Redis. Run with INTEGRATION=1 (see README);
 * they rebuild the test database from migrations.
 */
import '../helpers/env';
import { lastEmailTo } from '../helpers/captureMail';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Application } from 'express';
import request from 'supertest';
import { QueryTypes } from 'sequelize';
import { enabled } from '../helpers/integration';
import type * as Integration from '../helpers/integration';
import type * as Database from '../../src/shared/config/database';
import type * as RedisModule from '../../src/shared/config/redis';
import type * as Events from '../../src/shared/events';
import type * as Tokens from '../../src/modules/identity/utils/jwtUtils';
import type UserModel from '../../src/modules/identity/models/User';
import type TransactionModel from '../../src/modules/billing/models/Transaction';
import type * as AppModule from '../../src/app';

// App modules are loaded in before() only when the suite runs: importing them opens
// Redis/MySQL connections, which a skipped run must not do.
let helpers: typeof Integration;
let db: typeof Database;
let redisModule: typeof RedisModule;
let events: typeof Events;
let tokens: typeof Tokens;
let User: typeof UserModel;
let Transaction: typeof TransactionModel;

const bearer = (user: UserModel): string =>
    `Bearer ${tokens.generateAccessToken({ userId: user.id, email: user.email, isVerified: true })}`;

// File-level, so it also runs when the suite is skipped: importing the app opens Redis
// connections that would otherwise keep the process alive.
after(async () => {
    if (!db) return;
    await events.close();
    await redisModule.closeRedis(redisModule.default);
    await db.sequelize.close();
});

describe('auth-service integration (MySQL + Redis)', { skip: !enabled && 'set INTEGRATION=1 with MySQL and Redis running' }, () => {
    let app: Application;

    before(async () => {
        /* eslint-disable @typescript-eslint/no-require-imports -- deliberate lazy load, see above */
        helpers = require('../helpers/integration') as typeof Integration;
        db = require('../../src/shared/config/database') as typeof Database;
        redisModule = require('../../src/shared/config/redis') as typeof RedisModule;
        events = require('../../src/shared/events') as typeof Events;
        tokens = require('../../src/modules/identity/utils/jwtUtils') as typeof Tokens;
        User = (require('../../src/modules/identity/models/User') as { default: typeof UserModel }).default;
        Transaction = (require('../../src/modules/billing/models/Transaction') as { default: typeof TransactionModel }).default;
        const { createApp } = require('../../src/app') as typeof AppModule;
        /* eslint-enable @typescript-eslint/no-require-imports */

        await helpers.resetDatabase(db.sequelize);
        await helpers.migrate();
        await helpers.clearRateLimits(redisModule.default);
        app = createApp();
    });

    const signUpVerified = async (agent: ReturnType<typeof request.agent>, email: string, password = 'Passw0rd!') => {
        const signup = await agent.post('/auth/signup').send({ email, password, name: 'Test' });
        assert.equal(signup.status, 201, JSON.stringify(signup.body));
        const otp = lastEmailTo(email)?.text.match(/(\d{6})/)?.[1];
        assert.ok(otp, 'OTP email captured');
        const verify = await agent.post('/auth/verify-otp').send({ email, otp });
        assert.equal(verify.status, 200, JSON.stringify(verify.body));
        return verify.body as { accessToken: string; user: { id: number; isVerified: boolean; trialEndsAt: string | null } };
    };

    test('migrations are idempotent', async () => {
        const applied = await helpers.migrate();
        assert.deepEqual(applied, []);
        const tables: string[] = await db.sequelize.getQueryInterface().showAllTables();
        for (const t of ['users', 'refresh_tokens', 'transactions', 'tickets', 'notifications']) {
            assert.ok(tables.includes(t), `${t} exists`);
        }
    });

    test('signup → verify → me → refresh → logout', async () => {
        const agent = request.agent(app);
        const email = `flow-${Date.now()}@example.com`;
        const { accessToken, user } = await signUpVerified(agent, email);
        assert.equal(user.isVerified, true);
        assert.ok(user.trialEndsAt, 'trial granted on verification');

        const me = await agent.get('/auth/me').set('Authorization', `Bearer ${accessToken}`);
        assert.equal(me.status, 200);
        assert.equal(me.body.user.email, email);

        const refreshed = await agent.post('/auth/refresh-token');
        assert.equal(refreshed.status, 200);
        assert.ok(refreshed.body.accessToken);

        const devices = await agent.get('/auth/devices').set('Authorization', `Bearer ${accessToken}`);
        assert.equal(devices.body.devices.length, 1);

        // Only a hash of the refresh token is stored, never the token itself
        const [row] = await db.sequelize.query<{ token: string }>('SELECT token FROM refresh_tokens WHERE userId = ?', {
            replacements: [user.id],
            type: QueryTypes.SELECT,
        });
        assert.match(row?.token ?? '', /^[0-9a-f]{64}$/);

        assert.equal((await agent.post('/auth/logout')).status, 200);
        assert.equal((await agent.post('/auth/refresh-token')).status, 401, 'session revoked');
    });

    test('a password reset link works exactly once', async () => {
        await helpers.clearRateLimits(redisModule.default);
        const agent = request.agent(app);
        const email = `reset-${Date.now()}@example.com`;
        await signUpVerified(agent, email);

        assert.equal((await agent.post('/auth/forgot-password').send({ email })).status, 200);
        const link = lastEmailTo(email)?.text.match(/token=([^\s]+)/)?.[1];
        assert.ok(link, 'reset email captured');
        const token = decodeURIComponent(link);

        const first = await agent.post('/auth/reset-password').send({ token, newPassword: 'NewPassw0rd!' });
        assert.equal(first.status, 200, JSON.stringify(first.body));
        const second = await agent.post('/auth/reset-password').send({ token, newPassword: 'OtherPassw0rd!' });
        assert.equal(second.status, 400);

        const signin = await agent.post('/auth/signin').send({ email, password: 'NewPassw0rd!' });
        assert.equal(signin.status, 200);
    });

    test('concurrent payment verifications credit the user exactly once', async () => {
        const user = await User.create({ email: `pay-${Date.now()}@example.com`, isVerified: true, credits: 10 });
        const orderId = `order_${crypto.randomUUID()}`;
        await Transaction.create({ userId: user.id, amount: 500, status: 'pending', razorpayOrderId: orderId });

        const paymentId = `pay_${crypto.randomUUID()}`;
        const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET ?? '')
            .update(`${orderId}|${paymentId}`).digest('hex');
        const body = { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature };

        const results = await Promise.all(Array.from({ length: 5 }, () =>
            request(app).post('/auth/payment/verify').set('Authorization', bearer(user)).send(body)));

        assert.ok(results.every((r) => r.status === 200), results.map((r) => r.status).join(','));
        assert.equal(results.filter((r) => r.body.success === true).length, 1, 'exactly one request applied the credit');
        await user.reload();
        assert.equal(user.credits, 510);

        // Someone else cannot fail this order
        const other = await User.create({ email: `other-${Date.now()}@example.com`, isVerified: true });
        const fail = await request(app).post('/auth/payment/fail').set('Authorization', bearer(other)).send({ razorpay_order_id: orderId });
        assert.equal(fail.status, 404);
    });

    test('tickets are private to their owner', async () => {
        const owner = await User.create({ email: `t1-${Date.now()}@example.com`, isVerified: true });
        const stranger = await User.create({ email: `t2-${Date.now()}@example.com`, isVerified: true });

        const created = await request(app).post('/tickets').set('Authorization', bearer(owner))
            .send({ subject: 'Help', message: 'Something broke', priority: 'High' });
        assert.equal(created.status, 201);

        const reply = await request(app).post(`/tickets/${created.body.id}/reply`).set('Authorization', bearer(owner)).send({ message: 'More info' });
        assert.equal(reply.status, 200);
        assert.equal(reply.body.replies.length, 2);

        assert.equal((await request(app).get(`/tickets/${created.body.id}`).set('Authorization', bearer(stranger))).status, 404);
        assert.deepEqual((await request(app).get('/tickets').set('Authorization', bearer(stranger))).body, []);
    });
});
