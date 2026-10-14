import { cleanEnv, str, port, url, num, makeValidator } from 'envalid';
import { configReporter } from '@ai-search/platform';

const origins = makeValidator<string[]>((value) => {
    const list = value.split(',').map((o) => o.trim()).filter(Boolean);
    if (!list.length) throw new Error('must list at least one origin');
    list.forEach((o) => new URL(o)); // throws on an invalid origin
    return list;
});

/**
 * Validated gateway configuration. Fails fast at startup with a clear message
 * instead of running with missing or malformed settings.
 */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env) => cleanEnv(env, {
    NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'development' }),
    PORT: port({ default: 5000 }),
    AUTH_SERVICE_URL: url({ devDefault: 'http://localhost:5001' }),
    FILE_UPLOAD_SERVICE_URL: url({ devDefault: 'http://localhost:5005' }),
    ALLOWED_ORIGINS: origins({ devDefault: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'] }),
    // Hops in front of the gateway (e.g. 1 behind a cloud load balancer). 0 = trust nothing.
    TRUST_PROXY: str({ default: '0' }),
    RATE_LIMIT_PER_MINUTE: num({ default: 300 }),
    PROXY_TIMEOUT_MS: num({ default: 30000 }),
}, { reporter: configReporter('gateway') });

export type GatewayConfig = ReturnType<typeof loadConfig>;
