/**
 * Enforces module boundaries inside auth-service:
 *   1. A module may import another module only through its public index
 *      (import '../billing', never '../billing/models/Transaction').
 *   2. src/shared/ must not import from any module.
 *
 * Usage: npm run lint:boundaries   (exits 1 on violations)
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../src');
const MODULES = path.join(SRC, 'modules');
const SHARED = path.join(SRC, 'shared');

// import x from '…', import '…', export … from '…', import('…'), require('…') — relative paths only
const SPECIFIER_RE = /(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\(\s*)['"](\.{1,2}\/[^'"]*)['"]/g;

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.ts$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
});

const isInside = (parent: string, file: string): boolean => !path.relative(parent, file).startsWith('..');

/** Which module a path belongs to, or null if it is outside src/modules */
const moduleOf = (file: string): string | null =>
    (isInside(MODULES, file) ? path.relative(MODULES, file).split(path.sep)[0] ?? null : null);

const resolveTarget = (fromFile: string, spec: string): string => {
    const base = path.resolve(path.dirname(fromFile), spec);
    const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')];
    return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? base;
};

const violations: string[] = [];

for (const file of walk(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    const fromModule = moduleOf(file);
    const inShared = isInside(SHARED, file);

    for (const match of source.matchAll(SPECIFIER_RE)) {
        const spec = match[1];
        if (!spec) continue;
        const target = resolveTarget(file, spec);
        const toModule = moduleOf(target);
        if (!toModule) continue;

        const line = source.slice(0, match.index).split('\n').length;
        const where = `${path.relative(SRC, file)}:${line}`;

        if (inShared) {
            violations.push(`${where} shared code imports module "${toModule}" (${spec})`);
        } else if (fromModule && fromModule !== toModule && target !== path.join(MODULES, toModule, 'index.ts')) {
            violations.push(`${where} "${fromModule}" reaches into "${toModule}" internals (${spec}); import '../${toModule}' instead`);
        }
    }
}

if (violations.length) {
    console.error(`Module boundary violations (${violations.length}):\n  ${violations.join('\n  ')}`);
    process.exit(1);
}
console.log('✓ Module boundaries OK');
