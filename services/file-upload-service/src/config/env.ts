import { cleanEnv, str, port, num, bool } from 'envalid';
import { configReporter } from '@ai-search/platform';

/**
 * Validate file-upload-service configuration at startup (fail fast on missing settings).
 * Code still reads process.env directly; this defines which settings exist.
 */
export const validateEnv = (env: NodeJS.ProcessEnv = process.env) => {
    const config = cleanEnv(env, {
        NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'development' }),
        PORT: port({ default: 5005 }),
        LOG_LEVEL: str({ choices: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], default: 'info' }),
        TRUST_PROXY: str({ default: '1' }),
        MIGRATE_ON_START: bool({ default: false }),

        DB_HOST: str(),
        DB_PORT: port({ default: 3306 }),
        DB_NAME: str(),
        DB_USER: str(),
        DB_PASSWORD: str({ default: '' }),

        JWT_JWKS_URL: str({ default: '' }),
        JWT_PUBLIC_KEY: str({ default: '' }),
        JWT_PUBLIC_KEY_PATH: str({ default: '' }),
        JWT_ISSUER: str({ default: 'ai-search-auth' }),
        JWT_AUDIENCE: str({ default: 'ai-search' }),

        UPLOAD_DIR: str({ default: 'uploads' }),
        MAX_FILE_SIZE_MB: num({ default: 10 }),
        ALLOWED_MIME_TYPES: str({ default: '' }),
    }, { reporter: configReporter('file-upload-service') });

    if (config.NODE_ENV === 'production' && !config.JWT_JWKS_URL && !config.JWT_PUBLIC_KEY && !config.JWT_PUBLIC_KEY_PATH) {
        throw new Error('Invalid file-upload-service configuration: set JWT_JWKS_URL (preferred), JWT_PUBLIC_KEY or JWT_PUBLIC_KEY_PATH');
    }
    return config;
};

export type FileServiceConfig = ReturnType<typeof validateEnv>;
