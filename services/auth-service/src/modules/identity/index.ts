/**
 * Identity module — public API.
 *
 * Owns: users (credentials, profile, verification, trial), refresh tokens/sessions,
 * OTP, password reset, Google OAuth, JWT signing.
 *
 * Other modules may only import from this file, never from identity internals.
 * Note: users.credits is owned by the billing module. Identity may read it for
 * responses but must never write it.
 */
import './types';

export { default as router } from './routes';
export { default as passport } from './passport';
export { authenticate, requireVerified, currentUser } from './authMiddleware';
export type { AuthUser } from './types';
