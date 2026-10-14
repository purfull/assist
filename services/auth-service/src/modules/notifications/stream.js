const { EVENTS, subscribe } = require('../../shared/events');
const { getBalance } = require('../billing');
const logger = require('../../shared/logger');

// SSE Client Store
const sseClients = new Map(); // userId -> Set of connected res objects

const sendToUser = (userId, data) => {
    const clients = sseClients.get(String(userId));
    if (clients) {
        clients.forEach(client => {
            client.write(`data: ${JSON.stringify(data)}\n\n`);
        });
    }
};

// Fan events out to connected clients. Events arrive via Redis, so this works across
// instances and for balances changed by other services.
subscribe(EVENTS.CREDITS_UPDATED, ({ userId, credits }) => sendToUser(userId, { credits }));
subscribe(EVENTS.NOTIFICATION_CREATED, ({ userId, notification }) => sendToUser(userId, { notification }));

/**
 * SSE Connect Endpoint
 */
const streamUserCredits = (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const userId = String(req.user.userId);

    if (!sseClients.has(userId)) {
        sseClients.set(userId, new Set());
    }
    sseClients.get(userId).add(res);

    // Send initial immediate state
    getBalance(req.user.userId)
        .then(credits => {
            if (credits !== null) res.write(`data: ${JSON.stringify({ credits })}\n\n`);
        })
        .catch(err => logger.error({ err, userId }, 'SSE initial balance error'));

    // Cleanup on disconnect
    req.on('close', () => {
        const clients = sseClients.get(userId);
        if (clients) {
            clients.delete(res);
            if (clients.size === 0) sseClients.delete(userId);
        }
        res.end();
    });
};

module.exports = { streamUserCredits };
