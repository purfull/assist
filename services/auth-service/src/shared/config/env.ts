import { cleanEnv, str, port, url, num, bool } from 'envalid';
import { configReporter } from '@ai-search/platform';

/**
 * Validate auth-service configuration at startup so a missing secret or bad value
 * fails immediately with a clear message, instead of surfacing later as a 500.
 *
 * Code still reads process.env directly; this is the single place that defines
 * which settings exist and which are required.
 */
export const validateEnv = (env: NodeJS.ProcessEnv = process.env) => {
    const config = cleanEnv(env, {
        NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'development' }),
        PORT: port({ default: 5001 }),
        LOG_LEVEL: str({ choices: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], default: 'info' }),
        TRUST_PROXY: str({ default: '1' }),
        MIGRATE_ON_START: bool({ default: false }),

        DB_HOST: str(),
        DB_PORT: port({ default: 3306 }),
        DB_NAME: str(),
        DB_USER: str(),
        DB_PASSWORD: str({ default: '' }),

        REDIS_HOST: str({ default: 'localhost' }),
        REDIS_PORT: port({ default: 6379 }),
        REDIS_PASSWORD: str({ default: '' }),

        // Either the PEM itself or a path; checked below
        JWT_PRIVATE_KEY: str({ default: '' }),
        JWT_PRIVATE_KEY_PATH: str({ default: '' }),
        JWT_PUBLIC_KEY: str({ default: '' }),
        JWT_PUBLIC_KEY_PATH: str({ default: '' }),
        JWT_ISSUER: str({ default: 'ai-search-auth' }),
        JWT_AUDIENCE: str({ default: 'ai-search' }),
        JWT_ACCESS_EXPIRY: str({ default: '15m' }),
        JWT_REFRESH_EXPIRY: str({ default: '7d' }),

        FRONTEND_URL: url(),

        MAIL_TRANSPORT: str({ choices: ['mailgun', 'log'], default: 'mailgun' }),
        MAILGUN_API_KEY: str({ default: '' }),
        MAILGUN_DOMAIN: str({ default: '' }),
        MAILGUN_FROM_EMAIL: str({ default: 'no-reply@keepmystore.com' }),

        GOOGLE_CLIENT_ID: str(),
        GOOGLE_CLIENT_SECRET: str(),
        GOOGLE_CALLBACK_URL: url(),

        RAZORPAY_KEY_ID: str(),
        RAZORPAY_KEY_SECRET: str(),

        INTERNAL_SERVICE_TOKEN: str({ default: '' }),
        KEY_SECRET: str({ default: '' }),

        OTP_EXPIRY_MINUTES: num({ default: 5 }),
        OTP_LENGTH: num({ default: 6 }),
        OTP_MAX_ATTEMPTS: num({ default: 5 }),
    }, { reporter: configReporter('auth-service') });

    const problems: string[] = [];
    if (config.NODE_ENV === 'production') {
        if (!config.JWT_PRIVATE_KEY && !config.JWT_PRIVATE_KEY_PATH) problems.push('JWT_PRIVATE_KEY or JWT_PRIVATE_KEY_PATH is required');
        if (!config.JWT_PUBLIC_KEY && !config.JWT_PUBLIC_KEY_PATH) problems.push('JWT_PUBLIC_KEY or JWT_PUBLIC_KEY_PATH is required');
        if (config.INTERNAL_SERVICE_TOKEN.length < 32) problems.push('INTERNAL_SERVICE_TOKEN must be at least 32 characters');
        if (config.MAIL_TRANSPORT !== 'mailgun') problems.push('MAIL_TRANSPORT must be "mailgun" in production');
    }
    if (config.MAIL_TRANSPORT === 'mailgun' && (!config.MAILGUN_API_KEY || !config.MAILGUN_DOMAIN)) {
        problems.push('MAILGUN_API_KEY and MAILGUN_DOMAIN are required when MAIL_TRANSPORT=mailgun');
    }
    if (problems.length) {
        throw new Error(`Invalid auth-service configuration: ${problems.join('; ')}`);
    }

    return config;
};

export type AuthConfig = ReturnType<typeof validateEnv>;
