import { body } from 'express-validator';
import { handleValidationErrors } from '../../shared/middleware/validate';

/**
 * Validation rules for signup
 */
export const validateSignup = [
    body('email')
        .isEmail()
        .withMessage('Please provide a valid email')
        .normalizeEmail(),
    body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    handleValidationErrors
];

/**
 * Validation rules for signin
 */
export const validateSignin = [
    body('email')
        .isEmail()
        .withMessage('Please provide a valid email')
        .normalizeEmail(),
    body('password')
        .notEmpty()
        .withMessage('Password is required'),
    handleValidationErrors
];

/**
 * Validation rules for OTP verification
 */
export const validateOTP = [
    body('email')
        .isEmail()
        .withMessage('Please provide a valid email')
        .normalizeEmail(),
    body('otp')
        .isLength({ min: 6, max: 6 })
        .withMessage('OTP must be 6 digits')
        .isNumeric()
        .withMessage('OTP must contain only numbers'),
    handleValidationErrors
];

/**
 * Validation rules for resending an OTP (email only — the caller has no OTP yet)
 */
export const validateResendOTP = [
    body('email')
        .isEmail()
        .withMessage('Please provide a valid email')
        .normalizeEmail(),
    handleValidationErrors
];

/**
 * Validation rules for forgot password
 */
export const validateForgotPassword = [
    body('email')
        .isEmail()
        .withMessage('Please provide a valid email')
        .normalizeEmail(),
    handleValidationErrors
];

/**
 * Validation rules for reset password
 */
export const validateResetPassword = [
    body('token')
        .notEmpty()
        .withMessage('Reset token is required'),
    body('newPassword')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    handleValidationErrors
];

/**
 * Validation rules for profile and billing details (all fields optional strings)
 */
const PROFILE_FIELD_LIMITS: Record<string, number> = {
    name: 100,
    phone: 32,
    companyName: 200,
    billingAddress: 255,
    city: 100,
    state: 100,
    zipCode: 20,
    country: 100,
    taxId: 50
};

const optionalText = (field: string, max: number) => body(field)
    .optional({ values: 'null' })
    .isString().withMessage(`${field} must be a string`)
    .trim()
    .isLength({ max }).withMessage(`${field} must be at most ${max} characters`);

export const validateProfile = [
    ...Object.entries(PROFILE_FIELD_LIMITS).map(([field, max]) => optionalText(field, max)),
    handleValidationErrors
];

export const validateBillingDetails = [
    ...Object.entries(PROFILE_FIELD_LIMITS)
        .filter(([field]) => !['name', 'phone'].includes(field))
        .map(([field, max]) => optionalText(field, max)),
    handleValidationErrors
];

