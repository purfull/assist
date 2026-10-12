const { sendEmail } = require('../config/mailgun');

/**
 * Send OTP verification email
 * @param {string} email - Recipient email
 * @param {string} otp - OTP code
 * @returns {Promise<void>}
 */
const sendOTPEmail = async (email, otp) => {
    const subject = 'Verify Your Email - OTP Code';
    const text = `Your OTP code is: ${otp}\n\nThis code will expire in ${process.env.OTP_EXPIRY_MINUTES || 5} minutes.`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Email Verification</h2>
            <p>Your OTP code is:</p>
            <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
                ${otp}
            </div>
            <p style="color: #666;">This code will expire in ${process.env.OTP_EXPIRY_MINUTES || 5} minutes.</p>
            <p style="color: #666; font-size: 12px;">If you didn't request this code, please ignore this email.</p>
        </div>
    `;

    await sendEmail({ to: email, subject, text, html });
};

/**
 * Send password reset email
 * @param {string} email - Recipient email
 * @param {string} resetToken - Password reset token
 * @returns {Promise<void>}
 */
const sendPasswordResetEmail = async (email, resetToken) => {
    const encodedToken = encodeURIComponent(resetToken);
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${encodedToken}`;
    const subject = 'Password Reset Request';
    const text = `Click the following link to reset your password:\n\n${resetUrl}\n\nThis link will expire in 1 hour.`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>You requested to reset your password. Click the button below to proceed:</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background: #6366f1; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                    Reset Password
                </a>
            </div>
            <p style="color: #666;">Or copy and paste this link:</p>
            <p style="color: #6366f1; word-break: break-all;">${resetUrl}</p>
            <p style="color: #666; font-size: 12px;">This link will expire in 1 hour.</p>
            <p style="color: #666; font-size: 12px;">If you didn't request this, please ignore this email.</p>
        </div>
    `;

    await sendEmail({ to: email, subject, text, html });
};

/**
 * Send welcome email
 * @param {string} email - Recipient email
 * @returns {Promise<void>}
 */
const sendWelcomeEmail = async (email) => {
    const subject = 'Welcome to Our Platform!';
    const text = `Welcome! Your email has been verified successfully.`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Welcome!</h2>
            <p>Your email has been verified successfully. You can now access all features of our platform.</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL}" style="background: #6366f1; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                    Get Started
                </a>
            </div>
        </div>
    `;

    await sendEmail({ to: email, subject, text, html });
};

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

module.exports = {
    sendOTPEmail,
    sendPasswordResetEmail,
    sendWelcomeEmail,
    sendApiKeyOtpEmail
};
