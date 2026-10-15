/**
 * The Mailgun transport: success, and failures reported without throwing (email is
 * best-effort). Runs with MAIL_TRANSPORT=mailgun and a fake Mailgun SDK.
 */
import '../helpers/env';
import '../helpers/fakeMailgun';
import { mailgunMessages } from '../helpers/fakeMailgun';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail } from '../../src/shared/config/mailer';

const message = { to: 'user@example.com', subject: 'Hi', text: 'Body', html: '<p>Body</p>' };

test('sends through Mailgun with the configured domain and sender', async () => {
    const sent: unknown[][] = [];
    mailgunMessages.create = async (...args: unknown[]) => { sent.push(args); return { id: 'mg-1' }; };
    assert.deepEqual(await sendEmail(message), { success: true, messageId: 'mg-1' });
    assert.equal(sent[0]?.[0], 'mg.example.com');
    assert.equal((sent[0]?.[1] as { from: string }).from, 'no-reply@keepmystore.com');
});

test('a Mailgun failure is reported, not thrown', async () => {
    mailgunMessages.create = async () => { throw new Error('Unauthorized'); };
    assert.deepEqual(await sendEmail(message), { success: false, error: 'Unauthorized' });
});
