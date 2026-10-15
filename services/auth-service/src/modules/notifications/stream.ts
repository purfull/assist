import type { RequestHandler, Response } from 'express';
import { EVENTS, subscribe } from '../../shared/events';
import { getBalance } from '../billing';
import { currentUser } from '../identity';
import logger from '../../shared/logger';

// SSE client store: userId -> connected responses
const sseClients = new Map<string, Set<Response>>();

const sendToUser = (userId: number | string, data: unknown): void => {
    sseClients.get(String(userId))?.forEach((client) => {
        client.write(`data: ${JSON.stringify(data)}\n\n`);
    });
};

// Fan events out to connected clients. Events arrive via Redis, so this works across
// instances and for balances changed by other services.
subscribe(EVENTS.CREDITS_UPDATED, ({ userId, credits }) => sendToUser(userId, { credits }));
subscribe(EVENTS.NOTIFICATION_CREATED, ({ userId, notification }) => sendToUser(userId, { notification }));

/**
 * SSE endpoint: pushes the credit balance and new notifications to the browser.
 */
export const streamUserCredits: RequestHandler = (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const numericUserId = currentUser(req).userId;
    const userId = String(numericUserId);

    let clients = sseClients.get(userId);
    if (!clients) {
        clients = new Set();
        sseClients.set(userId, clients);
    }
    clients.add(res);

    // Send initial immediate state
    getBalance(numericUserId)
        .then((credits) => {
            if (credits !== null) res.write(`data: ${JSON.stringify({ credits })}\n\n`);
        })
        .catch((err: unknown) => logger.error({ err, userId }, 'SSE initial balance error'));

    // Cleanup on disconnect
    req.on('close', () => {
        const current = sseClients.get(userId);
        if (current) {
            current.delete(res);
            if (current.size === 0) sseClients.delete(userId);
        }
        res.end();
    });
};
