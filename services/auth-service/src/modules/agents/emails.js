const { sendEmail } = require('../../shared/config/mailer');

/**
 * Send API key generation/regeneration OTP email
 */
const sendApiKeyOtpEmail = async (email, otp, agentName = 'your agent') => {
    const subject = 'API Key Generation — Verification Code';
    const text = `Your verification code to generate an API key for "${agentName}" is: ${otp}\n\nThis code expires in 5 minutes.`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">API Key Verification</h2>
            <p>You requested to generate/regenerate an API key for <strong>${agentName}</strong>.</p>
            <p>Enter the code below to confirm:</p>
            <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0; border-radius: 8px;">
                ${otp}
            </div>
            <p style="color: #e53e3e; font-size: 13px;">⚠️ Store your key safely — it will only be shown once after generation.</p>
            <p style="color: #999; font-size: 12px;">This code expires in 5 minutes. If you didn't request this, ignore this email.</p>
        </div>
    `;
    await sendEmail({ to: email, subject, text, html });
};

module.exports = { sendApiKeyOtpEmail };
