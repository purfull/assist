/**
 * Support tickets with the database faked: creation, owner-only reads and replies.
 */
import '../helpers/env';
import { stubRedis } from '../helpers/useStubRedis';
import '../helpers/captureMail';
import '../helpers/fakeRazorpay';
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Application } from 'express';
import request from 'supertest';
import Ticket, { type TicketReply } from '../../src/modules/support/models/Ticket';
import { createApp } from '../../src/app';
import { createSandbox } from '../helpers/stub';
import { fakeInstance, fakeUser } from '../helpers/fakes';
import { signInAs } from '../helpers/auth';

const sandbox = createSandbox();
const TICKET_ID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
let app: Application;
let auth: string;

before(() => {
    app = createApp();
});
beforeEach(() => {
    stubRedis.resetRateLimits();
    auth = signInAs(sandbox, fakeUser());
});
afterEach(() => sandbox.restore());

test('creating a ticket stores the first message as a reply from the caller', async () => {
    const created = sandbox.stub(Ticket, 'create', async (v: object) => fakeInstance({ id: TICKET_ID, ...v }));
    const res = await request(app).post('/tickets').set('Authorization', auth).send({ subject: 'Help', message: 'It broke' });
    assert.equal(res.status, 201);
    const values = created[0]?.[0] as { userId: number; priority: string; replies: TicketReply[] };
    assert.equal(values.userId, 42);
    assert.equal(values.priority, 'Medium', 'defaults to Medium');
    assert.equal(values.replies.length, 1);
    assert.equal(values.replies[0]?.senderId, 42);
    assert.equal(values.replies[0]?.message, 'It broke');
});

test("lists only the caller's tickets", async () => {
    const queries = sandbox.stub(Ticket, 'findAll', async () => []);
    await request(app).get('/tickets').set('Authorization', auth);
    assert.deepEqual((queries[0]?.[0] as { where: object }).where, { userId: 42 });
});

test("reading someone else's ticket is 404", async () => {
    const lookups = sandbox.stub(Ticket, 'findOne', async () => null);
    const res = await request(app).get(`/tickets/${TICKET_ID}`).set('Authorization', auth);
    assert.equal(res.status, 404);
    assert.deepEqual((lookups[0]?.[0] as { where: object }).where, { id: TICKET_ID, userId: 42 });
});

test("replying to someone else's ticket is 404", async () => {
    sandbox.stub(Ticket, 'findOne', async () => null);
    const res = await request(app).post(`/tickets/${TICKET_ID}/reply`).set('Authorization', auth).send({ message: 'hi' });
    assert.equal(res.status, 404);
});

test('a reply is appended and saved', async () => {
    const existing: TicketReply = { id: 'r1', senderId: 42, senderModel: 'User', message: 'first', createdAt: new Date().toISOString() };
    const ticket = fakeInstance({ id: TICKET_ID, userId: 42, replies: [existing] });
    sandbox.stub(Ticket, 'findOne', async () => ticket);
    const res = await request(app).post(`/tickets/${TICKET_ID}/reply`).set('Authorization', auth).send({ message: 'second' });
    assert.equal(res.status, 200);
    assert.deepEqual(ticket.replies.map((r) => r.message), ['first', 'second']);
    assert.equal(ticket.saved, 1);
});

test('database errors become a generic 500', async () => {
    sandbox.stub(Ticket, 'findAll', async () => { throw new Error('ER_LOCK_DEADLOCK internal'); });
    const res = await request(app).get('/tickets').set('Authorization', auth);
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /ER_LOCK/);
});
