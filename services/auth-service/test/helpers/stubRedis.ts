/**
 * In-memory stand-in for the ioredis client, for unit tests that must not need Redis.
 * Covers the commands the service uses, plus the rate-limit-redis script calls.
 */
import path from 'path';
import { replaceModule } from './stub';

type Value = string | number;

export const createStubRedis = () => {
    const store = new Map<string, string>();
    const hits = new Map<string, number>();

    const stub = {
        store,
        async get(k: string) { return store.get(k) ?? null; },
        async set(k: string, v: Value) { store.set(k, String(v)); return 'OK'; },
        async setex(k: string, _ttl: number, v: Value) { store.set(k, String(v)); return 'OK'; },
        async incr(k: string) { const v = (Number(store.get(k)) || 0) + 1; store.set(k, String(v)); return v; },
        async expire() { return 1; },
        async exists(k: string) { return store.has(k) ? 1 : 0; },
        async del(...keys: string[]) { return keys.filter((k) => store.delete(k)).length; },
        async publish() { return 0; },
        async ping() { return 'PONG'; },
        async quit() { return 'OK'; },
        status: 'ready',
        disconnect() { /* no-op */ },
        on() { return stub; },
        duplicate() { return { on() { return this; }, subscribe: async () => 1, quit: async () => 'OK' }; },
        multi() {
            const ops: Array<[string, unknown[]]> = [];
            const chain: Record<string, unknown> = new Proxy({}, {
                get: (_target, name: string) => (name === 'exec'
                    ? async () => Promise.all(ops.map(async ([op, args]) => {
                        const fn = (stub as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[op];
                        return [null, await fn!(...args)];
                    }))
                    : (...args: unknown[]) => { ops.push([name, args]); return chain; }),
            });
            return chain;
        },
        // rate-limit-redis: SCRIPT LOAD returns a sha; EVALSHA returns [hits, msUntilReset]
        async call(command: string, ...args: string[]) {
            if (command === 'SCRIPT') return 'stub-sha';
            if (command === 'EVALSHA') {
                const key = args[2] ?? '';
                const n = (hits.get(key) ?? 0) + 1;
                hits.set(key, n);
                return [n, 60000];
            }
            return null;
        },
    };
    return stub;
};

/** Replace src/shared/config/redis in the require cache. Call before loading app code. */
export const installStubRedis = () => {
    const stub = createStubRedis();
    replaceModule(path.join(__dirname, '../../src/shared/config/redis'), { __esModule: true, default: stub });
    return stub;
};
