import type { RequestHandler } from 'express';
import Notification from './models/Notification';
import { EVENTS, publish } from '../../shared/events';
import { currentUser } from '../identity';

type NotificationParams = { id: string };
interface CreateNotificationBody { userId?: unknown; message?: unknown }

/**
 * Get all notifications for user
 */
export const getNotifications: RequestHandler = async (req, res) => {
    try {
        const notifications = await Notification.findAll({
            where: { userId: currentUser(req).userId },
            order: [['createdAt', 'DESC']],
        });
        return res.json({ notifications });
    } catch (error) {
        req.log.error({ err: error }, 'Get notifications error');
        return res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

/**
 * Mark notification as read
 */
export const markAsRead: RequestHandler<NotificationParams> = async (req, res) => {
    try {
        const notification = await Notification.findOne({
            where: { id: Number(req.params.id), userId: currentUser(req).userId },
        });
        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        notification.isRead = true;
        await notification.save();

        return res.json({ message: 'Marked as read', notification });
    } catch (error) {
        req.log.error({ err: error }, 'Mark notification read error');
        return res.status(500).json({ error: 'Failed to mark notification as read' });
    }
};

/**
 * Create a new notification (internal service-to-service only; see requireInternal)
 */
export const createNotification: RequestHandler<Record<string, string>, unknown, CreateNotificationBody> = async (req, res) => {
    try {
        const { userId, message } = req.body;

        if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0 || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'userId (integer) and message (string) are required' });
        }

        const notification = await Notification.create({ userId, message });

        // Publish so active SSE connections push it instantly
        publish(EVENTS.NOTIFICATION_CREATED, { userId, notification }).catch((err: unknown) =>
            req.log.error({ err }, 'Failed to publish notification event'));

        return res.status(201).json({ message: 'Notification created', notification });
    } catch (error) {
        req.log.error({ err: error }, 'Create notification error');
        return res.status(500).json({ error: 'Failed to create notification' });
    }
};
