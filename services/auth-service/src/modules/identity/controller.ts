import crypto from 'crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import User from './models/User';
import RefreshToken from './models/RefreshToken';
import { hashPassword, comparePassword } from './utils/passwordUtils';
import {
    generateAccessToken,
    generateRefreshToken,
    generateResetToken,
    verifyResetToken,
    verifyRefreshToken,
    hashRefreshToken,
} from './utils/jwtUtils';
import { generateOTP, storeOTP, verifyOTP, deleteOTP, otpExists } from './utils/otpUtils';
import { sendOTPEmail, sendPasswordResetEmail, sendWelcomeEmail } from './emails';
import { currentUser } from './authMiddleware';
import redisClient from '../../shared/config/redis';

/** Handler whose body has been checked by the matching validator chain. */
type Handler<Body = unknown> = RequestHandler<ParamsDictionary, unknown, Body>;

interface SignupBody { email: string; password: string; name?: string }
interface EmailBody { email: string }
interface OtpBody { email: string; otp: string }
interface SigninBody { email: string; password: string }
interface ResetPasswordBody { token: string; newPassword: string }
interface LogoutBody { tokenId?: number | string }
interface ExchangeCodeBody { code?: unknown }

const PROFILE_FIELDS = ['name', 'phone', 'companyName', 'billingAddress', 'city', 'state', 'zipCode', 'country', 'taxId'] as const;
const BILLING_FIELDS = ['companyName', 'billingAddress', 'city', 'state', 'zipCode', 'country', 'taxId'] as const;
type ProfileBody = Partial<Record<(typeof PROFILE_FIELDS)[number], string | null>>;
type BillingBody = Partial<Record<(typeof BILLING_FIELDS)[number], string | null>>;

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TRIAL_MS = 30 * 24 * 60 * 60 * 1000;      // 30 days

/** Fields returned to the client after sign-in style operations. */
const sessionUser = (user: User) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    isVerified: user.isVerified,
    credits: user.credits,
    trialEndsAt: user.trialEndsAt,
    trialWarningDays: user.trialWarningDays,
});

const refreshCookie = (req: Request): string | undefined => {
    const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.refreshToken;
    return typeof value === 'string' && value ? value : undefined;
};

/**
 * Start a device session: store the hashed refresh token with device info and set it
 * as an HttpOnly cookie.
 */
const startSession = async (req: Request, res: Response, userId: number): Promise<void> => {
    const refreshToken = generateRefreshToken({ userId });
    await RefreshToken.create({
        userId,
        token: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        userAgent: req.headers['user-agent'] ?? null,
        ipAddress: req.ip ?? null,
        lastUsedAt: new Date(),
    });
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: SESSION_TTL_MS,
    });
};

const accessTokenFor = (user: User): string =>
    generateAccessToken({ userId: user.id, email: user.email, isVerified: user.isVerified });

/**
 * Signup with email and password
 */
export const signup: Handler<SignupBody> = async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const user = await User.create({
            email,
            password: await hashPassword(password),
            name: name ?? null,
            isVerified: false,
        });

        // Generate, store and send OTP
        const otp = generateOTP();
        await storeOTP(email, otp);
        await sendOTPEmail(email, otp);

        return res.status(201).json({
            message: 'Signup successful. Please verify your email with the OTP sent.',
            userId: user.id,
            email: user.email,
            name: user.name,
        });
    } catch (error) {
        req.log.error({ err: error }, 'Signup error');
        return res.status(500).json({ error: 'Signup failed. Please try again.' });
    }
};

/**
 * Verify OTP
 */
