/**
 * Billing module — public API.
 *
 * Owns: payment orders and transactions (Razorpay), the credit balance.
 * Other modules may only import from this file, never from billing internals.
 */
export { default as router } from './routes';
export { getBalance } from './credits';
