import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as platform from '@ai-search/platform';
import { loadConfig } from '../src/config';
import { createApp } from '../src/app';

const servers: Server[] = [];
after(() => servers.forEach((s) => {
    s.closeAllConnections();
    s.close();
}));

const listen = async (server: Server): Promise<number> => {
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
};

test('closing an SSE stream at the gateway closes the upstream connection', async () => {
    let upstreamClosed!: () => void;
    const closed = new Promise<void>((resolve) => { upstreamClosed = resolve; });

    // Fake auth-service stream that never ends on its own
    const upstreamPort = await listen(http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"credits":1}\n\n');
        req.on('close', () => upstreamClosed());
    }));

    const config = loadConfig({
        NODE_ENV: 'test',
        AUTH_SERVICE_URL: `http://127.0.0.1:${upstreamPort}`,
        FILE_UPLOAD_SERVICE_URL: 'http://127.0.0.1:1',
        ALLOWED_ORIGINS: 'http://app.example',
    });
    const gatewayPort = await listen(http.createServer(createApp(config, platform.createLogger('sse-test'))));

    // Client connects, receives the first event, then disconnects
    await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${gatewayPort}/auth/credits/stream`, (res) => {
            res.once('data', () => {
                req.destroy();
                resolve();
            });
        });
        req.on('error', (err) => ((err as NodeJS.ErrnoException).code === 'ECONNRESET' ? undefined : reject(err)));
    });

    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 2000).unref());
    assert.notEqual(await Promise.race([closed, timeout]), 'timeout', 'upstream SSE connection was left open');
});
