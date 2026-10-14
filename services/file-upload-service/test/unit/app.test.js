/**
 * HTTP tests with the database faked: upload validation, cleanup of rejected or failed
 * uploads, and pagination limits. Real database behaviour is in test/integration.
 */
const { uploadDir, accessToken, SAMPLES } = require('../env');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { sequelize } = require('../../src/config/database');
const FileRecord = require('../../src/models/FileRecord');
const { createApp } = require('../../src/app');

let app;
let createImpl;
let lastQuery;
const auth = `Bearer ${accessToken(7)}`;

const filesOnDisk = () => {
    const dir = path.join(uploadDir, '7');
    return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

before(() => {
    sequelize.authenticate = async () => {};
    sequelize.transaction = async (fn) => fn({});
    FileRecord.create = (...args) => createImpl(...args);
    FileRecord.findAndCountAll = async (query) => { lastQuery = query; return { count: 0, rows: [] }; };
    app = createApp();
});

beforeEach(() => {
    fs.rmSync(path.join(uploadDir, '7'), { recursive: true, force: true });
    createImpl = async (data) => ({ id: 'id-1', ...data, createdAt: new Date(), updatedAt: new Date() });
});

test('uploads a valid file', async () => {
    const res = await request(app).post('/files/upload').set('Authorization', auth)
        .attach('files', SAMPLES.pdf, { filename: 'doc.pdf', contentType: 'application/pdf' });
    assert.equal(res.status, 201);
    assert.equal(res.body.files[0].originalName, 'doc.pdf');
    assert.equal(res.body.files[0].path, undefined, 'disk path is never exposed');
    assert.equal(filesOnDisk().length, 1);
});

test('rejects content that does not match the declared type and deletes it', async () => {
    const res = await request(app).post('/files/upload').set('Authorization', auth)
        .attach('files', SAMPLES.pdf, { filename: 'ok.pdf', contentType: 'application/pdf' })
        .attach('files', Buffer.from('<html>evil</html>'), { filename: 'x.png', contentType: 'image/png' });
    assert.equal(res.status, 415);
    assert.deepEqual(filesOnDisk(), [], 'no files are left behind');
});

test('rejects SVG uploads', async () => {
    const res = await request(app).post('/files/upload').set('Authorization', auth)
        .attach('files', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { filename: 'a.svg', contentType: 'image/svg+xml' });
    assert.equal(res.status, 415);
    assert.deepEqual(filesOnDisk(), []);
});

test('a failed database insert removes the uploaded files and leaks nothing', async () => {
    createImpl = async () => { throw new Error('ER_DUP_ENTRY secret details'); };
    const res = await request(app).post('/files/upload').set('Authorization', auth)
        .attach('files', SAMPLES.pdf, { filename: 'doc.pdf', contentType: 'application/pdf' });
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'Upload failed' });
    assert.deepEqual(filesOnDisk(), [], 'orphaned file was cleaned up');
});

test('list caps the page size at 100', async () => {
    const res = await request(app).get('/files?limit=1000000&page=-5').set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.equal(lastQuery.limit, 100);
    assert.equal(lastQuery.offset, 0);
    assert.equal(lastQuery.where.uploadedBy, 7);
});

test('requires an access token', async () => {
    assert.equal((await request(app).get('/files')).status, 401);
    const refreshLike = accessToken(7, { typ: 'refresh' });
    assert.equal((await request(app).get('/files').set('Authorization', `Bearer ${refreshLike}`)).status, 401);
});

test('health endpoints', async () => {
    assert.equal((await request(app).get('/health')).status, 200);
    assert.equal((await request(app).get('/health/ready')).status, 200);
});

test('an unwritable upload directory fails the request, not the process', async () => {
    const original = process.env.UPLOAD_DIR;
    const blocker = path.join(uploadDir, 'not-a-dir');
    fs.writeFileSync(blocker, 'x'); // a file where a directory is expected
    process.env.UPLOAD_DIR = blocker;
    try {
        const res = await request(app).post('/files/upload').set('Authorization', auth)
            .attach('files', SAMPLES.pdf, { filename: 'doc.pdf', contentType: 'application/pdf' });
        assert.equal(res.status, 500);
        assert.deepEqual(res.body, { error: 'Internal server error' });
    } finally {
        process.env.UPLOAD_DIR = original;
    }
});
