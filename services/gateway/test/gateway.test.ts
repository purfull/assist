import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Application } from 'express';
import request from 'supertest';
import * as platform from '@ai-search/platform';
import { loadConfig } from '../src/config';
import { createApp } from '../src/app';

let upstream: Server;
let app: Application;

before(async () => {
    // Fake auth service that echoes what it received
    upstream = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ url: req.url, headers: req.headers }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

    const config = loadConfig({
        NODE_ENV: 'test',
        AUTH_SERVICE_URL: upstreamUrl,
        FILE_UPLOAD_SERVICE_URL: 'http://127.0.0.1:1', // nothing listens here
        ALLOWED_ORIGINS: 'http://app.example',
    });
    app = createApp(config, platform.createLogger('gateway-test'));
});

after(() => upstream.close());

test('health is served by the gateway itself', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
});

test('proxies /auth with path, request id and forwarded client IP', async () => {
    const res = await request(app).get('/auth/me').set('X-Request-Id', 'req-123');
    assert.equal(res.status, 200);
    assert.equal(res.body.url, '/auth/me');
    assert.equal(res.body.headers['x-request-id'], 'req-123');
    assert.ok(res.body.headers['x-forwarded-for'], 'X-Forwarded-For is set');
    assert.equal(res.headers['x-request-id'], 'req-123');
});

test('generates a request id when the client sends none', async () => {
    const res = await request(app).get('/auth/me');
    assert.match(res.body.headers['x-request-id'] as string, /^[0-9a-f-]{36}$/);
});

test('proxies /tickets to the auth service', async () => {
    const res = await request(app).get('/tickets/abc');
    assert.equal(res.status, 200);
    assert.equal(res.body.url, '/tickets/abc');
});

test('CORS allows configured origins only', async () => {
    const ok = await request(app).get('/health').set('Origin', 'http://app.example');
    assert.equal(ok.headers['access-control-allow-origin'], 'http://app.example');
    const blocked = await request(app).get('/health').set('Origin', 'http://evil.example');
    assert.equal(blocked.headers['access-control-allow-origin'], undefined);
});

test('sets security headers', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-powered-by'], undefined);
});

test('returns JSON 502 when an upstream service is down', async () => {
    const res = await request(app).get('/files');
    assert.equal(res.status, 502);
    assert.deepEqual(res.body, { error: 'Service temporarily unavailable' });
});

test('unknown routes get a JSON 404', async () => {
    const res = await request(app).get('/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Route not found');
});

test('invalid configuration fails fast', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /AUTH_SERVICE_URL/);
});

test('a slow upstream gets a JSON 504 after PROXY_TIMEOUT_MS', async () => {
    const slow = http.createServer(() => { /* never responds */ });
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    try {
        const config = loadConfig({
            NODE_ENV: 'test',
            AUTH_SERVICE_URL: `http://127.0.0.1:${(slow.address() as AddressInfo).port}`,
            FILE_UPLOAD_SERVICE_URL: 'http://127.0.0.1:1',
            ALLOWED_ORIGINS: 'http://app.example',
            PROXY_TIMEOUT_MS: '200',
        });
        const res = await request(createApp(config, platform.createLogger('gateway-test'))).get('/auth/me');
        assert.equal(res.status, 504);
        assert.deepEqual(res.body, { error: 'Service temporarily unavailable' });
    } finally {
        slow.closeAllConnections();
        slow.close();
    }
});

test('the edge rate limit returns 429 but never limits health checks', async () => {
    const config = loadConfig({
        NODE_ENV: 'test',
        AUTH_SERVICE_URL: 'http://127.0.0.1:1',
        FILE_UPLOAD_SERVICE_URL: 'http://127.0.0.1:1',
        ALLOWED_ORIGINS: 'http://app.example',
        RATE_LIMIT_PER_MINUTE: '2',
    });
    const limited = createApp(config, platform.createLogger('gateway-test'));
    await request(limited).get('/nope');
    await request(limited).get('/nope');
    const third = await request(limited).get('/nope');
    assert.equal(third.status, 429);
    assert.equal((await request(limited).get('/health')).status, 200);
});
