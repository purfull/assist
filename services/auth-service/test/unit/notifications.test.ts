/**
 * Notifications: listing and marking read (owner only), internal creation, and the SSE
 * stream pushing balance and notification events.
 */
import '../helpers/env';
import { stubRedis } from '../helpers/useStubRedis';
import '../helpers/captureMail';
import '../helpers/fakeRazorpay';
import { test, describe, before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http, { type Server } from 'http';
import type { AddressInfo } from 'net';
import type { Application } from 'express';
import request from 'supertest';
import { sequelize } from '../../src/shared/config/database';
import Notification from '../../src/modules/notifications/models/Notification';
import { createApp } from '../../src/app';
import { createSandbox } from '../helpers/stub';
import { fakeInstance, fakeUser } from '../helpers/fakes';
import { signInAs } from '../helpers/auth';

const sandbox = createSandbox();
const INTERNAL = process.env.INTERNAL_SERVICE_TOKEN ?? '';
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

describe('notifications API', () => {
    test("lists only the caller's notifications, newest first", async () => {
        const queries = sandbox.stub(Notification, 'findAll', async () => []);
        const res = await request(app).get('/auth/notifications').set('Authorization', auth);
        assert.equal(res.status, 200);
        assert.deepEqual(queries[0]?.[0], { where: { userId: 42 }, order: [['createdAt', 'DESC']] });
    });

    test("marking someone else's notification as read is 404", async () => {
        const lookups = sandbox.stub(Notification, 'findOne', async () => null);
        const res = await request(app).put('/auth/notifications/9/read').set('Authorization', auth);
        assert.equal(res.status, 404);
        assert.deepEqual((lookups[0]?.[0] as { where: object }).where, { id: 9, userId: 42 });
    });

    test('marks the caller\'s notification as read', async () => {
        const notification = fakeInstance({ id: 9, userId: 42, isRead: false });
        sandbox.stub(Notification, 'findOne', async () => notification);
        const res = await request(app).put('/auth/notifications/9/read').set('Authorization', auth);
        assert.equal(res.status, 200);
        assert.equal(notification.isRead, true);
        assert.equal(notification.saved, 1);
    });

    test('internal callers create a notification and it is published', async () => {
        sandbox.stub(Notification, 'create', async (v: object) => fakeInstance({ id: 1, ...v }));
        const res = await request(app).post('/auth/notifications').set('X-Internal-Token', INTERNAL).send({ userId: 7, message: 'Hello' });
        assert.equal(res.status, 201);
        assert.equal(published[0]?.[0], 'notification:new');
        assert.equal((JSON.parse(String(published[0]?.[1])) as { userId: number }).userId, 7);
    });

    test('internal creation validates its input', async () => {
        for (const body of [{ userId: '7', message: 'x' }, { userId: 0, message: 'x' }, { userId: 7, message: '   ' }, { userId: 7 }]) {
            const res = await request(app).post('/auth/notifications').set('X-Internal-Token', INTERNAL).send(body);
            assert.equal(res.status, 400, JSON.stringify(body));
        }
    });
});

describe('live stream (SSE)', () => {
    let server: Server;
    let port: number;
    before(async () => {
        server = http.createServer(app);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as AddressInfo).port;
    });
    after(() => {
        server.closeAllConnections();
        server.close();
    });

    /** Open the stream and collect `data:` events until `count` arrive. */
    const openStream = (token: string) => {
        const events: unknown[] = [];
        let waiters: Array<() => void> = [];
        const req = http.get(`http://127.0.0.1:${port}/auth/credits/stream?token=${token}`, (res) => {
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
                for (const line of chunk.split('\n')) {
                    if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
                }
                waiters.forEach((w) => w());
                waiters = [];
            });
        });
        req.on('error', () => undefined);
        const waitFor = async (count: number) => {
            const deadline = Date.now() + 2000;
            while (events.length < count) {
                if (Date.now() > deadline) throw new Error(`expected ${count} events, got ${JSON.stringify(events)}`);
                await new Promise<void>((resolve) => { waiters.push(resolve); setTimeout(resolve, 50); });
            }
            return events;
        };
        return { events, waitFor, close: () => req.destroy() };
    };

    test('sends the current balance, then pushes credit and notification events for that user only', async () => {
        sandbox.stub(sequelize, 'query', async () => [{ credits: 15 }]);
        const token = auth.slice('Bearer '.length);
        const stream = openStream(token);
        try {
            assert.deepEqual(await stream.waitFor(1), [{ credits: 15 }]);

            stubRedis.emitMessage('credit:update', { userId: 99, credits: 1 }); // someone else
            stubRedis.emitMessage('credit:update', { userId: '42', credits: 515 }); // string ids from other services
            stubRedis.emitMessage('notification:new', { userId: 42, notification: { id: 3, message: 'Hi' } });

            const events = await stream.waitFor(3);
            assert.deepEqual(events.slice(1), [{ credits: 515 }, { notification: { id: 3, message: 'Hi' } }]);
        } finally {
            stream.close();
        }
    });

    test('invalid JSON on an event channel is ignored without breaking the stream', async () => {
        sandbox.stub(sequelize, 'query', async () => [{ credits: 1 }]);
        const stream = openStream(auth.slice('Bearer '.length));
        try {
            await stream.waitFor(1);
            stubRedis.subscribers.forEach((sub) => sub.emit('message', 'credit:update', '{not json'));
            stubRedis.emitMessage('credit:update', { userId: 42, credits: 2 });
            assert.deepEqual((await stream.waitFor(2))[1], { credits: 2 });
        } finally {
            stream.close();
        }
    });
});
