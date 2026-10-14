const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const request = require('supertest');
const platform = require('@ai-search/platform');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

let upstream;
let upstreamUrl;
let app;

before(async () => {
    // Fake auth service that echoes what it received
    upstream = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ url: req.url, headers: req.headers }));
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

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
    assert.match(res.body.headers['x-request-id'], /^[0-9a-f-]{36}$/);
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
