// @ts-check
const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
    {
        ignores: ['**/node_modules/**', '**/dist/**', '**/uploads/**', '**/coverage/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...globals.node },
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['eslint.config.js'],
                },
                tsconfigRootDir: __dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
            '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
            // Express 4 doesn't await handlers. Every async handler here catches its own
            // errors (try/catch → response or next(err)), so passing them where Express
            // expects a void callback is intentional.
            '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false, variables: false } }],
            '@typescript-eslint/no-floating-promises': ['error', {
                // node:test's test()/describe() return promises the runner itself tracks
                allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'describe', 'it', 'suite'] }],
            }],
            'no-console': 'warn',
            eqeqeq: ['error', 'always'],
            'prefer-const': 'error',
            'no-var': 'error',
        },
    },
    {
        // Tests assert on untyped HTTP response bodies (supertest's res.body is any)
        files: ['**/test/**/*.ts'],
        rules: {
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/require-await': 'off',
        },
    },
    {
        // CLI scripts and the dependency-free shared-auth package print directly
        files: ['**/scripts/**', 'services/shared-auth/**'],
        rules: { 'no-console': 'off' },
    },
    {
        files: ['eslint.config.js'],
        ...tseslint.configs.disableTypeChecked,
        languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
        rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
);
