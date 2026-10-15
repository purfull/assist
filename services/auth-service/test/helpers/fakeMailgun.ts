/**
 * Side-effect import: switches the mailer to the Mailgun transport with a fake SDK, so the
 * Mailgun code path can be tested without network calls. Import before the mailer.
 */
import { replaceModule } from './stub';

process.env.MAIL_TRANSPORT = 'mailgun';
process.env.MAILGUN_API_KEY = 'test-key';
process.env.MAILGUN_DOMAIN = 'mg.example.com';

export const mailgunMessages: { create: (...args: unknown[]) => Promise<{ id?: string }> } = {
    create: async () => ({ id: 'unset' }),
};

replaceModule('mailgun.js', {
    __esModule: true,
    default: class FakeMailgun {
        client() {
            return { messages: { create: (...args: unknown[]) => mailgunMessages.create(...args) } };
        }
    },
});
