import { Router, type RequestHandler } from 'express';
import passport from './passport';
import { getPublicKey, getJwks } from './utils/jwtUtils';
import {
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
    updateProfile,
} from './controller';
import { authenticate } from './authMiddleware';
import { authLimiter, otpLimiter } from '../../shared/middleware/rateLimiter';
import {
    validateSignup,
    validateSignin,
    validateOTP,
    validateResendOTP,
    validateForgotPassword,
    validateResetPassword,
    validateProfile,
    validateBillingDetails,
} from './validator';

const router = Router();

// Public Key for external services
router.get('/public-key', (_req, res) => {
    res.json({ publicKey: getPublicKey() });
});

// Standard JWKS for verifiers (shared-auth uses this when JWT_JWKS_URL is set)
router.get('/.well-known/jwks.json', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(getJwks());
});

// Email/Password Authentication
router.post('/signup', authLimiter, validateSignup, signup);
router.post('/signin', authLimiter, validateSignin, signin);

// OTP Verification
router.post('/verify-otp', otpLimiter, validateOTP, verifyOTPController);
router.post('/resend-otp', otpLimiter, validateResendOTP, resendOTP);

// Password Reset
router.post('/forgot-password', authLimiter, validateForgotPassword, forgotPassword);
router.post('/reset-password', authLimiter, validateResetPassword, resetPassword);

// Token Management
router.post('/refresh-token', refreshAccessToken);
// Logging out the current device only needs the refresh cookie (works with an expired access token).
// Revoking another device by tokenId requires an authenticated session.
const authenticateIfRevokingDevice: RequestHandler = (req, res, next) => {
    if ((req.body as { tokenId?: unknown } | undefined)?.tokenId) {
        void authenticate(req, res, next);
        return;
    }
    next();
};
router.post('/logout', authenticateIfRevokingDevice, logout);

// Google OAuth
// passport.authenticate() is typed as returning any; it returns Express middleware
const startGoogleLogin = passport.authenticate('google', { scope: ['profile', 'email'] }) as RequestHandler;
const finishGoogleLogin = passport.authenticate('google', {
    session: false,
    failureRedirect: `${process.env.FRONTEND_URL}/auth/error`,
}) as RequestHandler;
router.get('/google', startGoogleLogin);
router.get('/google/callback', finishGoogleLogin, googleCallback);
// Exchange the one-time code from the OAuth redirect for an access token
router.post('/google/exchange', authLimiter, exchangeOAuthCode);

// Protected Routes
router.get('/me', authenticate, getCurrentUser);
router.get('/devices', authenticate, getActiveDevices);
router.post('/billing-details', authenticate, validateBillingDetails, updateBillingDetails);
router.put('/profile', authenticate, validateProfile, updateProfile);

export default router;

