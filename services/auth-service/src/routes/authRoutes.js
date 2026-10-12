const express = require('express');
const passport = require('../config/passport');
const { getPublicKey } = require('../utils/jwtUtils');
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
    updateBillingDetails,
    updateProfile,
    streamUserCredits,
    getNotifications,
    markAsRead,
    createNotification
} = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const {
    validateSignup,
    validateSignin,
    validateOTP,
    validateForgotPassword,
    validateResetPassword
} = require('../middleware/validator');

const router = express.Router();

// Public Key for external services
router.get('/public-key', (req, res) => {
    res.json({ publicKey: getPublicKey() });
});

// SSE Stream for Real-time Credits
router.get('/credits/stream', authenticate, streamUserCredits);

// Email/Password Authentication
router.post('/signup', authLimiter, validateSignup, signup);
router.post('/signin', authLimiter, validateSignin, signin);

// OTP Verification
router.post('/verify-otp', otpLimiter, validateOTP, verifyOTPController);
router.post('/resend-otp', otpLimiter, validateOTP, resendOTP);

// Password Reset
router.post('/forgot-password', authLimiter, validateForgotPassword, forgotPassword);
router.post('/reset-password', authLimiter, validateResetPassword, resetPassword);

// Token Management
router.post('/refresh-token', refreshAccessToken);
router.post('/logout', logout);

// Google OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/auth/error` }),
    googleCallback
);

// Protected Routes
router.get('/me', authenticate, getCurrentUser);
router.get('/devices', authenticate, getActiveDevices);
router.post('/billing-details', authenticate, updateBillingDetails);
router.put('/profile', authenticate, updateProfile);

// Notifications
router.get('/notifications', authenticate, getNotifications);
router.post('/notifications', authenticate, createNotification);
router.put('/notifications/:id/read', authenticate, markAsRead);


module.exports = router;

