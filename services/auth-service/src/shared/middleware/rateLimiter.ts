import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import redis from '../config/redis';

// Counters live in Redis so limits hold across multiple service instances.
// Client IPs come from X-Forwarded-For, which requires `trust proxy` (see app.ts).
const createStore = (prefix: string): RedisStore => new RedisStore({
    sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
    prefix: `rl:${prefix}:`,
});

const limiter = (prefix: string, windowMs: number, max: number): RateLimitRequestHandler => rateLimit({
    windowMs,
    max,
    message: { error: 'Too many attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(prefix),
});

// Authentication endpoints: 5 requests per 15 minutes
export const authLimiter = limiter('auth', 15 * 60 * 1000, 5);

// OTP endpoints: 3 requests per 5 minutes
export const otpLimiter = limiter('otp', 5 * 60 * 1000, 3);

// General API: 30 requests per minute
export const generalLimiter = limiter('general', 60 * 1000, 30);
