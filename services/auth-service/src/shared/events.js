const redis = require('./config/redis');
const logger = require('./logger');

/**
 * In-process facade over Redis pub/sub for cross-module (and cross-service) events.
 * Modules publish and subscribe through this file instead of calling each other.
 *
 * Channel names are a public contract: other services (e.g. agent usage) already
 * publish `credit:update`, so they must not be renamed without coordinating.
 */
const EVENTS = {
    CREDITS_UPDATED: 'credit:update',      // { userId, credits }
    NOTIFICATION_CREATED: 'notification:new' // { userId, notification }
};

let subscriber;
const handlers = new Map(); // channel -> Set of handler functions

const publish = (event, payload) => redis.publish(event, JSON.stringify(payload));

const subscribe = (event, handler) => {
    if (!subscriber) {
        subscriber = redis.duplicate();
        subscriber.on('message', (channel, message) => {
            let payload;
            try {
                payload = JSON.parse(message);
            } catch (e) {
                logger.error({ err: e, channel }, 'Invalid JSON on event channel');
                return;
            }
            (handlers.get(channel) || []).forEach((fn) => {
                try {
                    fn(payload);
                } catch (e) {
                    logger.error({ err: e, channel }, 'Event handler failed');
                }
            });
        });
    }

    if (!handlers.has(event)) {
        handlers.set(event, new Set());
        subscriber.subscribe(event, (err) => {
            if (err) logger.error({ err, event }, 'Event subscribe failed');
        });
    }
    handlers.get(event).add(handler);
};

/** Close the subscriber connection (graceful shutdown). */
const close = async () => {
    if (subscriber) await subscriber.quit();
};

module.exports = { EVENTS, publish, subscribe, close };
