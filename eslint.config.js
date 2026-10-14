const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: ['**/node_modules/**', '**/uploads/**', '**/coverage/**'],
    },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
        rules: {
            'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_|^next$', caughtErrors: 'none' }],
            'no-console': 'warn',
            eqeqeq: ['error', 'always'],
            'prefer-const': 'error',
            'no-var': 'error',
        },
    },
    {
        // CLI scripts and the dependency-free shared-auth package may print
        files: ['**/scripts/**', 'services/shared-auth/**', 'services/auth-service/generateKeys.js'],
        rules: { 'no-console': 'off' },
    },
];
