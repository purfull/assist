/**
 * Notifications module — public API.
 *
 * Owns: user notifications and the real-time SSE stream (credits + notifications).
 * Reacts to events (shared/events.js) rather than being called by other modules.
 * Other modules may only import from this file, never from notifications internals.
 */
export { default as router } from './routes';
