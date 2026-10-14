/**
 * In-memory stand-in for the ioredis client, for unit tests that must not need Redis.
 * Covers the commands the service uses, plus the rate-limit-redis script calls.
 */
const SRC = require('path').join(__dirname, '../../src');

const createStubRedis = () => {
    const store = new Map();
    const hits = new Map();
    const stub = {
        store,
        async get(k) { return store.has(k) ? store.get(k) : null; },
        async set(k, v) { store.set(k, String(v)); return 'OK'; },
        async setex(k, ttl, v) { store.set(k, String(v)); return 'OK'; },
        async incr(k) { const v = (Number(store.get(k)) || 0) + 1; store.set(k, String(v)); return v; },
        async expire() { return 1; },
        async exists(k) { return store.has(k) ? 1 : 0; },
        async del(...keys) { return keys.filter((k) => store.delete(k)).length; },
        async publish() { return 0; },
        async ping() { return 'PONG'; },
        async quit() { return 'OK'; },
        on() { return stub; },
        duplicate() { return { on() {}, subscribe() {}, quit: async () => 'OK' }; },
        multi() {
            const ops = [];
            const chain = new Proxy({}, {
                get: (_, name) => (name === 'exec'
                    ? async () => Promise.all(ops.map(([op, args]) => stub[op](...args).then((r) => [null, r])))
                    : (...args) => { ops.push([name, args]); return chain; }),
            });
            return chain;
        },
        // rate-limit-redis: SCRIPT LOAD returns a sha; EVALSHA returns [hits, msUntilReset]
        async call(command, ...args) {
            if (command === 'SCRIPT') return 'stub-sha';
            if (command === 'EVALSHA') {
                const key = args[2];
                const n = (hits.get(key) || 0) + 1;
                hits.set(key, n);
                return [n, 60000];
            }
            return null;
        },
    };
    return stub;
};

/** Replace src/shared/config/redis in the require cache. Call before loading the app. */
const installStubRedis = () => {
    const stub = createStubRedis();
    const file = require.resolve(`${SRC}/shared/config/redis`);
    require.cache[file] = { id: file, filename: file, loaded: true, exports: stub };
    return stub;
};

module.exports = { createStubRedis, installStubRedis };
