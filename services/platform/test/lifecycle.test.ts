import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { DataTypes, Sequelize } from 'sequelize';
import * as platform from '../src';

const logger = platform.createLogger('platform-test');

// ── Graceful shutdown ────────────────────────────────────────────────────────

const realExit = process.exit.bind(process);
afterEach(() => {
    process.exit = realExit;
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
});

/** Replace process.exit for the test; resolves with the exit code instead of exiting. */
const captureExit = (): Promise<number | undefined> => new Promise((resolve) => {
    process.exit = ((code?: number) => { resolve(code); }) as typeof process.exit;
});

test('SIGTERM stops the server, runs shutdown hooks in order and exits 0', async () => {
    const order: string[] = [];
    const server = platform.startServer({
        app: express(),
        port: 0,
        logger,
        onShutdown: [
            async () => { order.push('events'); },
            () => { order.push('redis'); throw new Error('already closed'); }, // a failing hook doesn't stop the rest
            async () => { order.push('db'); },
        ],
    });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const exited = captureExit();

    process.emit('SIGTERM', 'SIGTERM');

    assert.equal(await exited, 0);
    assert.deepEqual(order, ['events', 'redis', 'db']);
    assert.equal(server.listening, false);
});

test('a second signal during shutdown is ignored', async () => {
    let hookRuns = 0;
    const server = platform.startServer({ app: express(), port: 0, logger, onShutdown: [() => { hookRuns++; }] });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const exited = captureExit();
    process.emit('SIGINT', 'SIGINT');
    process.emit('SIGTERM', 'SIGTERM');
    await exited;
    assert.equal(hookRuns, 1);
});

test('setTrustProxy accepts hop counts and named values', () => {
    const app = express();
    process.env.TRUST_PROXY = '2';
    platform.setTrustProxy(app);
    assert.equal(app.get('trust proxy'), 2);
    process.env.TRUST_PROXY = 'loopback';
    platform.setTrustProxy(app);
    assert.equal(app.get('trust proxy'), 'loopback');
    delete process.env.TRUST_PROXY;
    platform.setTrustProxy(app, '1');
    assert.equal(app.get('trust proxy'), 1);
});

// ── Migration loading (no database needed: listing and running don't touch storage) ──

test('migrations: .ts and .js files are found, .d.ts ignored, names recorded as .js', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
    const seen: unknown[] = [];
    (globalThis as Record<string, unknown>).__migrationSeen = seen;
    fs.writeFileSync(path.join(dir, '001-first.ts'),
        'export const up = async ({ context }) => { globalThis.__migrationSeen.push(["up", typeof context.DataTypes.STRING]); };\n' +
        'export const down = async () => { globalThis.__migrationSeen.push(["down"]); };\n');
    fs.writeFileSync(path.join(dir, '001-first.d.ts'), 'export {};\n');
    fs.writeFileSync(path.join(dir, '002-second.js'),
        'exports.up = async () => { globalThis.__migrationSeen.push(["up2"]); };\nexports.down = async () => undefined;\n');

    // Never connects: Umzug only lists and runs files here
    const sequelize = new Sequelize('mysql://user:pass@127.0.0.1:1/never');
    const migrator = platform.createMigrator({ sequelize, dir, tableName: 'migrations_test', logger });
    const context = { queryInterface: sequelize.getQueryInterface(), DataTypes };
    const migrations = await migrator.migrations(context);

    assert.deepEqual(migrations.map((m) => m.name), ['001-first.js', '002-second.js']);
    await migrations[0]?.up({ name: '001-first.js', context });
    await migrations[0]?.down?.({ name: '001-first.js', context });
    assert.deepEqual(seen, [['up', 'function'], ['down']]);
    await sequelize.close();
});

test('configReporter names every bad setting and says "missing" for absent ones', async () => {
    const { cleanEnv, str, port } = await import('envalid');
    assert.throws(
        () => cleanEnv({ PORT: 'abc' }, { NAME: str(), PORT: port() }, { reporter: platform.configReporter('svc') }),
        /Invalid svc configuration: NAME \(missing\), PORT \(Invalid port input: "abc"\)/,
    );
});
