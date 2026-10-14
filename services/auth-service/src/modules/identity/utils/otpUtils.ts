import crypto from 'crypto';
import redis from '../../../shared/config/redis';

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 5;
const OTP_LENGTH = Number(process.env.OTP_LENGTH) || 6;
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS) || 5;

const otpKey = (email: string): string => `otp:${email}`;
const attemptsKey = (email: string): string => `otp_attempts:${email}`;

/** Generate a random numeric OTP */
export const generateOTP = (): string =>
    crypto.randomInt(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH).toString();

/** Store OTP in Redis with expiration, resetting the failed-attempt counter */
export const storeOTP = async (email: string, otp: string): Promise<void> => {
    await redis.multi()
        .setex(otpKey(email), OTP_EXPIRY_MINUTES * 60, otp)
        .del(attemptsKey(email))
        .exec();
};

/** Delete OTP (and its attempt counter) from Redis */
export const deleteOTP = async (email: string): Promise<void> => {
    await redis.del(otpKey(email), attemptsKey(email));
};

/**
 * Verify OTP from Redis.
 * Failed attempts are counted per email; after OTP_MAX_ATTEMPTS the OTP is burned,
 * so brute force from many IPs can't get around the IP-based rate limiter.
 */
export const verifyOTP = async (email: string, otp: string): Promise<boolean> => {
    const storedOTP = await redis.get(otpKey(email));
    if (!storedOTP) {
        return false; // OTP expired or doesn't exist
    }

    const attempts = await redis.incr(attemptsKey(email));
    if (attempts === 1) {
        await redis.expire(attemptsKey(email), OTP_EXPIRY_MINUTES * 60);
    }
    if (attempts > OTP_MAX_ATTEMPTS) {
        await deleteOTP(email);
        return false;
    }

    const expected = Buffer.from(storedOTP);
    const received = Buffer.from(String(otp));
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};

/** Check if an OTP exists for email (used to throttle resends) */
export const otpExists = async (email: string): Promise<boolean> =>
    (await redis.exists(otpKey(email))) === 1;
