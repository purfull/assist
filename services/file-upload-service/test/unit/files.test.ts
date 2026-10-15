/**
 * Download, replace and delete with the database faked: ownership, missing files, content
 * checks on replace, and cleanup so no orphaned files are left on disk.
 */
import { uploadDir, accessToken, SAMPLES } from '../env';
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import type { Application } from 'express';
import request from 'supertest';
import { sequelize } from '../../src/config/database';
import FileRecord from '../../src/models/FileRecord';
import { createApp } from '../../src/app';

const OWNER = 7;
const owner = `Bearer ${accessToken(OWNER)}`;
const stranger = `Bearer ${accessToken(8)}`;
const FILE_ID = '0b5e1d7c-6a2f-4c3e-9d8b-1f2e3d4c5b6a';

const restorers: Array<() => void> = [];
const fake = (target: object, key: string, impl: unknown): void => {
    const holder = target as Record<string, unknown>;
    const original = holder[key];
    holder[key] = impl;
    restorers.push(() => { holder[key] = original; });
};

interface FakeRecord {
    id: string; uploadedBy: number; path: string; mimeType: string; size: number; originalName: string;
    storedName: string; createdAt: Date; updatedAt: Date;
    destroyed: boolean; update: (v: Partial<FakeRecord>) => Promise<FakeRecord>; destroy: () => Promise<void>;
}

/** Write a real file under the upload dir and a fake record pointing at it. */
const storedFile = (content: Buffer = SAMPLES.pdf, uploadedBy = OWNER): FakeRecord => {
    const dir = path.join(uploadDir, String(uploadedBy));
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, `stored-${Date.now()}-${Math.random()}.pdf`);
    fs.writeFileSync(abs, content);
    const record: FakeRecord = {
        id: FILE_ID, uploadedBy, path: path.relative(process.cwd(), abs), mimeType: 'application/pdf',
        size: content.length, originalName: 'report.pdf', storedName: path.basename(abs),
        createdAt: new Date(), updatedAt: new Date(), destroyed: false,
        update: async (v) => Object.assign(record, v),
        destroy: async () => { record.destroyed = true; },
    };
    return record;
};

const ownerFiles = (): string[] => {
    const dir = path.join(uploadDir, String(OWNER));
    return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

let app: Application;
before(() => {
    fake(sequelize, 'authenticate', async () => undefined);
    app = createApp();
});
beforeEach(() => fs.rmSync(path.join(uploadDir, String(OWNER)), { recursive: true, force: true }));
afterEach(() => { while (restorers.length > 1) restorers.pop()?.(); });

test('download streams the bytes with download headers', async () => {
    const record = storedFile();
    fake(FileRecord, 'findByPk', async () => record);
    const res = await request(app).get(`/files/${FILE_ID}`).set('Authorization', owner).buffer(true)
        .parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    assert.equal(res.status, 200);
    assert.ok((res.body as Buffer).equals(SAMPLES.pdf));
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.match(res.headers['content-disposition'] ?? '', /^attachment; filename="report\.pdf"$/);
});

test('download: unknown file 404, someone else\'s 403, missing on disk 410', async () => {
    fake(FileRecord, 'findByPk', async () => null);
    assert.equal((await request(app).get(`/files/${FILE_ID}`).set('Authorization', owner)).status, 404);

    const record = storedFile();
    fake(FileRecord, 'findByPk', async () => record);
    assert.equal((await request(app).get(`/files/${FILE_ID}`).set('Authorization', stranger)).status, 403);

    fs.unlinkSync(path.resolve(record.path));
    assert.equal((await request(app).get(`/files/${FILE_ID}`).set('Authorization', owner)).status, 410);
});

test('the download filename is encoded so it cannot break the header', async () => {
    const record = Object.assign(storedFile(), { originalName: 'evil".pdf\r\nX-Injected: 1' });
    fake(FileRecord, 'findByPk', async () => record);
    const res = await request(app).get(`/files/${FILE_ID}`).set('Authorization', owner);
    assert.equal(res.headers['x-injected'], undefined);
    assert.doesNotMatch(res.headers['content-disposition'] ?? '', /"[^"]*"[^;]*"/);
});

