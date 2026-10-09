import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRepository, mutateRepository } from '../src/repository.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'learn-git-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(root, ...args) {
  const result = spawnSync(process.execPath, [CLI, '-C', root, ...args], {
    encoding: 'utf8', timeout: 20_000, windowsHide: true,
    env: { ...process.env, LEARN_GIT_TOKEN: '' },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function fail(root, pattern, ...args) {
  const result = spawnSync(process.execPath, [CLI, '-C', root, ...args], {
    encoding: 'utf8', timeout: 20_000, windowsHide: true,
    env: { ...process.env, LEARN_GIT_TOKEN: '' },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, pattern);
}

async function serve(t, root) {
  const child = spawn(process.execPath, [CLI, '-C', root, 'serve', '--host', '127.0.0.1', '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, LEARN_GIT_TOKEN: '' },
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10_000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${output}`)); });
  });
}

test('CLI exchanges text, binary files and deletions between two live, disk-backed peers', async t => {
  const directory = workspace(t);
  const a = join(directory, 'A');
  const b = join(directory, 'B');
  run(a, 'init');
  mkdirSync(join(a, 'src'));
  writeFileSync(join(a, 'src', 'main.js'), 'console.log("A");\n');
  writeFileSync(join(a, 'image.bin'), Buffer.from([0, 255, 128, 10]));
  run(a, 'add', '.');
  run(a, 'commit', 'initial');
  const aURL = await serve(t, a);
  run(directory, 'clone', aURL, 'B');
  assert.equal(readFileSync(join(b, 'src', 'main.js'), 'utf8'), 'console.log("A");\n');
  assert.deepEqual(readFileSync(join(b, 'image.bin')), Buffer.from([0, 255, 128, 10]));
  const bURL = await serve(t, b);
  run(a, 'remote', 'add', 'origin', bURL);

  writeFileSync(join(b, 'src', 'main.js'), 'console.log("B");\n');
  run(b, 'add', 'src');
  run(b, 'commit', 'B updates');
  run(b, 'push');
  assert.equal(readFileSync(join(a, 'src', 'main.js'), 'utf8'), 'console.log("B");\n');
  assert.equal(loadRepository(a).HEAD.commit.id, loadRepository(b).HEAD.commit.id);

  unlinkSync(join(a, 'image.bin'));
  writeFileSync(join(a, 'new.txt'), 'from A');
  run(a, 'add', '.');
  run(a, 'commit', 'A deletes binary and adds text');
  const oldB = loadRepository(b).HEAD.commit.id;
  run(b, 'fetch');
  assert.equal(loadRepository(b).HEAD.commit.id, oldB);
  assert.equal(readFileSync(join(b, 'image.bin')).length, 4);
  run(b, 'pull');
  assert.equal(readFileSync(join(b, 'new.txt'), 'utf8'), 'from A');
  assert.throws(() => readFileSync(join(b, 'image.bin')), /ENOENT/);

  writeFileSync(join(a, 'new.txt'), 'another A update');
  run(a, 'add', 'new.txt');
  run(a, 'commit', 'A pushes to live B');
  run(a, 'push');
  assert.equal(readFileSync(join(b, 'new.txt'), 'utf8'), 'another A update');
  run(directory, 'clone', bURL, 'C');
  assert.equal(readFileSync(join(directory, 'C', 'new.txt'), 'utf8'), 'another A update');
  assert.match(run(a, 'status'), /Working tree clean/);
  assert.match(run(b, 'status'), /Working tree clean/);
  assert.equal(loadRepository(b).log().length, 4);
});

test('pull and incoming push preserve uncommitted tracked and untracked files', async t => {
  const directory = workspace(t);
  const a = join(directory, 'A');
  const b = join(directory, 'B');
  run(a, 'init');
  writeFileSync(join(a, 'tracked.txt'), 'initial');
  run(a, 'add', '.');
  run(a, 'commit', 'initial');
  const url = await serve(t, a);
  run(directory, 'clone', url, 'B');
  writeFileSync(join(a, 'tracked.txt'), 'A is still editing');
  writeFileSync(join(b, 'tracked.txt'), 'B committed');
  run(b, 'add', '.');
  run(b, 'commit', 'B update');
  const before = loadRepository(a).HEAD.commit.id;
  fail(b, /Uncommitted change/, 'push');
  assert.equal(loadRepository(a).HEAD.commit.id, before);
  assert.equal(readFileSync(join(a, 'tracked.txt'), 'utf8'), 'A is still editing');
  writeFileSync(join(a, 'tracked.txt'), 'initial');
  run(b, 'push');
  writeFileSync(join(a, 'collision.txt'), 'committed by A');
  run(a, 'add', '.');
  run(a, 'commit', 'new path');
  writeFileSync(join(b, 'collision.txt'), 'untracked local work');
  const oldB = loadRepository(b).HEAD.commit.id;
  fail(b, /Untracked file/, 'pull');
  assert.equal(loadRepository(b).HEAD.commit.id, oldB);
  assert.equal(readFileSync(join(b, 'collision.txt'), 'utf8'), 'untracked local work');
});

test('checkout restores snapshots and refuses staged or unstaged changes', t => {
  const root = workspace(t);
  run(root, 'init');
  writeFileSync(join(root, 'file.txt'), 'main');
  run(root, 'add', '.');
  run(root, 'commit', 'main');
  run(root, 'checkout', 'feature');
  writeFileSync(join(root, 'file.txt'), 'feature');
  fail(root, /Uncommitted change/, 'checkout', 'main');
  run(root, 'add', '.');
  fail(root, /staged/, 'checkout', 'main');
  run(root, 'commit', 'feature');
  run(root, 'checkout', 'main');
  assert.equal(readFileSync(join(root, 'file.txt'), 'utf8'), 'main');
  run(root, 'checkout', 'feature');
  assert.equal(readFileSync(join(root, 'file.txt'), 'utf8'), 'feature');
  fail(root, /already exists/, 'init');
  fail(root, /Nothing staged/, 'commit', 'empty');
  fail(root, /path/, 'add', '../outside');
  fail(root, /path/, 'add', '.git/config');
});

test('repository lock prevents overlapping commands and is released after failure', async t => {
  const root = workspace(t);
  run(root, 'init');
  await mutateRepository(root, async () => {
    await assert.rejects(mutateRepository(root, () => {}), /busy/);
  });
  await assert.rejects(mutateRepository(root, () => { throw new Error('test failure'); }), /test failure/);
  await mutateRepository(root, repo => repo.checkout('released'));
  assert.equal(loadRepository(root).HEAD.name, 'released');
});

test('add refuses symlink traversal', t => {
  const root = workspace(t);
  run(root, 'init');
  const outside = join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'file'), 'outside');
  const link = join(root, 'linked');
  try { symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Symlink creation unavailable'); return; }
    throw error;
  }
  fail(root, /Symbolic links/, 'add', 'linked');
});
