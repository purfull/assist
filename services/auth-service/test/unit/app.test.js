/**
 * HTTP-level tests of the assembled app with Redis stubbed and DB lookups faked.
 * Covers routing, auth, validation and error handling — not database behaviour
 * (see test/integration for that).
 */
require('../helpers/env');
const { installStubRedis } = require('../helpers/stubRedis');
installStubRedis();
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { sequelize } = require('../../src/shared/config/database');
const User = require('../../src/modules/identity/models/User');
const tokens = require('../../src/modules/identity/utils/jwtUtils');
const { createApp } = require('../../src/app');

let app;
let auth;

before(() => {
    // No database in unit tests
    sequelize.authenticate = async () => {};
    User.findByPk = async (id) => ({ id: Number(id), email: 'user@example.com', isVerified: true });
    app = createApp();
    auth = `Bearer ${tokens.generateAccessToken({ userId: 42, email: 'user@example.com', isVerified: true })}`;
});

test('liveness and readiness', async () => {
    assert.equal((await request(app).get('/health')).status, 200);
    const ready = await request(app).get('/health/ready');
    assert.equal(ready.status, 200);
    assert.deepEqual(ready.body.checks, { mysql: 'ok', redis: 'ok' });
});

test('readiness reports a failing dependency with 503', async () => {
    const original = sequelize.authenticate;
    sequelize.authenticate = async () => { throw new Error('db down'); };
    try {
        const res = await request(app).get('/health/ready');
        assert.equal(res.status, 503);
        assert.match(res.body.checks.mysql, /db down/);
    } finally {
        sequelize.authenticate = original;
    }
});

test('echoes the request id from the gateway', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'abc-123');
    assert.equal(res.headers['x-request-id'], 'abc-123');
});

test('JWKS verifies tokens this service issues', async () => {
    const res = await request(app).get('/auth/.well-known/jwks.json');
    assert.equal(res.status, 200);
    const key = require('crypto').createPublicKey({ key: res.body.keys[0], format: 'jwk' });
    assert.equal(jwt.verify(auth.slice(7), key, { algorithms: ['RS256'] }).userId, 42);
});

test('every module is mounted behind authentication', async () => {
    for (const [method, path] of [
        ['get', '/auth/me'],
        ['post', '/auth/payment/order'],
        ['get', '/auth/notifications'],
        ['get', '/auth/credits/stream'],
        ['get', '/tickets'],
    ]) {
        assert.equal((await request(app)[method](path)).status, 401, `${method.toUpperCase()} ${path}`);
    }
});

test('a refresh token cannot be used as an access token', async () => {
    const refresh = tokens.generateRefreshToken({ userId: 42 });
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${refresh}`);
    assert.equal(res.status, 401);
});

test('creating notifications is internal-only', async () => {
    const body = { userId: 1, message: 'hi' };
    assert.equal((await request(app).post('/auth/notifications').set('Authorization', auth).send(body)).status, 403);
    assert.equal((await request(app).post('/auth/notifications').set('X-Internal-Token', 'wrong').send(body)).status, 403);
});

test('resend-otp only needs an email', async () => {
    const res = await request(app).post('/auth/resend-otp').send({});
    assert.equal(res.status, 400);
    assert.ok(res.body.errors.some((e) => e.path === 'email'));
    assert.ok(!res.body.errors.some((e) => e.path === 'otp'));
});

test('validation rejects bad payment, ticket, profile and notification input', async () => {
    const cases = [
        ['post', '/auth/payment/order', { amount: 10.5 }, 'amount'],
        ['post', '/auth/payment/verify', { razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 'nothex' }, 'razorpay_signature'],
        ['post', '/auth/payment/fail', {}, 'razorpay_order_id'],
        ['post', '/tickets', { subject: '', message: 'x' }, 'subject'],
        ['post', '/tickets', { subject: 's', message: 'x', priority: 'Urgent' }, 'priority'],
        ['get', '/tickets/not-a-uuid', undefined, 'id'],
        ['post', '/tickets/not-a-uuid/reply', { message: 'x' }, 'id'],
        ['put', '/auth/profile', { name: 'x'.repeat(101) }, 'name'],
        ['post', '/auth/billing-details', { taxId: 123 }, 'taxId'],
        ['put', '/auth/notifications/abc/read', undefined, 'id'],
    ];
    for (const [method, path, body, field] of cases) {
        const res = await request(app)[method](path).set('Authorization', auth).send(body);
        assert.equal(res.status, 400, `${method.toUpperCase()} ${path}`);
        assert.ok(res.body.errors.some((e) => e.path === field), `${path} should flag ${field}`);
    }
});

test('unknown routes return JSON 404', async () => {
    const res = await request(app).get('/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Route not found');
});

test('malformed JSON is a client error with a JSON body', async () => {
    const res = await request(app).post('/auth/signup').set('Content-Type', 'application/json').send('{"broken');
    assert.equal(res.status, 400);
    assert.equal(typeof res.body.error, 'string');
});
