const Mailgun = require('mailgun.js');
const formData = require('form-data');

const mailgun = new Mailgun(formData);

const mg = mailgun.client({
    username: 'api',
    key: process.env.MAILGUN_API_KEY
});

const sendEmail = async ({ to, subject, text, html }) => {
    try {
        const messageData = {
            from: process.env.MAILGUN_FROM_EMAIL || 'no-reply@keepmystore.com',
            to,
            subject,
            text,
            html
        };

        const response = await mg.messages.create(process.env.MAILGUN_DOMAIN, messageData);
        console.log('✓ Email sent successfully:', response.id);
        return { success: true, messageId: response.id };
    } catch (error) {
        console.error('✗ Email sending failed:', error.message);
        // Fallback to mock/log in development if Mailgun fails or is not configured correctly
        console.log('\n--- EMAIL FALLBACK LOG ---');
        console.log('To:', to);
        console.log('Subject:', subject);
        console.log('--- END FALLBACK ---\n');

        // In production we should probably throw, but let's keep it robust for now
        return { success: false, error: error.message };
    }
};

module.exports = { sendEmail };
