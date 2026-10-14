const User = require('./models/User');
const RefreshToken = require('./models/RefreshToken');
const { hashPassword, comparePassword } = require('./utils/passwordUtils');
const crypto = require('crypto');
const { generateAccessToken, generateRefreshToken, generateResetToken, verifyResetToken, verifyRefreshToken, hashRefreshToken } = require('./utils/jwtUtils');
const { generateOTP, storeOTP, verifyOTP, deleteOTP, otpExists } = require('./utils/otpUtils');
const { sendOTPEmail, sendPasswordResetEmail, sendWelcomeEmail } = require('./emails');
const redisClient = require('../../shared/config/redis');

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
        req.log.error({ err: error }, 'Signup error');
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
        const accessToken = generateAccessToken({ userId: user.id, email: user.email, isVerified: user.isVerified });
        const refreshToken = generateRefreshToken({ userId: user.id });

        // Store refresh token in database with device info
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        await RefreshToken.create({
            userId: user.id,
            token: hashRefreshToken(refreshToken),
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
        req.log.error({ err: error }, 'OTP verification error');
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
        req.log.error({ err: error }, 'Resend OTP error');
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
        const accessToken = generateAccessToken({ userId: user.id, email: user.email, isVerified: user.isVerified });
        const refreshToken = generateRefreshToken({ userId: user.id });

        // Store refresh token with device info
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await RefreshToken.create({
            userId: user.id,
            token: hashRefreshToken(refreshToken),
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
        req.log.error({ err: error }, 'Signin error');
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

        // Generate reset token (JWT with 1 hour expiry). Its jti is stored in Redis so the
        // link can be used only once.
        const { token: resetToken, jti } = generateResetToken({ userId: user.id });
        await redisClient.set(`pwreset:${jti}`, String(user.id), 'EX', 60 * 60);

        // Send password reset email
        await sendPasswordResetEmail(email, resetToken);

        res.json({ message: 'If the email exists, a password reset link has been sent.' });
    } catch (error) {
        req.log.error({ err: error }, 'Forgot password error');
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
            decoded = verifyResetToken(token);
        } catch (error) {
            return res.status(400).json({ error: 'Invalid or expired reset link' });
        }

        // Single use: consume the jti; a second attempt with the same link finds nothing
        const consumed = decoded.jti ? await redisClient.del(`pwreset:${decoded.jti}`) : 0;
        if (consumed !== 1) {
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
        req.log.error({ err: error }, 'Reset password error');
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
            where: { token: hashRefreshToken(refreshToken), userId: decoded.userId }
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
        const accessToken = generateAccessToken({ userId: user.id, email: user.email, isVerified: user.isVerified });

        res.json({ accessToken });
    } catch (error) {
        req.log.error({ err: error }, 'Session refresh error');
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
                if (refreshToken && deviceToRemove.token === hashRefreshToken(refreshToken)) {
                    res.clearCookie('refreshToken');
                }
                await deviceToRemove.destroy();
            }
        } else if (refreshToken) {
            // Logout current device
            await RefreshToken.destroy({ where: { token: hashRefreshToken(refreshToken) } });
            res.clearCookie('refreshToken');
        } else {
            // No token found, but let's clear cookie just in case
            res.clearCookie('refreshToken');
        }

        res.json({ message: 'Logout successful' });
    } catch (error) {
        req.log.error({ err: error }, 'Logout error');
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
        req.log.error({ err: error }, 'Get active devices error');
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
        req.log.error({ err: error }, 'Get current user error');
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
        req.log.error({ err: error }, 'Update profile error');
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
        const refreshToken = generateRefreshToken({ userId: user.id });

        // Store refresh token with device info (required for /refresh-token to accept it)
        await RefreshToken.create({
            userId: user.id,
            token: hashRefreshToken(refreshToken),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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

        // Redirect with a short-lived one-time code instead of the access token, so the
        // token never appears in URLs, browser history or logs. The frontend exchanges
        // the code via POST /auth/google/exchange.
        const code = crypto.randomBytes(32).toString('hex');
        await redisClient.set(`oauth_code:${code}`, String(user.id), 'EX', 60);
        res.redirect(`${process.env.FRONTEND_URL}/auth/callback?code=${code}`);
    } catch (error) {
        req.log.error({ err: error }, 'Google callback error');
        res.redirect(`${process.env.FRONTEND_URL}/auth/error`);
    }
};

/**
 * Exchange a one-time OAuth code (from the Google callback redirect) for an access token
 */
const exchangeOAuthCode = async (req, res) => {
    try {
        const { code } = req.body;
        if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) {
            return res.status(400).json({ error: 'Invalid or expired sign-in code' });
        }

        // Read and delete atomically so the code can be used only once
        const [[, userId]] = await redisClient.multi()
            .get(`oauth_code:${code}`)
            .del(`oauth_code:${code}`)
            .exec();
        if (!userId) {
            return res.status(400).json({ error: 'Invalid or expired sign-in code' });
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const accessToken = generateAccessToken({ userId: user.id, email: user.email, isVerified: user.isVerified });

        res.json({
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
        req.log.error({ err: error }, 'OAuth code exchange error');
        res.status(500).json({ error: 'Sign in failed. Please try again.' });
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
        req.log.error({ err: error }, 'Update billing details error');
        res.status(500).json({ error: 'Failed to update billing details' });
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
    exchangeOAuthCode,
    updateBillingDetails,
    updateProfile
};
