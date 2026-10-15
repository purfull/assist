import { Router } from 'express';
import { authenticate } from '../identity';
import { requireInternal } from '../../shared/middleware/requireInternal';
import { streamUserCredits } from './stream';
import { getNotifications, markAsRead, createNotification } from './controller';
import { validateNotificationId } from './validator';

const router = Router();

// SSE Stream for Real-time Credits and notifications
router.get('/credits/stream', authenticate, streamUserCredits);

// Notifications
router.get('/notifications', authenticate, getNotifications);
// Internal only: other services create notifications for a user (requires X-Internal-Token)
router.post('/notifications', requireInternal, createNotification);
router.put('/notifications/:id/read', authenticate, validateNotificationId, markAsRead);

export default router;
