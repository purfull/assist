import '../helpers/env';
import fs from 'fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import * as tokens from '../../src/modules/identity/utils/jwtUtils';

const throws = (fn: () => unknown) => assert.throws(fn, /Session expired/);

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
    const decoded = jwt.decode(access, { complete: true });
    assert.ok(decoded);
    const { header } = decoded;
    const payload = decoded.payload as JwtPayload;
    assert.equal(payload.isVerified, true);
    assert.equal(payload.iss, 'ai-search-auth');
    assert.equal(payload.aud, 'ai-search');
    assert.equal(header.kid, tokens.getJwks().keys[0]?.kid);
});

test('refresh tokens issued in the same second are unique', () => {
    assert.notEqual(tokens.generateRefreshToken({ userId: 1 }), tokens.generateRefreshToken({ userId: 1 }));
});

test('tokens without the new claims are rejected', () => {
    const legacy = jwt.sign({ userId: 1 }, fs.readFileSync(process.env.JWT_PRIVATE_KEY_PATH ?? ''), { algorithm: 'RS256' });
    throws(() => tokens.verifyAccessToken(legacy));
});

test('JWKS publishes a usable RSA signing key', () => {
    const { keys } = tokens.getJwks();
    assert.equal(keys.length, 1);
    const [key] = keys;
    assert.ok(key);
    assert.equal(key.kty, 'RSA');
    assert.equal(key.alg, 'RS256');
    assert.ok(!('d' in key), 'private exponent must never be published');
});
