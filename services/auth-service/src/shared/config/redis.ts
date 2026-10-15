import Redis from 'ioredis';
import logger from '../logger';

const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
});

redis.on('connect', () => {
    logger.info('Redis connected');
});

redis.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
});

/**
 * Close a Redis connection without hanging: QUIT only works on a live connection; if the
 * client never connected (Redis down), QUIT would wait in the offline queue forever.
 */
export const closeRedis = async (client: Redis): Promise<void> => {
    if (client.status === 'ready') {
        await client.quit();
    } else {
        client.disconnect();
    }
};

export default redis;
