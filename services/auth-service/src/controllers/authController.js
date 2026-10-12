const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const Notification = require('../models/Notification');
const { hashPassword, comparePassword } = require('../utils/passwordUtils');
const { generateAccessToken, generateRefreshToken, generateResetToken, verifyAccessToken, verifyRefreshToken } = require('../utils/jwtUtils');
const { generateOTP, storeOTP, verifyOTP, deleteOTP, otpExists } = require('../utils/otpUtils');
const { sendOTPEmail, sendPasswordResetEmail, sendWelcomeEmail } = require('../utils/emailUtils');
const redisClient = require('../config/redis');

// SSE Client Store
const sseClients = new Map(); // userId -> Set of connected res objects

// Create a dedicated subscriber for Redis Pub/Sub
const redisSub = redisClient.duplicate();

redisSub.subscribe('credit:update', (err) => {
    if (err) console.error('Redis Subscribe Error:', err);
});
redisSub.subscribe('notification:new', (err) => {
    if (err) console.error('Redis Subscribe Error for notifications:', err);
});

redisSub.on('message', (channel, message) => {
    if (channel === 'credit:update') {
        try {
            const { userId, credits } = JSON.parse(message);
            const clients = sseClients.get(String(userId));
            if (clients) {
                clients.forEach(client => {
                    client.write(`data: ${JSON.stringify({ credits })}\n\n`);
                });
            }
        } catch (e) {
            console.error('SSE Message Error:', e);
        }
    } else if (channel === 'notification:new') {
        try {
            const { userId, notification } = JSON.parse(message);
            const clients = sseClients.get(String(userId));
            if (clients) {
                clients.forEach(client => {
                    client.write(`data: ${JSON.stringify({ notification })}\n\n`);
                });
            }
        } catch (e) {
            console.error('SSE Notification Message Error:', e);
        }
    }
});

/**
 * SSE Connect Endpoint
 */
const streamUserCredits = (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const userId = String(req.user.userId);

    if (!sseClients.has(userId)) {
        sseClients.set(userId, new Set());
    }
    sseClients.get(userId).add(res);

    // Send initial immediate state
    User.findByPk(userId).then(user => {
        if (user) res.write(`data: ${JSON.stringify({ credits: user.credits })}\n\n`);
    });

    // Cleanup on disconnect
    req.on('close', () => {
        const clients = sseClients.get(userId);
        if (clients) {
            clients.delete(res);
            if (clients.size === 0) sseClients.delete(userId);
        }
        res.end();
    });
};

/**
 * Signup with email and password
 */
const signup = async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Create user
        const user = await User.create({
            email,
            password: hashedPassword,
            name,
            isVerified: false
        });

        // Generate and store OTP
        const otp = generateOTP();
        await storeOTP(email, otp);

        // Send OTP email
        await sendOTPEmail(email, otp);

        res.status(201).json({
            message: 'Signup successful. Please verify your email with the OTP sent.',
            userId: user.id,
            email: user.email,
            name: user.name
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Signup failed. Please try again.' });
    }
};

/**
 * Verify OTP
 */
const verifyOTPController = async (req, res) => {
    try {
        const { email, otp } = req.body;

        // Verify OTP
        const isValid = await verifyOTP(email, otp);
        if (!isValid) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        // Update user verification status
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.isVerified = true;

        // Grant 30-day free trial on first verification
        if (!user.trialEndsAt) {
            user.trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        }

        await user.save();

        // Delete OTP from Redis
        await deleteOTP(email);

        // Send welcome email
        await sendWelcomeEmail(email);

        // Generate tokens
        const accessToken = generateAccessToken({ userId: user.id, email: user.email });
        const refreshToken = generateRefreshToken({ userId: user.id });

        // Store refresh token in database with device info
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        await RefreshToken.create({
            userId: user.id,
            token: refreshToken,
            expiresAt,
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip,
            lastUsedAt: new Date()
        });

        // Set refresh token in HttpOnly cookie
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.json({
            message: 'Email verified successfully',
            accessToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                isVerified: user.isVerified,
                credits: user.credits,
                trialEndsAt: user.trialEndsAt,
                trialWarningDays: user.trialWarningDays
            }
        });
    } catch (error) {
        console.error('OTP verification error:', error);
        res.status(500).json({ error: 'Sign in failed. Please try again.' });
    }
};

/**
 * Resend OTP
 */
const resendOTP = async (req, res) => {
    try {
        const { email } = req.body;

        // Check if user exists
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if already verified
        if (user.isVerified) {
            return res.status(400).json({ error: 'Email already verified' });
        }

        // Check if OTP already exists (rate limiting)
        const exists = await otpExists(email);
        if (exists) {
            return res.status(429).json({ error: 'OTP already sent. Please wait before requesting a new one.' });
        }

        // Generate and store new OTP
        const otp = generateOTP();
        await storeOTP(email, otp);

        // Send OTP email
        await sendOTPEmail(email, otp);

        res.json({ message: 'OTP sent successfully' });
    } catch (error) {
        console.error('Resend OTP error:', error);
        res.status(500).json({ error: 'Failed to resend OTP. Please try again.' });
    }
};

