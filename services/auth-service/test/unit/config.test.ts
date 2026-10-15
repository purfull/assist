import '../helpers/env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnv } from '../../src/shared/config/env';

test('the test configuration is valid', () => {
    assert.doesNotThrow(() => validateEnv(process.env));
});

test('missing required settings fail with their names', () => {
    const env = { ...process.env };
    delete env.DB_HOST;
    delete env.RAZORPAY_KEY_SECRET;
    assert.throws(() => validateEnv(env), /DB_HOST.*RAZORPAY_KEY_SECRET|RAZORPAY_KEY_SECRET.*DB_HOST/);
});

test('production requires real keys, a strong internal token and Mailgun', () => {
    const env = {
        ...process.env,
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY_PATH: '',
        JWT_PUBLIC_KEY_PATH: '',
        INTERNAL_SERVICE_TOKEN: 'short',
        MAIL_TRANSPORT: 'log',
    };
    assert.throws(() => validateEnv(env), (err: Error) =>
        /JWT_PRIVATE_KEY/.test(err.message) && /INTERNAL_SERVICE_TOKEN/.test(err.message) && /MAIL_TRANSPORT/.test(err.message));
});