export const verifyOTPController: Handler<OtpBody> = async (req, res) => {
    try {
        const { email, otp } = req.body;

        const isValid = await verifyOTP(email, otp);
        if (!isValid) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.isVerified = true;
        // Grant 30-day free trial on first verification
        if (!user.trialEndsAt) {
            user.trialEndsAt = new Date(Date.now() + TRIAL_MS);
        }
        await user.save();

        await deleteOTP(email);
        await sendWelcomeEmail(email);

        const accessToken = accessTokenFor(user);
        await startSession(req, res, user.id);

        return res.json({
            message: 'Email verified successfully',
            accessToken,
            user: sessionUser(user),
        });
    } catch (error) {
        req.log.error({ err: error }, 'OTP verification error');
        return res.status(500).json({ error: 'Sign in failed. Please try again.' });
    }
};

/**
 * Resend OTP
 */
export const resendOTP: Handler<EmailBody> = async (req, res) => {
    try {
        const { email } = req.body;

        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.isVerified) {
            return res.status(400).json({ error: 'Email already verified' });
        }

        // An unexpired OTP means one was sent recently
        if (await otpExists(email)) {
            return res.status(429).json({ error: 'OTP already sent. Please wait before requesting a new one.' });
        }

        const otp = generateOTP();
        await storeOTP(email, otp);
        await sendOTPEmail(email, otp);

        return res.json({ message: 'OTP sent successfully' });
    } catch (error) {
        req.log.error({ err: error }, 'Resend OTP error');
        return res.status(500).json({ error: 'Failed to resend OTP. Please try again.' });
    }
};

/**
 * Signin with email and password
 */
export const signin: Handler<SigninBody> = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ where: { email } });
        if (!user || !user.password) {
            return res.status(401).json({ error: 'Incorrect email or password' });
        }

        const isPasswordValid = await comparePassword(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Incorrect email or password' });
        }

        if (!user.isVerified) {
            // Resend OTP
            const otp = generateOTP();
            await storeOTP(email, otp);
            await sendOTPEmail(email, otp);

            return res.status(403).json({
                error: 'Email not verified. A new OTP has been sent to your email.',
                requiresVerification: true,
            });
        }

        const accessToken = accessTokenFor(user);
        await startSession(req, res, user.id);

        return res.json({
            message: 'Signin successful',
            accessToken,
            user: sessionUser(user),
        });
    } catch (error) {
        req.log.error({ err: error }, 'Signin error');
        return res.status(500).json({ error: 'Signin failed. Please try again.' });
    }
};

/**
 * Forgot password
 */
export const forgotPassword: Handler<EmailBody> = async (req, res) => {
    try {
        const { email } = req.body;

        const user = await User.findOne({ where: { email } });
        if (!user || !user.password) {
            // Don't reveal if email exists
            return res.json({ message: 'If the email exists, a password reset link has been sent.' });
        }

        // Reset token (JWT, 1 hour). Its jti is stored in Redis so the link can be used only once.
        const { token: resetToken, jti } = generateResetToken({ userId: user.id });
        await redisClient.set(`pwreset:${jti}`, String(user.id), 'EX', 60 * 60);

        await sendPasswordResetEmail(email, resetToken);

        return res.json({ message: 'If the email exists, a password reset link has been sent.' });
    } catch (error) {
        req.log.error({ err: error }, 'Forgot password error');
        return res.status(500).json({ error: 'Failed to process request. Please try again.' });
    }
};

/**
 * Reset password
 */
export const resetPassword: Handler<ResetPasswordBody> = async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        let decoded;
        try {
            decoded = verifyResetToken(token);
        } catch {
            return res.status(400).json({ error: 'Invalid or expired reset link' });
        }

        // Single use: consume the jti; a second attempt with the same link finds nothing
        const consumed = decoded.jti ? await redisClient.del(`pwreset:${decoded.jti}`) : 0;
        if (consumed !== 1) {
            return res.status(400).json({ error: 'Invalid or expired reset link' });
        }

        const user = await User.findByPk(decoded.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.password = await hashPassword(newPassword);
        await user.save();

        // Invalidate all refresh tokens for this user
        await RefreshToken.destroy({ where: { userId: user.id } });

        return res.json({ message: 'Password reset successful. Please sign in with your new password.' });
    } catch (error) {
        req.log.error({ err: error }, 'Reset password error');
        return res.status(500).json({ error: 'Failed to reset password. Please try again.' });
    }
};