/**
 * Signin with email and password
 */
const signin = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const user = await User.findOne({ where: { email } });
        if (!user || !user.password) {
            return res.status(401).json({ error: 'Incorrect email or password' });
        }

        // Compare password
        const isPasswordValid = await comparePassword(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Incorrect email or password' });
        }

        // Check if verified
        if (!user.isVerified) {
            // Resend OTP
            const otp = generateOTP();
            await storeOTP(email, otp);
            await sendOTPEmail(email, otp);

            return res.status(403).json({
                error: 'Email not verified. A new OTP has been sent to your email.',
                requiresVerification: true
            });
        }

        // Generate tokens
        const accessToken = generateAccessToken({ userId: user.id, email: user.email });
        const refreshToken = generateRefreshToken({ userId: user.id });

        // Store refresh token with device info
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await RefreshToken.create({
            userId: user.id,
            token: refreshToken,
            expiresAt,
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip,
            lastUsedAt: new Date()
        });

        // Set refresh token in HttpOnly cookie
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.json({
            message: 'Signin successful',
            accessToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                isVerified: user.isVerified,
                credits: user.credits,
                trialEndsAt: user.trialEndsAt,
                trialWarningDays: user.trialWarningDays
            }
        });
    } catch (error) {
        console.error('Signin error:', error);
        res.status(500).json({ error: 'Signin failed. Please try again.' });
    }
};

/**
 * Forgot password
 */
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        // Find user
        const user = await User.findOne({ where: { email } });
        if (!user || !user.password) {
            // Don't reveal if email exists
            return res.json({ message: 'If the email exists, a password reset link has been sent.' });
        }

        // Generate reset token (JWT with 1 hour expiry)
        const resetToken = generateResetToken({ userId: user.id, purpose: 'password-reset' });

        // Send password reset email
        await sendPasswordResetEmail(email, resetToken);

        res.json({ message: 'If the email exists, a password reset link has been sent.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Failed to process request. Please try again.' });
    }
};

/**
 * Reset password
 */
const resetPassword = async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        // Verify reset token
        let decoded;
        try {
            console.log('Reset password attempt with token:', token ? `${token.substring(0, 10)}...` : 'MISSING');
            decoded = verifyAccessToken(token);
            console.log('Token verified, payload:', decoded);
        } catch (error) {
            console.error('Reset token verification failed:', error.message);
            return res.status(400).json({ error: 'Invalid or expired reset link' });
        }

        // Check purpose
        if (decoded.purpose !== 'password-reset') {
            return res.status(400).json({ error: 'Invalid or expired reset link' });
        }

        // Find user
        const user = await User.findByPk(decoded.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Hash new password
        const hashedPassword = await hashPassword(newPassword);
        user.password = hashedPassword;
        await user.save();

        // Invalidate all refresh tokens for this user
        await RefreshToken.destroy({ where: { userId: user.id } });

        res.json({ message: 'Password reset successful. Please sign in with your new password.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Failed to reset password. Please try again.' });
    }
};

/**
 * Refresh access token
 */
const refreshAccessToken = async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken;

        if (!refreshToken) {
            return res.status(401).json({ error: 'Please sign in to continue' });
        }

        // Verify refresh token from cookie
        let decoded;
        try {
            decoded = verifyRefreshToken(refreshToken);
        } catch (error) {
            return res.status(401).json({ error: 'Session expired, please sign in again' });
        }

        // Check if token exists in database
        const tokenRecord = await RefreshToken.findOne({
            where: { token: refreshToken, userId: decoded.userId }
        });

        if (!tokenRecord) {
            return res.status(401).json({ error: 'Session invalid, please sign in again' });
        }

        // Check if token is expired
        if (new Date() > tokenRecord.expiresAt) {
            await tokenRecord.destroy();
            res.clearCookie('refreshToken');
            return res.status(401).json({ error: 'Session expired, please sign in again' });
        }

        // Get user
        const user = await User.findByPk(decoded.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Generate new access token
        const accessToken = generateAccessToken({ userId: user.id, email: user.email });

        res.json({ accessToken });
    } catch (error) {
        console.error('Session refresh error:', error);
        res.status(500).json({ error: 'Session expired, please sign in again' });
    }
};

/**
 * Logout
 */
