require('../helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const tokens = require('../../src/modules/identity/utils/jwtUtils');

const throws = (fn) => assert.throws(fn, /Session expired/);

test('each token type verifies only as itself', () => {
    const access = tokens.generateAccessToken({ userId: 1, email: 'a@b.co', isVerified: true });
    const refresh = tokens.generateRefreshToken({ userId: 1 });
    const { token: reset, jti } = tokens.generateResetToken({ userId: 1 });

    assert.equal(tokens.verifyAccessToken(access).userId, 1);
    assert.equal(tokens.verifyRefreshToken(refresh).userId, 1);
    assert.equal(tokens.verifyResetToken(reset).jti, jti);

    throws(() => tokens.verifyAccessToken(refresh));
    throws(() => tokens.verifyAccessToken(reset));
    throws(() => tokens.verifyRefreshToken(access));
    throws(() => tokens.verifyResetToken(access));
});

test('access tokens carry isVerified, issuer, audience and key id', () => {
    const access = tokens.generateAccessToken({ userId: 7, email: 'a@b.co', isVerified: true });
    const { header, payload } = jwt.decode(access, { complete: true });
    assert.equal(payload.isVerified, true);
    assert.equal(payload.iss, 'ai-search-auth');
    assert.equal(payload.aud, 'ai-search');
    assert.equal(header.kid, tokens.getJwks().keys[0].kid);
});

test('refresh tokens issued in the same second are unique', () => {
    assert.notEqual(tokens.generateRefreshToken({ userId: 1 }), tokens.generateRefreshToken({ userId: 1 }));
});

test('tokens without the new claims are rejected', () => {
    const fs = require('fs');
    const legacy = jwt.sign({ userId: 1 }, fs.readFileSync(process.env.JWT_PRIVATE_KEY_PATH), { algorithm: 'RS256' });
    throws(() => tokens.verifyAccessToken(legacy));
});

test('JWKS publishes a usable RSA signing key', () => {
    const { keys } = tokens.getJwks();
    assert.equal(keys.length, 1);
    assert.equal(keys[0].kty, 'RSA');
    assert.equal(keys[0].alg, 'RS256');
    assert.ok(!('d' in keys[0]), 'private exponent must never be published');
});
