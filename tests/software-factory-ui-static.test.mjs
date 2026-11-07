import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectStaticBundle, validateStaticBundle, materializeStaticBundle } from '../script/software-factory-ui-static.mjs';
test('candidate static bytes are bounded validated data, never imported Node modules', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ui-static-'));
    try {
        await writeFile(path.join(root, 'index.html'), '<h1>Actual built bytes</h1>');
        const bundle = await collectStaticBundle(root), manifest = validateStaticBundle(bundle);
        assert.equal(manifest.files.length, 1);
        const out = path.join(root, 'copied');
        await materializeStaticBundle(bundle, out);
        assert.equal(await readFile(path.join(out, 'index.html'), 'utf8'), '<h1>Actual built bytes</h1>');
        for (const name of ['../escape', '/root', 'x/../../escape', 'x\\escape', '.env', 'x/.secret', 'x:evil'])
            assert.throws(() => validateStaticBundle({ ...bundle, files: [{ ...bundle.files[0], path: name }] }));
        assert.throws(() => validateStaticBundle({ ...bundle, files: [{ ...bundle.files[0], sha256: 'a'.repeat(64) }] }));
        assert.throws(() => validateStaticBundle({ ...bundle, files: [bundle.files[0], bundle.files[0]] }));
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
