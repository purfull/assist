/**
 * Identity controllers over HTTP with the database faked: signup, OTP, sign-in, password
 * reset, sessions (refresh/logout/devices) and profile updates.
 */
import '../helpers/env';
import { stubRedis } from '../helpers/useStubRedis';
import { sentEmails, lastEmailTo } from '../helpers/captureMail';
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Application } from 'express';
import request from 'supertest';
import User from '../../src/modules/identity/models/User';
import RefreshToken from '../../src/modules/identity/models/RefreshToken';
import * as tokens from '../../src/modules/identity/utils/jwtUtils';
import { hashPassword, comparePassword } from '../../src/modules/identity/utils/passwordUtils';
import { createApp } from '../../src/app';
import { createSandbox } from '../helpers/stub';
import { fakeInstance, fakeUser } from '../helpers/fakes';
import { signInAs } from '../helpers/auth';

const sandbox = createSandbox();
let app: Application;

before(() => {
    app = createApp();
});

beforeEach(() => {
    stubRedis.store.clear();
    stubRedis.resetRateLimits();
    sentEmails.length = 0;
});

afterEach(() => sandbox.restore());

const whereOf = (call: unknown[] | undefined): Record<string, unknown> =>
    ((call?.[0] as { where?: Record<string, unknown> } | undefined)?.where) ?? {};

const refreshCookieOf = (res: request.Response): string | undefined => {
    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    return cookies?.find((c) => c.startsWith('refreshToken='));
};

describe('signup', () => {
    test('rejects an email that is already registered', async () => {
        sandbox.stub(User, 'findOne', async () => fakeUser());
        const res = await request(app).post('/auth/signup').send({ email: 'user@example.com', password: 'Passw0rd!' });
        assert.equal(res.status, 400);
        assert.equal(res.body.error, 'Email already registered');
    });

    test('creates an unverified user with a hashed password and emails an OTP', async () => {
        sandbox.stub(User, 'findOne', async () => null);
        const created = sandbox.stub(User, 'create', async (values: Record<string, unknown>) => fakeUser({ ...values, id: 7 }));

        const res = await request(app).post('/auth/signup').send({ email: 'new@example.com', password: 'Passw0rd!', name: 'New' });

        assert.equal(res.status, 201);
        assert.equal(res.body.userId, 7);
        const values = created[0]?.[0] as { password: string; isVerified: boolean };
        assert.equal(values.isVerified, false);
        assert.notEqual(values.password, 'Passw0rd!');
        assert.ok(await comparePassword('Passw0rd!', values.password), 'password stored as a bcrypt hash');
        assert.match(stubRedis.store.get('otp:new@example.com') ?? '', /^\d{6}$/);
        assert.match(lastEmailTo('new@example.com')?.text ?? '', /\d{6}/);
    });
});

describe('signin', () => {
    let passwordHash: string;
    before(async () => {
        passwordHash = await hashPassword('Passw0rd!');
    });

    test('unknown email and OAuth-only accounts get the same 401', async () => {
        sandbox.stub(User, 'findOne', async () => null);
        const unknown = await request(app).post('/auth/signin').send({ email: 'nobody@example.com', password: 'Passw0rd!' });
        sandbox.restore();
        sandbox.stub(User, 'findOne', async () => fakeUser({ password: null, googleId: 'g-1' }));
        const oauthOnly = await request(app).post('/auth/signin').send({ email: 'user@example.com', password: 'Passw0rd!' });

        assert.equal(unknown.status, 401);
        assert.equal(oauthOnly.status, 401);
        assert.equal(unknown.body.error, oauthOnly.body.error, 'responses do not reveal which accounts exist');
    });

    test('wrong password is rejected', async () => {
        sandbox.stub(User, 'findOne', async () => fakeUser({ password: passwordHash }));
        const res = await request(app).post('/auth/signin').send({ email: 'user@example.com', password: 'Wrong0ne!' });
        assert.equal(res.status, 401);
    });

    test('unverified users get 403 and a fresh OTP', async () => {
        sandbox.stub(User, 'findOne', async () => fakeUser({ password: passwordHash, isVerified: false }));
        const res = await request(app).post('/auth/signin').send({ email: 'user@example.com', password: 'Passw0rd!' });
        assert.equal(res.status, 403);
        assert.equal(res.body.requiresVerification, true);
        assert.ok(stubRedis.store.get('otp:user@example.com'));
        assert.ok(lastEmailTo('user@example.com'));
    });

    test('success returns an access token and stores only a hash of the refresh token', async () => {
        sandbox.stub(User, 'findOne', async () => fakeUser({ password: passwordHash }));
        const sessions = sandbox.stub(RefreshToken, 'create', async (v: object) => fakeInstance(v));

        const res = await request(app).post('/auth/signin').set('User-Agent', 'test-agent').send({ email: 'user@example.com', password: 'Passw0rd!' });

        assert.equal(res.status, 200);
        assert.equal(tokens.verifyAccessToken(res.body.accessToken as string).userId, 42);
        const cookie = refreshCookieOf(res);
        assert.ok(cookie, 'refresh cookie set');
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /SameSite=Strict/i);
        const raw = decodeURIComponent(cookie.split(';')[0]!.split('=')[1]!);
        const stored = sessions[0]?.[0] as { token: string; userAgent: string };
        assert.equal(stored.token, tokens.hashRefreshToken(raw));
        assert.notEqual(stored.token, raw);
        assert.equal(stored.userAgent, 'test-agent');
    });
});

