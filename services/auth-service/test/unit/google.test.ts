/**
 * Google OAuth: the passport strategy's find/link/create logic, the callback that starts a
 * session and issues a one-time code, and the code exchange.
 */
import '../helpers/env';
import { stubRedis } from '../helpers/useStubRedis';
import '../helpers/captureMail';
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Application } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Profile } from 'passport-google-oauth20';
import User from '../../src/modules/identity/models/User';
import RefreshToken from '../../src/modules/identity/models/RefreshToken';
import passport from '../../src/modules/identity/passport';
import { googleCallback } from '../../src/modules/identity/controller';
import * as tokens from '../../src/modules/identity/utils/jwtUtils';
import type { AuthUser } from '../../src/modules/identity/types';
import { createApp } from '../../src/app';
import { createSandbox } from '../helpers/stub';
import { fakeInstance, fakeUser } from '../helpers/fakes';

const sandbox = createSandbox();
afterEach(() => sandbox.restore());
beforeEach(() => {
    stubRedis.store.clear();
    stubRedis.resetRateLimits();
});

type VerifyResult = { err: unknown; user: AuthUser | false | undefined };

/** Run the registered Google strategy's verify callback with a fake profile. */
const runStrategy = (profile: Partial<Profile>): Promise<VerifyResult> => {
    const strategy = (passport as unknown as { _strategy(name: string): { _verify: (...args: unknown[]) => void } })._strategy('google');
    return new Promise((resolve) => {
        strategy._verify('access', 'refresh', { id: 'google-123', ...profile }, (err: unknown, user?: AuthUser | false) => resolve({ err, user }));
    });
};

describe('Google strategy', () => {
    test('an already-linked account signs in', async () => {
        sandbox.stub(User, 'findOne', async () => fakeUser({ googleId: 'google-123' }));
        const { err, user } = await runStrategy({ emails: [{ value: 'user@example.com', verified: true }] });
        assert.equal(err, null);
        assert.deepEqual(user, { userId: 42, email: 'user@example.com', isVerified: true });
    });

    test('an existing email account gets linked and marked verified', async () => {
        const existing = fakeUser({ isVerified: false });
        let call = 0;
        sandbox.stub(User, 'findOne', async () => (++call === 1 ? null : existing));
        const { user } = await runStrategy({ emails: [{ value: 'user@example.com', verified: true }] });
        assert.equal(existing.googleId, 'google-123');
        assert.equal(existing.isVerified, true);
        assert.equal(existing.saved, 1);
        assert.equal((user as AuthUser).userId, 42);
    });

    test('a new Google user is created without a password', async () => {
        sandbox.stub(User, 'findOne', async () => null);
        const created = sandbox.stub(User, 'create', async (v: object) => fakeUser({ ...v, id: 77 }));
        const { user } = await runStrategy({ emails: [{ value: 'new@example.com', verified: true }] });
        assert.deepEqual(created[0]?.[0], { email: 'new@example.com', googleId: 'google-123', isVerified: true, password: null });
        assert.equal((user as AuthUser).userId, 77);
    });

    test('a Google account without an email is refused, not crashed on', async () => {
        sandbox.stub(User, 'findOne', async () => null);
        const { err, user } = await runStrategy({ emails: [] });
        assert.equal(err, null);
        assert.equal(user, false);
    });

    test('database errors are passed to passport', async () => {
        sandbox.stub(User, 'findOne', async () => { throw new Error('db down'); });
        const { err } = await runStrategy({ emails: [{ value: 'user@example.com', verified: true }] });
        assert.match((err as Error).message, /db down/);
    });
});

describe('Google callback', () => {
    let callbackApp: Application;
    before(() => {
        // Mount the callback behind a stand-in for passport that sets req.user
        callbackApp = express();
        callbackApp.use(cookieParser());
        callbackApp.use((req, _res, next) => {
            req.log = { error: () => undefined } as unknown as typeof req.log;
            req.user = { userId: 42, email: 'user@example.com', isVerified: true };
            next();
        });
        callbackApp.get('/callback', googleCallback);
    });

    test('starts a session and redirects with a one-time code, never the token', async () => {
        const user = fakeUser();
        sandbox.stub(User, 'findByPk', async () => user);
        const sessions = sandbox.stub(RefreshToken, 'create', async (v: object) => fakeInstance(v));

        const res = await request(callbackApp).get('/callback');

        assert.equal(res.status, 302);
        const location = res.headers.location ?? '';
        const code = /\/auth\/callback\?code=([a-f0-9]{64})$/.exec(location)?.[1];
        assert.ok(code, `redirect carries a code: ${location}`);
        assert.doesNotMatch(location, /eyJ/, 'no JWT in the URL');
        assert.equal(stubRedis.store.get(`oauth_code:${code}`), '42');
        assert.equal(sessions.length, 1);
        assert.ok(user.trialEndsAt, 'trial granted on first Google sign-in');
    });

    test('redirects to the error page when the user is gone', async () => {
        sandbox.stub(User, 'findByPk', async () => null);
        const res = await request(callbackApp).get('/callback');
        assert.equal(res.status, 302);
        assert.match(res.headers.location ?? '', /\/auth\/error$/);
    });
});

describe('code exchange', () => {
    let app: Application;
    before(() => {
        app = createApp();
    });
    const code = 'a'.repeat(64);

    test('a valid code returns an access token once', async () => {
        stubRedis.store.set(`oauth_code:${code}`, '42');
        sandbox.stub(User, 'findByPk', async () => fakeUser());

        const first = await request(app).post('/auth/google/exchange').send({ code });
        assert.equal(first.status, 200);
        assert.equal(tokens.verifyAccessToken(first.body.accessToken as string).userId, 42);

        const second = await request(app).post('/auth/google/exchange').send({ code });
        assert.equal(second.status, 400, 'code is single-use');
    });

    test('malformed or unknown codes are rejected', async () => {
        for (const body of [{}, { code: 'short' }, { code: 123 }, { code: 'b'.repeat(64) }]) {
            const res = await request(app).post('/auth/google/exchange').send(body);
            assert.equal(res.status, 400, JSON.stringify(body));
        }
    });

    test('a code for a deleted user is 404', async () => {
        stubRedis.store.set(`oauth_code:${code}`, '42');
        sandbox.stub(User, 'findByPk', async () => null);
        assert.equal((await request(app).post('/auth/google/exchange').send({ code })).status, 404);
    });
});
