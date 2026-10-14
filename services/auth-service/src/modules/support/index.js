/**
 * Support module — public API.
 *
 * Owns: support tickets and their replies.
 * Other modules may only import from this file, never from support internals.
 */
const router = require('./routes');

module.exports = { router };
