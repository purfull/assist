import '../helpers/env';
import '../helpers/useStubRedis';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as otp from '../../src/modules/identity/utils/otpUtils';

test('a correct OTP is accepted', async () => {
    await otp.storeOTP('a@b.co', '123456');
    assert.equal(await otp.verifyOTP('a@b.co', '123456'), true);
});

test('the OTP is burned after too many wrong guesses', async () => {
    await otp.storeOTP('b@b.co', '123456');
    for (let i = 0; i < 5; i++) assert.equal(await otp.verifyOTP('b@b.co', '000000'), false);
    assert.equal(await otp.verifyOTP('b@b.co', '123456'), false);
});

test('issuing a new OTP resets the attempt counter', async () => {
    await otp.storeOTP('c@b.co', '111111');
    for (let i = 0; i < 4; i++) await otp.verifyOTP('c@b.co', '000000');
    await otp.storeOTP('c@b.co', '222222');
    assert.equal(await otp.verifyOTP('c@b.co', '222222'), true);
});

test('inputs of a different length are rejected without throwing', async () => {
    await otp.storeOTP('d@b.co', '123456');
    assert.equal(await otp.verifyOTP('d@b.co', '1'), false);
});
