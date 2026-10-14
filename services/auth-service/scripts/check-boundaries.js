#!/usr/bin/env node
/**
 * Enforces module boundaries inside auth-service:
 *   1. A module may import another module only through its public index.js
 *      (require('../billing'), never require('../billing/models/Transaction')).
 *   2. src/shared/ must not import from any module.
 *
 * Usage: npm run lint:boundaries   (exits 1 on violations)
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../src');
const MODULES = path.join(SRC, 'modules');
const SHARED = path.join(SRC, 'shared');
const REQUIRE_RE = /require\(\s*['"](\.{1,2}\/[^'"]*)['"]\s*\)/g;

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
});

// Which module a path belongs to, or null if it is outside src/modules
const moduleOf = (file) => {
    const rel = path.relative(MODULES, file);
    return rel.startsWith('..') ? null : rel.split(path.sep)[0];
};

const resolveTarget = (fromFile, spec) => {
    const base = path.resolve(path.dirname(fromFile), spec);
    const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
    return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || base;
};

const violations = [];

for (const file of walk(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    const fromModule = moduleOf(file);
    const inShared = !path.relative(SHARED, file).startsWith('..');

    for (const match of source.matchAll(REQUIRE_RE)) {
        const target = resolveTarget(file, match[1]);
        const toModule = moduleOf(target);
        if (!toModule) continue;

        const line = source.slice(0, match.index).split('\n').length;
        const where = `${path.relative(SRC, file)}:${line}`;

        if (inShared) {
            violations.push(`${where} shared code imports module "${toModule}" (${match[1]})`);
        } else if (fromModule && fromModule !== toModule &&
                   target !== path.join(MODULES, toModule, 'index.js')) {
            violations.push(`${where} "${fromModule}" reaches into "${toModule}" internals (${match[1]}); import '../${toModule}' instead`);
        }
    }
}

if (violations.length) {
    console.error(`Module boundary violations (${violations.length}):\n  ${violations.join('\n  ')}`);
    process.exit(1);
}
console.log('✓ Module boundaries OK');
