import type { Migration } from '@ai-search/platform';

/**
 * refresh_tokens.token now stores a SHA-256 hash (64 hex chars) instead of the raw JWT.
 * Rows holding raw tokens can never match again (and those tokens also lack the `typ`
 * claim now required), so they are removed; affected users simply sign in again.
 */
export const up: Migration = async ({ context: { queryInterface } }) => {
    await queryInterface.sequelize.query('DELETE FROM refresh_tokens WHERE CHAR_LENGTH(token) <> 64');
};

export const down: Migration = async () => {
    // Deleted sessions cannot be restored; nothing to undo.
};
