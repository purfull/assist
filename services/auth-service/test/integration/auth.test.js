require('../helpers/env');
const it = require('../helpers/integration');
const { test, before, after } = require('node:test');

if (!it.enabled) {
    test('auth integration tests (set INTEGRATION=1 with MySQL and Redis running)', { skip: true }, () => {});
    return;
}

it.installMailCapture();
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const { sequelize } = require('../../src/shared/config/database');
const redis = require('../../src/shared/config/redis');
const events = require('../../src/shared/events');
const { createApp } = require('../../src/app');

let app;

before(async () => {
    await it.resetDatabase(sequelize);
    await it.migrate();
    await it.clearRateLimits(redis);
    app = createApp();
});

after(async () => {
    await events.close();
    await redis.quit();
    await sequelize.close();
});

test('migrations are idempotent', async () => {
    const applied = await it.migrate();
    assert.deepEqual(applied, []);
    const tables = await sequelize.getQueryInterface().showAllTables();
    for (const t of ['users', 'refresh_tokens', 'transactions', 'tickets', 'notifications']) {
        assert.ok(tables.includes(t), `${t} exists`);
    }
});

const signUpVerified = async (agent, email, password = 'Passw0rd!') => {
    const signup = await agent.post('/auth/signup').send({ email, password, name: 'Test' });
    assert.equal(signup.status, 201, JSON.stringify(signup.body));
    const otp = it.lastEmailTo(email).text.match(/(\d{6})/)[1];
    const verify = await agent.post('/auth/verify-otp').send({ email, otp });
    assert.equal(verify.status, 200, JSON.stringify(verify.body));
    return verify.body;
};

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
    const [[row]] = await sequelize.query('SELECT token FROM refresh_tokens WHERE userId = ?', { replacements: [user.id] });
    assert.match(row.token, /^[0-9a-f]{64}$/);

    assert.equal((await agent.post('/auth/logout')).status, 200);
    assert.equal((await agent.post('/auth/refresh-token')).status, 401, 'session revoked');
});

test('a password reset link works exactly once', async () => {
    await it.clearRateLimits(redis);
    const agent = request.agent(app);
    const email = `reset-${Date.now()}@example.com`;
    await signUpVerified(agent, email);

    assert.equal((await agent.post('/auth/forgot-password').send({ email })).status, 200);
    const token = decodeURIComponent(it.lastEmailTo(email).text.match(/token=([^\s]+)/)[1]);

    const first = await agent.post('/auth/reset-password').send({ token, newPassword: 'NewPassw0rd!' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const second = await agent.post('/auth/reset-password').send({ token, newPassword: 'OtherPassw0rd!' });
    assert.equal(second.status, 400);

    const signin = await agent.post('/auth/signin').send({ email, password: 'NewPassw0rd!' });
    assert.equal(signin.status, 200);
});

test('concurrent payment verifications credit the user exactly once', async () => {
    const User = require('../../src/modules/identity/models/User');
    const Transaction = require('../../src/modules/billing/models/Transaction');
    const tokens = require('../../src/modules/identity/utils/jwtUtils');

    const user = await User.create({ email: `pay-${Date.now()}@example.com`, isVerified: true, credits: 10 });
    const orderId = `order_${crypto.randomUUID()}`;
    await Transaction.create({ userId: user.id, amount: 500, status: 'pending', razorpayOrderId: orderId });

    const paymentId = `pay_${crypto.randomUUID()}`;
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${orderId}|${paymentId}`).digest('hex');
    const auth = `Bearer ${tokens.generateAccessToken({ userId: user.id, email: user.email, isVerified: true })}`;
    const body = { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature };

    const results = await Promise.all(Array.from({ length: 5 }, () =>
        request(app).post('/auth/payment/verify').set('Authorization', auth).send(body)));

    assert.ok(results.every((r) => r.status === 200), results.map((r) => r.status).join(','));
    assert.equal(results.filter((r) => r.body.success === true).length, 1, 'exactly one request applied the credit');
    await user.reload();
    assert.equal(user.credits, 510);

    // Someone else cannot verify or fail this order
    const other = await User.create({ email: `other-${Date.now()}@example.com`, isVerified: true });
    const otherAuth = `Bearer ${tokens.generateAccessToken({ userId: other.id, email: other.email, isVerified: true })}`;
    assert.equal((await request(app).post('/auth/payment/fail').set('Authorization', otherAuth).send({ razorpay_order_id: orderId })).status, 404);
});

test('tickets are private to their owner', async () => {
    const User = require('../../src/modules/identity/models/User');
    const tokens = require('../../src/modules/identity/utils/jwtUtils');
    const bearer = (u) => `Bearer ${tokens.generateAccessToken({ userId: u.id, email: u.email, isVerified: true })}`;
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