const logout = async (req, res) => {
    try {
        const { tokenId } = req.body;
        const refreshToken = req.cookies.refreshToken;

        if (tokenId) {
            // Logout specific device (e.g. from profile page)
            // If the device being logged out is the current one, we should also clear the cookie
            const deviceToRemove = await RefreshToken.findOne({
                where: { id: tokenId, userId: req.user.userId }
            });

            if (deviceToRemove) {
                if (deviceToRemove.token === refreshToken) {
                    res.clearCookie('refreshToken');
                }
                await deviceToRemove.destroy();
            }
        } else if (refreshToken) {
            // Logout current device
            await RefreshToken.destroy({ where: { token: refreshToken } });
            res.clearCookie('refreshToken');
        } else {
            // No token found, but let's clear cookie just in case
            res.clearCookie('refreshToken');
        }

        res.json({ message: 'Logout successful' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Logout failed. Please try again.' });
    }
};

/**
 * Get active devices (sessions)
 */
const getActiveDevices = async (req, res) => {
    try {
        const devices = await RefreshToken.findAll({
            where: { userId: req.user.userId },
            attributes: ['id', 'userAgent', 'ipAddress', 'lastUsedAt', 'createdAt'],
            order: [['lastUsedAt', 'DESC']]
        });

        res.json({ devices });
    } catch (error) {
        console.error('Get active devices error:', error);
        res.status(500).json({ error: 'Failed to fetch active devices' });
    }
};

/**
 * Get current user
 */
const getCurrentUser = async (req, res) => {
    try {
        const user = await User.findByPk(req.user.userId, {
            attributes: [
                'id', 'email', 'name', 'phone', 'isVerified', 'googleId', 'createdAt',
                'companyName', 'billingAddress', 'city', 'state', 'zipCode', 'country', 'taxId', 'credits', 'trialEndsAt', 'trialWarningDays'
            ]
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user });
    } catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({ error: 'Failed to fetch account data' });
    }
};

/**
 * Update user profile (personal and billing info)
 */
const updateProfile = async (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            name, phone,
            companyName, billingAddress, city, state, zipCode, country, taxId
        } = req.body;

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update fields if provided
        if (name !== undefined) user.name = name;
        if (phone !== undefined) user.phone = phone;
        if (companyName !== undefined) user.companyName = companyName;
        if (billingAddress !== undefined) user.billingAddress = billingAddress;
        if (city !== undefined) user.city = city;
        if (state !== undefined) user.state = state;
        if (zipCode !== undefined) user.zipCode = zipCode;
        if (country !== undefined) user.country = country;
        if (taxId !== undefined) user.taxId = taxId;

        await user.save();

        res.json({
            message: 'Profile updated successfully',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                phone: user.phone,
                companyName: user.companyName,
                billingAddress: user.billingAddress,
                city: user.city,
                state: user.state,
                zipCode: user.zipCode,
                country: user.country,
                taxId: user.taxId,
                isVerified: user.isVerified,
                credits: user.credits,
                trialEndsAt: user.trialEndsAt,
                trialWarningDays: user.trialWarningDays
            }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
};

/**
 * Google OAuth callback handler
 */
const googleCallback = async (req, res) => {
    try {
        const user = req.user; // Set by passport

        // Grant 30-day free trial on first Google sign-in
        if (!user.trialEndsAt) {
            user.trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            await user.save();
        }

        // Generate tokens
        const accessToken = generateAccessToken({ userId: user.id, email: user.email });
        const refreshToken = generateRefreshToken({ userId: user.id });

        // Set refresh token in HttpOnly cookie
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        // Redirect to frontend with access token only
        const redirectUrl = `${process.env.FRONTEND_URL}/auth/callback?accessToken=${accessToken}`;
        res.redirect(redirectUrl);
    } catch (error) {
        console.error('Google callback error:', error);
        res.redirect(`${process.env.FRONTEND_URL}/auth/error`);
    }
};

/**
 * Update billing details
 */
const updateBillingDetails = async (req, res) => {
    try {
        const { companyName, billingAddress, city, state, zipCode, country, taxId } = req.body;
        const userId = req.user.userId;

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.companyName = companyName;
        user.billingAddress = billingAddress;
        user.city = city;
        user.state = state;
        user.zipCode = zipCode;
        user.country = country;
        user.taxId = taxId;

        await user.save();

        res.json({
            message: 'Billing details updated successfully',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                companyName: user.companyName,
                billingAddress: user.billingAddress,
                city: user.city,
                state: user.state,
                zipCode: user.zipCode,
                country: user.country,
                taxId: user.taxId,
                credits: user.credits,
                trialEndsAt: user.trialEndsAt,
                trialWarningDays: user.trialWarningDays
            }
        });
    } catch (error) {
        console.error('Update billing details error:', error);
        res.status(500).json({ error: 'Failed to update billing details' });
    }
};

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
        console.error('Get notifications error:', error);
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
        console.error('Mark notification read error:', error);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
};

/**
 * Create a new notification (API or Internal)
 */
const createNotification = async (req, res) => {
    try {
        const { userId, message } = req.body;
        
        const notification = await Notification.create({
            userId,
            message
        });

        // Publish to Redis so active SSE connections push it instantly
        redisClient.publish('notification:new', JSON.stringify({ userId, notification }));

        res.status(201).json({ message: 'Notification created', notification });
    } catch (error) {
        console.error('Create notification error:', error);
        res.status(500).json({ error: 'Failed to create notification' });
    }
};

module.exports = {
    signup,
    verifyOTPController,
    resendOTP,
    signin,
    forgotPassword,
    resetPassword,
    refreshAccessToken,
    logout,
    getCurrentUser,
    getActiveDevices,
    googleCallback,
    updateBillingDetails,
    updateProfile,
    streamUserCredits,
    getNotifications,
    markAsRead,
    createNotification
};
