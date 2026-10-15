import { test } from 'node:test';
import assert from 'node:assert/strict';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import * as platform from '../src';

const logger = platform.createLogger('platform-test');

const appWith = (handler: RequestHandler) => {
    const app = express();
    app.use(platform.requestLogger(logger));
    app.get('/boom', handler);
    app.use(platform.notFoundHandler);
    app.use(platform.errorHandler(logger));
    return app;
};

test('server errors return a generic message', async () => {
    const res = await request(appWith(() => { throw new Error('SELECT password FROM users'); })).get('/boom');
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'Internal server error' });
});

test('client errors keep their status and message', async () => {
    const res = await request(appWith((_req, _res, next) => next(new platform.HttpError(422, 'Bad thing')))).get('/boom');
    assert.equal(res.status, 422);
    assert.deepEqual(res.body, { error: 'Bad thing' });
});

test('request ids: reuse a valid incoming id, replace an invalid one', async () => {
    const app = appWith((req, res) => { res.json({ id: req.id }); });
    const kept = await request(app).get('/boom').set('X-Request-Id', 'req_1-a');
    assert.equal(kept.body.id, 'req_1-a');
    assert.equal(kept.headers['x-request-id'], 'req_1-a');
    const replaced = await request(app).get('/boom').set('X-Request-Id', '<script>alert(1)</script>');
    assert.match(replaced.body.id as string, /^[0-9a-f-]{36}$/);
});

test('readiness runs every check and reports failures', async () => {
    const app = express();
    platform.healthRoutes(app, {
        fast: async () => undefined,
        broken: async () => { throw new Error('nope'); },
    }, { service: 't' });
    const res = await request(app).get('/health/ready');
    assert.equal(res.status, 503);
    assert.deepEqual(res.body.checks, { fast: 'ok', broken: 'error: nope' });
});
