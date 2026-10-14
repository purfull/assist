const Notification = require('./models/Notification');
const { EVENTS, publish } = require('../../shared/events');

/**
 * Get all notifications for user
 */
const getNotifications = async (req, res) => {
    try {
        const notifications = await Notification.findAll({
            where: { userId: req.user.userId },
            order: [['createdAt', 'DESC']]
        });
        res.json({ notifications });
    } catch (error) {
        req.log.error({ err: error }, 'Get notifications error');
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

/**
 * Mark notification as read
 */
const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.findOne({
            where: { id, userId: req.user.userId }
        });

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        notification.isRead = true;
        await notification.save();

        res.json({ message: 'Marked as read', notification });
    } catch (error) {
        req.log.error({ err: error }, 'Mark notification read error');
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
};

/**
 * Create a new notification (internal service-to-service only; see requireInternal)
 */
const createNotification = async (req, res) => {
    try {
        const { userId, message } = req.body;

        if (!Number.isInteger(userId) || userId <= 0 || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'userId (integer) and message (string) are required' });
        }

        const notification = await Notification.create({
            userId,
            message
        });

        // Publish so active SSE connections push it instantly
        publish(EVENTS.NOTIFICATION_CREATED, { userId, notification }).catch((err) =>
            req.log.error({ err }, 'Failed to publish notification event')
        );

        res.status(201).json({ message: 'Notification created', notification });
    } catch (error) {
        req.log.error({ err: error }, 'Create notification error');
        res.status(500).json({ error: 'Failed to create notification' });
    }
};

module.exports = {
    getNotifications,
    markAsRead,
    createNotification
};