test('replace without a file is 400', async () => {
    const res = await request(app).put(`/files/${FILE_ID}`).set('Authorization', owner);
    assert.equal(res.status, 400);
});

test("replacing someone else's or an unknown file is refused and the upload removed", async () => {
    fake(FileRecord, 'findByPk', async () => storedFile(SAMPLES.pdf, 99));
    const forbidden = await request(app).put(`/files/${FILE_ID}`).set('Authorization', owner)
        .attach('file', SAMPLES.png, { filename: 'a.png', contentType: 'image/png' });
    assert.equal(forbidden.status, 403);

    fake(FileRecord, 'findByPk', async () => null);
    const missing = await request(app).put(`/files/${FILE_ID}`).set('Authorization', owner)
        .attach('file', SAMPLES.png, { filename: 'a.png', contentType: 'image/png' });
    assert.equal(missing.status, 404);
    assert.deepEqual(ownerFiles(), [], 'uploaded replacement removed');
});

test('a replacement whose content does not match its type is rejected and removed; the original stays', async () => {
    const record = storedFile();
    fake(FileRecord, 'findByPk', async () => record);
    const res = await request(app).put(`/files/${FILE_ID}`).set('Authorization', owner)
        .attach('file', Buffer.from('<html>'), { filename: 'a.png', contentType: 'image/png' });
    assert.equal(res.status, 415);
    assert.deepEqual(ownerFiles(), [path.basename(record.path)], 'only the original remains');
});

test('a successful replace points the record at the new file, then deletes the old one', async () => {
    const record = storedFile();
    const oldFile = path.basename(record.path);
    fake(FileRecord, 'findByPk', async () => record);
    const res = await request(app).put(`/files/${FILE_ID}`).set('Authorization', owner)
        .attach('file', SAMPLES.png, { filename: 'pic.png', contentType: 'image/png' });
    assert.equal(res.status, 200);
    assert.equal(record.mimeType, 'image/png');
    assert.equal(record.originalName, 'pic.png');
    const files = ownerFiles();
    assert.equal(files.length, 1);
    assert.notEqual(files[0], oldFile, 'old file deleted');
});

test('if the database update fails, the new upload is removed and the old file kept', async () => {
    const record = storedFile();
    record.update = async () => { throw new Error('db down'); };
    fake(FileRecord, 'findByPk', async () => record);
    const res = await request(app).put(`/files/${FILE_ID}`).set('Authorization', owner)
        .attach('file', SAMPLES.png, { filename: 'pic.png', contentType: 'image/png' });
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'File update failed' });
    assert.deepEqual(ownerFiles(), [path.basename(record.path)]);
});

test('delete: unknown 404, someone else\'s 403, own file removed from DB and disk', async () => {
    fake(FileRecord, 'findByPk', async () => null);
    assert.equal((await request(app).delete(`/files/${FILE_ID}`).set('Authorization', owner)).status, 404);

    const others = storedFile(SAMPLES.pdf, 99);
    fake(FileRecord, 'findByPk', async () => others);
    assert.equal((await request(app).delete(`/files/${FILE_ID}`).set('Authorization', owner)).status, 403);
    assert.equal(others.destroyed, false);

    const mine = storedFile();
    fake(FileRecord, 'findByPk', async () => mine);
    const res = await request(app).delete(`/files/${FILE_ID}`).set('Authorization', owner);
    assert.equal(res.status, 200);
    assert.equal(mine.destroyed, true);
    assert.deepEqual(ownerFiles(), []);
});

test('the list can be filtered by MIME type', async () => {
    let where: unknown;
    fake(FileRecord, 'findAndCountAll', async (q: { where: unknown }) => { where = q.where; return { count: 0, rows: [] }; });
    await request(app).get('/files?mimeType=image/png').set('Authorization', owner);
    assert.deepEqual(where, { uploadedBy: OWNER, mimeType: 'image/png' });
});

test('oversized uploads are rejected with 413', async () => {
    const big = Buffer.concat([SAMPLES.pdf, Buffer.alloc(11 * 1024 * 1024)]);
    const res = await request(app).post('/files/upload').set('Authorization', owner)
        .attach('files', big, { filename: 'big.pdf', contentType: 'application/pdf' });
    assert.equal(res.status, 413);
    assert.deepEqual(ownerFiles(), [], 'partial upload removed');
});
