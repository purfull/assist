import { sendEmail } from '../../shared/config/mailer';

/**
 * Send OTP verification email
 */
export const sendOTPEmail = async (email: string, otp: string): Promise<void> => {
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
 */
export const sendPasswordResetEmail = async (email: string, resetToken: string): Promise<void> => {
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
 */
export const sendWelcomeEmail = async (email: string): Promise<void> => {
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