/**
 * Refresh access token
 */
export const refreshAccessToken: Handler = async (req, res) => {
    try {
        const refreshToken = refreshCookie(req);
        if (!refreshToken) {
            return res.status(401).json({ error: 'Please sign in to continue' });
        }

        let decoded;
        try {
            decoded = verifyRefreshToken(refreshToken);
        } catch {
            return res.status(401).json({ error: 'Session expired, please sign in again' });
        }

        // The session must still exist (logout and password reset delete it)
        const tokenRecord = await RefreshToken.findOne({
            where: { token: hashRefreshToken(refreshToken), userId: decoded.userId },
        });
        if (!tokenRecord) {
            return res.status(401).json({ error: 'Session invalid, please sign in again' });
        }

        if (new Date() > tokenRecord.expiresAt) {
            await tokenRecord.destroy();
            res.clearCookie('refreshToken');
            return res.status(401).json({ error: 'Session expired, please sign in again' });
        }

        const user = await User.findByPk(decoded.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json({ accessToken: accessTokenFor(user) });
    } catch (error) {
        req.log.error({ err: error }, 'Session refresh error');
        return res.status(500).json({ error: 'Session expired, please sign in again' });
    }
};

/**
 * Logout the current device (refresh cookie), or another device by tokenId (requires auth).
 */
export const logout: Handler<LogoutBody> = async (req, res) => {
    try {
        const { tokenId } = req.body ?? {};
        const refreshToken = refreshCookie(req);

        if (tokenId) {
            // Logout a specific device (e.g. from the profile page); clear the cookie too
            // if that device is the current one
            const deviceToRemove = await RefreshToken.findOne({
                where: { id: Number(tokenId), userId: currentUser(req).userId },
            });
            if (deviceToRemove) {
                if (refreshToken && deviceToRemove.token === hashRefreshToken(refreshToken)) {
                    res.clearCookie('refreshToken');
                }
                await deviceToRemove.destroy();
            }
        } else if (refreshToken) {
            await RefreshToken.destroy({ where: { token: hashRefreshToken(refreshToken) } });
            res.clearCookie('refreshToken');
        } else {
            // No token found, but clear the cookie just in case
            res.clearCookie('refreshToken');
        }

        return res.json({ message: 'Logout successful' });
    } catch (error) {
        req.log.error({ err: error }, 'Logout error');
        return res.status(500).json({ error: 'Logout failed. Please try again.' });
    }
};

/**
 * Get active devices (sessions)
 */
export const getActiveDevices: Handler = async (req, res) => {
    try {
        const devices = await RefreshToken.findAll({
            where: { userId: currentUser(req).userId },
            attributes: ['id', 'userAgent', 'ipAddress', 'lastUsedAt', 'createdAt'],
            order: [['lastUsedAt', 'DESC']],
        });
        return res.json({ devices });
    } catch (error) {
        req.log.error({ err: error }, 'Get active devices error');
        return res.status(500).json({ error: 'Failed to fetch active devices' });
    }
};

/**
 * Get current user
 */
export const getCurrentUser: Handler = async (req, res) => {
    try {
        const user = await User.findByPk(currentUser(req).userId, {
            attributes: [
                'id', 'email', 'name', 'phone', 'isVerified', 'googleId', 'createdAt',
                'companyName', 'billingAddress', 'city', 'state', 'zipCode', 'country', 'taxId',
                'credits', 'trialEndsAt', 'trialWarningDays',
            ],
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        return res.json({ user });
    } catch (error) {
        req.log.error({ err: error }, 'Get current user error');
        return res.status(500).json({ error: 'Failed to fetch account data' });
    }
};

/**
 * Update user profile (personal and billing info); only fields present in the body change
 */
export const updateProfile: Handler<ProfileBody> = async (req, res) => {
    try {
        const user = await User.findByPk(currentUser(req).userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        for (const field of PROFILE_FIELDS) {
            const value = req.body[field];
            if (value !== undefined) user[field] = value;
        }
        await user.save();

        return res.json({
            message: 'Profile updated successfully',
            user: {
                ...sessionUser(user),
                phone: user.phone,
                companyName: user.companyName,
                billingAddress: user.billingAddress,
                city: user.city,
                state: user.state,
                zipCode: user.zipCode,
                country: user.country,
                taxId: user.taxId,
            },
        });
    } catch (error) {
        req.log.error({ err: error }, 'Update profile error');
        return res.status(500).json({ error: 'Failed to update profile' });
    }
};

/**
 * Google OAuth callback handler (req.user set by the passport strategy)
 */
export const googleCallback: Handler = async (req, res) => {
    try {
        const user = await User.findByPk(currentUser(req).userId);
        if (!user) {
            return res.redirect(`${process.env.FRONTEND_URL}/auth/error`);
        }

        // Grant 30-day free trial on first Google sign-in
        if (!user.trialEndsAt) {
            user.trialEndsAt = new Date(Date.now() + TRIAL_MS);
            await user.save();
        }

        await startSession(req, res, user.id);

        // Redirect with a short-lived one-time code instead of the access token, so the
        // token never appears in URLs, browser history or logs. The frontend exchanges
        // the code via POST /auth/google/exchange.
        const code = crypto.randomBytes(32).toString('hex');
        await redisClient.set(`oauth_code:${code}`, String(user.id), 'EX', 60);
        return res.redirect(`${process.env.FRONTEND_URL}/auth/callback?code=${code}`);
    } catch (error) {
        req.log.error({ err: error }, 'Google callback error');
        return res.redirect(`${process.env.FRONTEND_URL}/auth/error`);
    }
};

/**
 * Exchange a one-time OAuth code (from the Google callback redirect) for an access token
 */
export const exchangeOAuthCode: Handler<ExchangeCodeBody> = async (req, res) => {
    try {
        const { code } = req.body ?? {};
        if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) {
            return res.status(400).json({ error: 'Invalid or expired sign-in code' });
        }

        // Read and delete atomically so the code can be used only once
        const results = await redisClient.multi()
            .get(`oauth_code:${code}`)
            .del(`oauth_code:${code}`)
            .exec();
        const userId = results?.[0]?.[1];
        if (typeof userId !== 'string' || !userId) {
            return res.status(400).json({ error: 'Invalid or expired sign-in code' });
        }

        const user = await User.findByPk(Number(userId));
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json({ accessToken: accessTokenFor(user), user: sessionUser(user) });
    } catch (error) {
        req.log.error({ err: error }, 'OAuth code exchange error');
        return res.status(500).json({ error: 'Sign in failed. Please try again.' });
    }
};

/**
 * Update billing details; replaces the whole billing block (missing fields are cleared)
 */
export const updateBillingDetails: Handler<BillingBody> = async (req, res) => {
    try {
        const user = await User.findByPk(currentUser(req).userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        for (const field of BILLING_FIELDS) {
            user[field] = req.body[field] ?? null;
        }
        await user.save();

        const { isVerified: _omit, ...base } = sessionUser(user);
        return res.json({
            message: 'Billing details updated successfully',
            user: {
                ...base,
                companyName: user.companyName,
                billingAddress: user.billingAddress,
                city: user.city,
                state: user.state,
                zipCode: user.zipCode,
                country: user.country,
                taxId: user.taxId,
            },
        });
    } catch (error) {
        req.log.error({ err: error }, 'Update billing details error');
        return res.status(500).json({ error: 'Failed to update billing details' });
    }
};