describe('verify-otp and resend-otp', () => {
    test('a wrong OTP is rejected', async () => {
        stubRedis.store.set('otp:user@example.com', '123456');
        const res = await request(app).post('/auth/verify-otp').send({ email: 'user@example.com', otp: '654321' });
        assert.equal(res.status, 400);
    });

    test('a valid OTP for a missing user is 404', async () => {
        stubRedis.store.set('otp:gone@example.com', '123456');
        sandbox.stub(User, 'findOne', async () => null);
        const res = await request(app).post('/auth/verify-otp').send({ email: 'gone@example.com', otp: '123456' });
        assert.equal(res.status, 404);
    });

    test('a valid OTP verifies the user, grants a 30-day trial and starts a session', async () => {
        const user = fakeUser({ isVerified: false });
        stubRedis.store.set('otp:user@example.com', '123456');
        sandbox.stub(User, 'findOne', async () => user);
        const sessions = sandbox.stub(RefreshToken, 'create', async (v: object) => fakeInstance(v));

        const res = await request(app).post('/auth/verify-otp').send({ email: 'user@example.com', otp: '123456' });

        assert.equal(res.status, 200);
        assert.equal(user.isVerified, true);
        assert.equal(user.saved, 1);
        const trialDays = ((user.trialEndsAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
        assert.ok(trialDays > 29.9 && trialDays <= 30, `trial is 30 days (got ${trialDays})`);
        assert.equal(stubRedis.store.has('otp:user@example.com'), false, 'OTP consumed');
        assert.match(lastEmailTo('user@example.com')?.subject ?? '', /Welcome/);
        assert.equal(sessions.length, 1);
        assert.ok(refreshCookieOf(res));
    });

    test('an existing trial is not extended on re-verification', async () => {
        const trialEndsAt = new Date(Date.now() + 86_400_000);
        const user = fakeUser({ isVerified: false, trialEndsAt });
        stubRedis.store.set('otp:user@example.com', '123456');
        sandbox.stub(User, 'findOne', async () => user);
        sandbox.stub(RefreshToken, 'create', async (v: object) => fakeInstance(v));
        await request(app).post('/auth/verify-otp').send({ email: 'user@example.com', otp: '123456' });
        assert.equal(user.trialEndsAt, trialEndsAt);
    });

    test('resend-otp: unknown user 404, already verified 400', async () => {
        sandbox.stub(User, 'findOne', async () => null);
        assert.equal((await request(app).post('/auth/resend-otp').send({ email: 'x@example.com' })).status, 404);
        sandbox.restore();
        sandbox.stub(User, 'findOne', async () => fakeUser({ isVerified: true }));
        assert.equal((await request(app).post('/auth/resend-otp').send({ email: 'user@example.com' })).status, 400);
    });

    test('resend-otp is throttled while an OTP is still valid', async () => {
        sandbox.stub(User, 'findOne', async () => fakeUser({ isVerified: false }));
        stubRedis.store.set('otp:user@example.com', '123456');
        const res = await request(app).post('/auth/resend-otp').send({ email: 'user@example.com' });
        assert.equal(res.status, 429);
        assert.equal(sentEmails.length, 0);
    });

    test('resend-otp sends a new OTP', async () => {
        sandbox.stub(User, 'findOne', async () => fakeUser({ isVerified: false }));
        const res = await request(app).post('/auth/resend-otp').send({ email: 'user@example.com' });
        assert.equal(res.status, 200);
        assert.ok(stubRedis.store.get('otp:user@example.com'));
        assert.equal(sentEmails.length, 1);
    });
});

describe('password reset', () => {
    const forgot = async (user: ReturnType<typeof fakeUser> | null) => {
        sandbox.stub(User, 'findOne', async () => user);
        return request(app).post('/auth/forgot-password').send({ email: 'user@example.com' });
    };

    test('unknown and OAuth-only emails get the generic answer and no email', async () => {
        const unknown = await forgot(null);
        sandbox.restore();
        const oauthOnly = await forgot(fakeUser({ password: null }));
        assert.equal(unknown.status, 200);
        assert.deepEqual(unknown.body, oauthOnly.body);
        assert.equal(sentEmails.length, 0);
    });

    test('a registered user gets a single-use link', async () => {
        const res = await forgot(fakeUser({ password: 'hash' }));
        assert.equal(res.status, 200);
        const link = lastEmailTo('user@example.com')?.text.match(/token=([^\s]+)/)?.[1];
        assert.ok(link, 'reset link emailed');
        const { jti } = tokens.verifyResetToken(decodeURIComponent(link));
        assert.equal(stubRedis.store.get(`pwreset:${jti}`), '42');
    });

    test('reset rejects an invalid token and an access token', async () => {
        const access = tokens.generateAccessToken({ userId: 42, email: 'user@example.com', isVerified: true });
        for (const token of ['not-a-jwt', access]) {
            const res = await request(app).post('/auth/reset-password').send({ token, newPassword: 'NewPassw0rd!' });
            assert.equal(res.status, 400, token.slice(0, 10));
        }
    });

    test('reset changes the password, signs out every device and cannot be reused', async () => {
        const user = fakeUser({ password: 'old-hash' });
        const { token, jti } = tokens.generateResetToken({ userId: 42 });
        stubRedis.store.set(`pwreset:${jti}`, '42');
        sandbox.stub(User, 'findByPk', async () => user);
        const destroyed = sandbox.stub(RefreshToken, 'destroy', async () => 2);

        const first = await request(app).post('/auth/reset-password').send({ token, newPassword: 'NewPassw0rd!' });
        assert.equal(first.status, 200);
        assert.ok(await comparePassword('NewPassw0rd!', user.password ?? ''));
        assert.deepEqual(whereOf(destroyed[0]), { userId: 42 });

        const second = await request(app).post('/auth/reset-password').send({ token, newPassword: 'OtherPassw0rd!' });
        assert.equal(second.status, 400);
    });
});

describe('sessions', () => {
    const refreshCookie = (userId = 42) => `refreshToken=${tokens.generateRefreshToken({ userId })}`;

    test('refresh needs a valid refresh cookie', async () => {
        assert.equal((await request(app).post('/auth/refresh-token')).status, 401);
        assert.equal((await request(app).post('/auth/refresh-token').set('Cookie', 'refreshToken=garbage')).status, 401);
        const access = tokens.generateAccessToken({ userId: 42, email: 'a', isVerified: true });
        assert.equal((await request(app).post('/auth/refresh-token').set('Cookie', `refreshToken=${access}`)).status, 401);
    });

    test('refresh fails when the session was revoked', async () => {
        sandbox.stub(RefreshToken, 'findOne', async () => null);
        const res = await request(app).post('/auth/refresh-token').set('Cookie', refreshCookie());
        assert.equal(res.status, 401);
    });

    test('an expired session is deleted and the cookie cleared', async () => {
        const record = fakeInstance({ expiresAt: new Date(Date.now() - 1000) });
        sandbox.stub(RefreshToken, 'findOne', async () => record);
        const res = await request(app).post('/auth/refresh-token').set('Cookie', refreshCookie());
        assert.equal(res.status, 401);
        assert.equal(record.destroyed, 1);
        assert.match(refreshCookieOf(res) ?? '', /Expires=Thu, 01 Jan 1970/);
    });

    test('refresh looks the session up by token hash and returns a new access token', async () => {
        const cookie = refreshCookie();
        const lookups = sandbox.stub(RefreshToken, 'findOne', async () => fakeInstance({ expiresAt: new Date(Date.now() + 60_000) }));
        sandbox.stub(User, 'findByPk', async () => fakeUser());
        const res = await request(app).post('/auth/refresh-token').set('Cookie', cookie);
        assert.equal(res.status, 200);
        assert.equal(tokens.verifyAccessToken(res.body.accessToken as string).userId, 42);
        assert.deepEqual(whereOf(lookups[0]), { token: tokens.hashRefreshToken(cookie.split('=')[1]!), userId: 42 });
    });

    test('refresh for a deleted user is 404', async () => {
        sandbox.stub(RefreshToken, 'findOne', async () => fakeInstance({ expiresAt: new Date(Date.now() + 60_000) }));
        sandbox.stub(User, 'findByPk', async () => null);
        assert.equal((await request(app).post('/auth/refresh-token').set('Cookie', refreshCookie())).status, 404);
    });

    test('logout of the current device deletes its session by hash', async () => {
        const cookie = refreshCookie();
        const destroyed = sandbox.stub(RefreshToken, 'destroy', async () => 1);
        const res = await request(app).post('/auth/logout').set('Cookie', cookie);
        assert.equal(res.status, 200);
        assert.deepEqual(whereOf(destroyed[0]), { token: tokens.hashRefreshToken(cookie.split('=')[1]!) });
    });

    test('revoking a device by id requires sign-in', async () => {
        const res = await request(app).post('/auth/logout').send({ tokenId: 5 });
        assert.equal(res.status, 401);
    });

    test("revoking a device only ever looks at the caller's own sessions", async () => {
        const auth = signInAs(sandbox, fakeUser());
        const lookups = sandbox.stub(RefreshToken, 'findOne', async () => null);
        const res = await request(app).post('/auth/logout').set('Authorization', auth).send({ tokenId: 99 });
        assert.equal(res.status, 200);
        assert.deepEqual(whereOf(lookups[0]), { id: 99, userId: 42 });
    });

    test('revoking the current device also clears the cookie', async () => {
        const auth = signInAs(sandbox, fakeUser());
        const cookie = refreshCookie();
        const device = fakeInstance({ id: 5, token: tokens.hashRefreshToken(cookie.split('=')[1]!) });
        sandbox.stub(RefreshToken, 'findOne', async () => device);
        const res = await request(app).post('/auth/logout').set('Authorization', auth).set('Cookie', cookie).send({ tokenId: 5 });
        assert.equal(res.status, 200);
        assert.equal(device.destroyed, 1);
        assert.ok(refreshCookieOf(res), 'cookie cleared');
    });

    test('devices are listed for the caller only', async () => {
        const auth = signInAs(sandbox, fakeUser());
        const queries = sandbox.stub(RefreshToken, 'findAll', async () => []);
        const res = await request(app).get('/auth/devices').set('Authorization', auth);
        assert.equal(res.status, 200);
        assert.deepEqual(whereOf(queries[0]), { userId: 42 });
    });
});

describe('account', () => {
    test('/me returns the signed-in user', async () => {
        const auth = signInAs(sandbox, fakeUser());
        const res = await request(app).get('/auth/me').set('Authorization', auth);
        assert.equal(res.status, 200);
        assert.equal(res.body.user.email, 'user@example.com');
    });

    test('/me asks the database only for public attributes', async () => {
        const user = fakeUser();
        let calls = 0;
        let options: { attributes?: string[] } | undefined;
        sandbox.stub(User, 'findByPk', async (_id: number, opts?: { attributes?: string[] }) => {
            calls++;
            if (calls > 1) options = opts;
            return user;
        });
        const auth = `Bearer ${tokens.generateAccessToken({ userId: 42, email: user.email, isVerified: true })}`;
        await request(app).get('/auth/me').set('Authorization', auth);
        assert.ok(options?.attributes?.includes('email'));
        assert.ok(!options?.attributes?.includes('password'), 'password is never selected');
    });

    test('/me is 404 when the user disappears between auth and lookup', async () => {
        const user = fakeUser();
        let calls = 0;
        sandbox.stub(User, 'findByPk', async () => (++calls === 1 ? user : null));
        const auth = `Bearer ${tokens.generateAccessToken({ userId: 42, email: user.email, isVerified: true })}`;
        assert.equal((await request(app).get('/auth/me').set('Authorization', auth)).status, 404);
    });

    test('profile update changes only the fields sent', async () => {
        const user = fakeUser({ city: 'Pune', phone: '123' });
        const auth = signInAs(sandbox, user);
        const res = await request(app).put('/auth/profile').set('Authorization', auth).send({ name: 'Renamed', phone: null });
        assert.equal(res.status, 200);
        assert.equal(user.name, 'Renamed');
        assert.equal(user.phone, null);
        assert.equal(user.city, 'Pune', 'untouched field kept');
        assert.equal(user.saved, 1);
    });

    test('billing details replace the whole billing block', async () => {
        const user = fakeUser({ companyName: 'Old Co', taxId: 'OLD' });
        const auth = signInAs(sandbox, user);
        const res = await request(app).post('/auth/billing-details').set('Authorization', auth).send({ companyName: 'New Co' });
        assert.equal(res.status, 200);
        assert.equal(user.companyName, 'New Co');
        assert.equal(user.taxId, null, 'fields not sent are cleared');
        assert.equal(res.body.user.isVerified, undefined, 'billing response omits isVerified');
    });
});
