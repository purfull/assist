const express = require('express');
const passport = require('./passport');
const { getPublicKey, getJwks } = require('./utils/jwtUtils');
const {
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
} = require('./controller');
const { authenticate } = require('./authMiddleware');
const { authLimiter, otpLimiter } = require('../../shared/middleware/rateLimiter');
const {
    validateSignup,
    validateSignin,
    validateOTP,
    validateResendOTP,
    validateForgotPassword,
    validateResetPassword,
    validateProfile,
    validateBillingDetails
} = require('./validator');

const router = express.Router();

// Public Key for external services
router.get('/public-key', (req, res) => {
    res.json({ publicKey: getPublicKey() });
});

// Standard JWKS for verifiers (shared-auth uses this when JWT_JWKS_URL is set)
router.get('/.well-known/jwks.json', (req, res) => {
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
const authenticateIfRevokingDevice = (req, res, next) =>
    (req.body && req.body.tokenId ? authenticate(req, res, next) : next());
router.post('/logout', authenticateIfRevokingDevice, logout);

// Google OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/auth/error` }),
    googleCallback
);
// Exchange the one-time code from the OAuth redirect for an access token
router.post('/google/exchange', authLimiter, exchangeOAuthCode);

// Protected Routes
router.get('/me', authenticate, getCurrentUser);
router.get('/devices', authenticate, getActiveDevices);
router.post('/billing-details', authenticate, validateBillingDetails, updateBillingDetails);
router.put('/profile', authenticate, validateProfile, updateProfile);

module.exports = router;

