/**
 * Side-effect import for integration tests: captures outgoing email instead of sending
 * it, so tests can read OTPs and reset links. Import before any app code.
 */
import path from 'path';
import { replaceModule } from './stub';
import type { EmailMessage } from '../../src/shared/config/mailer';

export const sentEmails: EmailMessage[] = [];

replaceModule(path.join(__dirname, '../../src/shared/config/mailer'), {
    __esModule: true,
    sendEmail: async (message: EmailMessage) => {
        sentEmails.push(message);
        return { success: true, messageId: 'captured' };
    },
});

export const lastEmailTo = (to: string): EmailMessage | undefined =>
    [...sentEmails].reverse().find((m) => m.to === to);
