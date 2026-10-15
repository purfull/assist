import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { type KeyObject } from 'crypto';
import http, { type Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import * as sharedAuth from '../src';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-kid';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' };

const sign = (payload: object, { kid = KID, key = privateKey }: { kid?: string; key?: KeyObject } = {}) =>
    jwt.sign(payload, key, { algorithm: 'RS256', keyid: kid, issuer: 'ai-search-auth', audience: 'ai-search', expiresIn: '5m' });

let jwksServer: Server;
let jwksRequests = 0;
let jwksStatus = 200;
const app = express();
app.get('/protected', sharedAuth.authenticate, sharedAuth.requireVerified, (req, res) => { res.json(req.user); });

before(async () => {
    jwksServer = http.createServer((_req, res) => {
        jwksRequests++;
        res.statusCode = jwksStatus;
        res.setHeader('Content-Type', 'application/json');
        res.end(jwksStatus === 200 ? JSON.stringify({ keys: [jwk] }) : '{}');
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
});
after(() => jwksServer.close());

beforeEach(() => {
    jwksStatus = 200;
    sharedAuth._resetKeyCache();
    process.env.JWT_JWKS_URL = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}/jwks`;
    delete process.env.JWT_PUBLIC_KEY;
});

const call = (token: string) => request(app).get('/protected').set('Authorization', `Bearer ${token}`);

test('JWKS: accepts a verified access token', async () => {
    const res = await call(sign({ typ: 'access', userId: 5, email: 'a@b.co', isVerified: true }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { userId: 5, email: 'a@b.co', isVerified: true });
});

test('JWKS: keys are cached between requests', async () => {
    const start = jwksRequests;
    await call(sign({ typ: 'access', userId: 5, isVerified: true }));
    await call(sign({ typ: 'access', userId: 5, isVerified: true }));
    assert.equal(jwksRequests - start, 1);
});

test('JWKS: unknown key id is rejected', async () => {
    const res = await call(sign({ typ: 'access', userId: 5, isVerified: true }, { kid: 'other' }));
    assert.equal(res.status, 401);
});

test('JWKS: token signed by a different key is rejected', async () => {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const res = await call(sign({ typ: 'access', userId: 5, isVerified: true }, { key: other }));
    assert.equal(res.status, 401);
});

test('refresh and reset tokens are rejected', async () => {
    assert.equal((await call(sign({ typ: 'refresh', userId: 5 }))).status, 401);
    assert.equal((await call(sign({ typ: 'reset', userId: 5 }))).status, 401);
});

test('tokens without a numeric userId are rejected', async () => {
    assert.equal((await call(sign({ typ: 'access', userId: '5', isVerified: true }))).status, 401);
});

test('unverified users are blocked by requireVerified', async () => {
    assert.equal((await call(sign({ typ: 'access', userId: 5, isVerified: false }))).status, 403);
});

test('static PEM mode works without JWKS', async () => {
    delete process.env.JWT_JWKS_URL;
    process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const res = await call(sign({ typ: 'access', userId: 9, isVerified: true }));
    assert.equal(res.status, 200);
    assert.equal(res.body.userId, 9);
});

test('missing token is 401', async () => {
    assert.equal((await request(app).get('/protected')).status, 401);
});

test('a token can be passed as ?token= (SSE and downloads)', async () => {
    const token = sign({ typ: 'access', userId: 5, isVerified: true });
    assert.equal((await request(app).get(`/protected?token=${token}`)).status, 200);
});

test('expired tokens get the session-expired message', async () => {
    const expired = jwt.sign({ typ: 'access', userId: 5, isVerified: true, exp: Math.floor(Date.now() / 1000) - 60 }, privateKey, {
        algorithm: 'RS256', keyid: KID, issuer: 'ai-search-auth', audience: 'ai-search',
    });
    const res = await call(expired);
    assert.equal(res.status, 401);
    assert.match(res.body.error as string, /expired/i);
});

test('wrong issuer or audience is rejected', async () => {
    const wrongAudience = jwt.sign({ typ: 'access', userId: 5 }, privateKey, { algorithm: 'RS256', keyid: KID, issuer: 'ai-search-auth', audience: 'other' });
    const wrongIssuer = jwt.sign({ typ: 'access', userId: 5 }, privateKey, { algorithm: 'RS256', keyid: KID, issuer: 'someone-else', audience: 'ai-search' });
    assert.equal((await call(wrongAudience)).status, 401);
    assert.equal((await call(wrongIssuer)).status, 401);
});

test('JWKS outage: tokens are rejected when no keys were ever fetched', async () => {
    jwksStatus = 503;
    assert.equal((await call(sign({ typ: 'access', userId: 5, isVerified: true }))).status, 401);
});

test('JWKS outage: already-fetched keys keep working', async () => {
    const token = sign({ typ: 'access', userId: 5, isVerified: true });
    assert.equal((await call(token)).status, 200); // keys cached
    jwksStatus = 503;
    // An unknown kid forces a refetch attempt (which fails); known keys still verify
    assert.equal((await call(sign({ typ: 'access', userId: 5 }, { kid: 'rotated' }))).status, 401);
    assert.equal((await call(token)).status, 200);
});

test('no key configured at all is a 500 configuration error', async () => {
    delete process.env.JWT_JWKS_URL;
    delete process.env.JWT_PUBLIC_KEY;
    const previousPath = process.env.JWT_PUBLIC_KEY_PATH;
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // disables the local dev key fallback
    try {
        assert.equal((await call(sign({ typ: 'access', userId: 5 }))).status, 500);
    } finally {
        process.env.NODE_ENV = previousEnv;
        if (previousPath !== undefined) process.env.JWT_PUBLIC_KEY_PATH = previousPath;
    }
});
