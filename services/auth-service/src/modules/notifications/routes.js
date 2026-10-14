const express = require('express');
const { authenticate } = require('../identity');
const { requireInternal } = require('../../shared/middleware/requireInternal');
const { streamUserCredits } = require('./stream');
const { getNotifications, markAsRead, createNotification } = require('./controller');
const { validateNotificationId } = require('./validator');

const router = express.Router();

// SSE Stream for Real-time Credits and notifications
router.get('/credits/stream', authenticate, streamUserCredits);

// Notifications
router.get('/notifications', authenticate, getNotifications);
// Internal only: other services create notifications for a user (requires X-Internal-Token)
router.post('/notifications', requireInternal, createNotification);
router.put('/notifications/:id/read', authenticate, validateNotificationId, markAsRead);

module.exports = router;
