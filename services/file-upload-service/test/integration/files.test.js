const { accessToken, SAMPLES } = require('../env');
const { test, before, after } = require('node:test');

if (process.env.INTEGRATION !== '1') {
    test('file integration tests (set INTEGRATION=1 with MySQL running)', { skip: true }, () => {});
    return;
}

const assert = require('node:assert/strict');
const path = require('path');
const request = require('supertest');
const { Sequelize } = require('sequelize');
const platform = require('@ai-search/platform');
const { sequelize } = require('../../src/config/database');
const logger = require('../../src/shared/logger');
const { createApp } = require('../../src/app');

let app;
const owner = `Bearer ${accessToken(101)}`;
const stranger = `Bearer ${accessToken(202)}`;
const migrate = () => platform.migrateUp({
    sequelize, Sequelize, logger,
    dir: path.join(__dirname, '../../migrations'),
    tableName: 'migrations_files',
});

before(async () => {
    if (!/test/i.test(sequelize.getDatabaseName())) throw new Error('Refusing to use a non-test database');
    await sequelize.getQueryInterface().dropTable('file_records');
    await sequelize.getQueryInterface().dropTable('migrations_files');
    await migrate();
    app = createApp();
});

after(() => sequelize.close());

test('migrations are idempotent', async () => {
    assert.deepEqual(await migrate(), []);
});

test('upload → list → download → replace → delete', async () => {
    const uploaded = await request(app).post('/files/upload').set('Authorization', owner)
        .attach('files', SAMPLES.pdf, { filename: 'report.pdf', contentType: 'application/pdf' });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    const id = uploaded.body.files[0].id;

    const list = await request(app).get('/files').set('Authorization', owner);
    assert.equal(list.body.total, 1);

    const download = await request(app).get(`/files/${id}`).set('Authorization', owner).buffer(true)
        .parse((res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    assert.equal(download.status, 200);
    assert.ok(download.body.equals(SAMPLES.pdf), 'downloaded bytes match');

    const replaced = await request(app).put(`/files/${id}`).set('Authorization', owner)
        .attach('file', SAMPLES.png, { filename: 'pic.png', contentType: 'image/png' });
    assert.equal(replaced.status, 200);
    assert.equal(replaced.body.file.mimeType, 'image/png');

    assert.equal((await request(app).delete(`/files/${id}`).set('Authorization', owner)).status, 200);
    assert.equal((await request(app).get(`/files/${id}`).set('Authorization', owner)).status, 404);
});

test("users cannot touch each other's files", async () => {
    const uploaded = await request(app).post('/files/upload').set('Authorization', owner)
        .attach('files', SAMPLES.text, { filename: 'notes.txt', contentType: 'text/plain' });
    const id = uploaded.body.files[0].id;

    assert.equal((await request(app).get(`/files/${id}`).set('Authorization', stranger)).status, 403);
    assert.equal((await request(app).delete(`/files/${id}`).set('Authorization', stranger)).status, 403);
    assert.equal((await request(app).get('/files').set('Authorization', stranger)).body.total, 0);
});
