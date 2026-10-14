const crypto = require('crypto');
const redis = require('../../../shared/config/redis');

const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES) || 5;
const OTP_LENGTH = parseInt(process.env.OTP_LENGTH) || 6;
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS) || 5;

const attemptsKey = (email) => `otp_attempts:${email}`;

/**
 * Generate a random OTP
 * @returns {string} - Random OTP
 */
const generateOTP = () => {
    const otp = crypto.randomInt(Math.pow(10, OTP_LENGTH - 1), Math.pow(10, OTP_LENGTH));
    return otp.toString();
};

/**
 * Store OTP in Redis with expiration
 * @param {string} email - User email
 * @param {string} otp - OTP to store
 * @returns {Promise<void>}
 */
const storeOTP = async (email, otp) => {
    const key = `otp:${email}`;
    const expirySeconds = OTP_EXPIRY_MINUTES * 60;
    await redis.multi()
        .setex(key, expirySeconds, otp)
        .del(attemptsKey(email))
        .exec();
};

/**
 * Verify OTP from Redis.
 * Failed attempts are counted per email; after OTP_MAX_ATTEMPTS the OTP is burned,
 * so brute force from many IPs can't get around the IP-based rate limiter.
 * @param {string} email - User email
 * @param {string} otp - OTP to verify
 * @returns {Promise<boolean>} - True if OTP is valid
 */
const verifyOTP = async (email, otp) => {
    const key = `otp:${email}`;
    const storedOTP = await redis.get(key);

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

/**
 * Delete OTP from Redis
 * @param {string} email - User email
 * @returns {Promise<void>}
 */
const deleteOTP = async (email) => {
    const key = `otp:${email}`;
    await redis.del(key, attemptsKey(email));
};

/**
 * Check if OTP exists for email
 * @param {string} email - User email
 * @returns {Promise<boolean>} - True if OTP exists
 */
const otpExists = async (email) => {
    const key = `otp:${email}`;
    const exists = await redis.exists(key);
    return exists === 1;
};

module.exports = {
    generateOTP,
    storeOTP,
    verifyOTP,
    deleteOTP,
    otpExists
};
