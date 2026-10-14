import { SAMPLES } from '../env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { matchesDeclaredType } from '../../src/utils/fileSignature';

const write = (buf: Buffer): string => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-')), 'f');
    fs.writeFileSync(file, buf);
    return file;
};

test('real files match their declared type', () => {
    assert.equal(matchesDeclaredType(write(SAMPLES.png), 'image/png'), true);
    assert.equal(matchesDeclaredType(write(SAMPLES.pdf), 'application/pdf'), true);
    assert.equal(matchesDeclaredType(write(SAMPLES.text), 'text/csv'), true);
});

test('a script disguised as an image is rejected', () => {
    assert.equal(matchesDeclaredType(write(Buffer.from('<script>alert(1)</script>')), 'image/png'), false);
});

test('binary content declared as text is rejected', () => {
    assert.equal(matchesDeclaredType(write(Buffer.from([0x4d, 0x5a, 0x00, 0x90])), 'text/plain'), false);
});

test('unlisted and empty files are rejected', () => {
    assert.equal(matchesDeclaredType(write(SAMPLES.text), 'image/svg+xml'), false);
    assert.equal(matchesDeclaredType(write(Buffer.alloc(0)), 'text/plain'), false);
});
