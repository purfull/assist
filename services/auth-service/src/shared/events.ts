import type Redis from 'ioredis';
import redis, { closeRedis } from './config/redis';
import logger from './logger';

/**
 * In-process facade over Redis pub/sub for cross-module (and cross-service) events.
 * Modules publish and subscribe through this file instead of calling each other.
 *
 * Channel names are a public contract: other services (e.g. agent usage) already
 * publish `credit:update`, so they must not be renamed without coordinating.
 */
export const EVENTS = {
    CREDITS_UPDATED: 'credit:update',
    NOTIFICATION_CREATED: 'notification:new',
} as const;

/** Payload carried by each event. userId may arrive as a string from other services. */
export interface EventPayloads {
    'credit:update': { userId: number | string; credits: number };
    'notification:new': { userId: number | string; notification: unknown };
}

export type EventName = keyof EventPayloads;
type Handler<E extends EventName> = (payload: EventPayloads[E]) => void;

let subscriber: Redis | undefined;
const handlers = new Map<string, Set<(payload: unknown) => void>>();

export const publish = <E extends EventName>(event: E, payload: EventPayloads[E]): Promise<number> =>
    redis.publish(event, JSON.stringify(payload));

export const subscribe = <E extends EventName>(event: E, handler: Handler<E>): void => {
    if (!subscriber) {
        const sub = redis.duplicate();
        sub.on('message', (channel: string, message: string) => {
            let payload: unknown;
            try {
                payload = JSON.parse(message);
            } catch (err) {
                logger.error({ err, channel }, 'Invalid JSON on event channel');
                return;
            }
            handlers.get(channel)?.forEach((fn) => {
                try {
                    fn(payload);
                } catch (err) {
                    logger.error({ err, channel }, 'Event handler failed');
                }
            });
        });
        subscriber = sub;
    }

    let set = handlers.get(event);
    if (!set) {
        set = new Set();
        handlers.set(event, set);
        subscriber.subscribe(event).catch((err: unknown) => logger.error({ err, event }, 'Event subscribe failed'));
    }
    set.add(handler as (payload: unknown) => void);
};

/** Close the subscriber connection (graceful shutdown). */
export const close = async (): Promise<void> => {
    if (subscriber) await closeRedis(subscriber);
};
