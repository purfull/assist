import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import logger from '../logger';

export interface EmailMessage {
    to: string;
    subject: string;
    text: string;
    html: string;
}

export type SendResult = { success: true; messageId: string } | { success: false; error: string };

// MAIL_TRANSPORT=log writes emails to the log instead of sending them (development/tests).
const transport = process.env.MAIL_TRANSPORT || 'mailgun';

const mg = transport === 'mailgun'
    ? new Mailgun(FormData).client({ username: 'api', key: process.env.MAILGUN_API_KEY ?? '' })
    : null;

export const sendEmail = async ({ to, subject, text, html }: EmailMessage): Promise<SendResult> => {
    if (!mg) {
        // Never log the body: it carries OTPs and reset links
        logger.info({ to, subject }, 'Email not sent (MAIL_TRANSPORT=log)');
        return { success: true, messageId: 'logged' };
    }

    try {
        const response = await mg.messages.create(process.env.MAILGUN_DOMAIN ?? '', {
            from: process.env.MAILGUN_FROM_EMAIL || 'no-reply@keepmystore.com',
            to,
            subject,
            text,
            html,
        });
        logger.info({ messageId: response.id, subject }, 'Email sent');
        return { success: true, messageId: response.id ?? '' };
    } catch (error) {
        // Callers treat email as best-effort; failures are logged for alerting
        logger.error({ err: error, subject }, 'Email sending failed');
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
};
