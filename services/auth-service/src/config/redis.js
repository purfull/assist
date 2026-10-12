const Redis = require('ioredis');

const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
    maxRetriesPerRequest: 3
});

redis.on('connect', () => {
    console.log('✓ Redis connected successfully');
});

redis.on('error', (err) => {
    console.error('✗ Redis connection error:', err.message);
});

module.exports = redis;
