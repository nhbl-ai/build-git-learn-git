import test from 'node:test';
import assert from 'node:assert/strict';
import { Branch, Commit, Git } from '../src/git.js';

test('empty repository, commit parents and independent branch history', () => {
  const repo = new Git('demo');
  assert.equal(repo.HEAD.name, 'master');
  assert.deepEqual(repo.log(), []);
  const first = repo.commit('first');
  assert.equal(first.parent, null);
  assert.equal(new Branch('demo', first).commit, first);
  assert.equal(new Commit(1, null, 'example').id, 1);
  repo.checkout('feature');
  const feature = repo.commit('feature');
  repo.checkout('master');
  const main = repo.commit('main');
  assert.deepEqual(repo.log(), [main, first]);
  assert.deepEqual(repo.log('feature'), [feature, first]);
});

test('commits snapshot staged text, binary data and deletions without mutating old commits', () => {
  const repo = new Git('files');
  repo.add('src/main.js', 'hello').add('asset.bin', Buffer.from([0, 255, 128]));
  const first = repo.commit('files');
  repo.add('src/main.js', 'updated').remove('asset.bin');
  assert.equal(repo.isStaged, true);
  assert.throws(() => repo.checkout('other'), /staged/);
  const second = repo.commit('change');
  assert.equal(repo.isStaged, false);
  assert.equal(Buffer.from(first.files['src/main.js'], 'base64').toString(), 'hello');
  assert.deepEqual(Buffer.from(first.files['asset.bin'], 'base64'), Buffer.from([0, 255, 128]));
  assert.equal(second.files['asset.bin'], undefined);
  assert.notEqual(first.id, second.id);
  assert.equal(first.id.length, 64);
});

test('JSON round trip preserves HEAD, staging, fetched objects, remotes and parent identity', () => {
  const repo = new Git('persist');
  repo.addRemote('origin', 'http://127.0.0.1:9418');
  repo.add('file', 'initial').commit('initial');
  repo.checkout('feature');
  repo.commit('feature');
  repo.checkout('master');
  const remote = Git.fromBundle(repo.exportBundle());
  remote.add('file', 'from peer').commit('peer');
  repo.fetchBundle('origin', remote.exportBundle());
  repo.add('file', 'staged locally');
  const restored = Git.fromJSON(JSON.parse(JSON.stringify(repo)));
  assert.deepEqual(restored.toJSON(), repo.toJSON());
  assert.equal(restored.isStaged, true);
  assert.equal(restored.HEAD, restored.branches.get('master'));
  assert.equal(restored.log('feature')[0].parent, restored.HEAD.commit);
  assert.equal(restored.commits.size, 3);
});

test('untrusted history is rejected before fetch mutates local objects or pointers', () => {
  const peer = new Git('peer');
  peer.add('file', 'data').commit('initial');
  const repo = new Git('local');
  repo.addRemote('origin', 'http://localhost:9418');
  const tampered = structuredClone(peer.exportBundle());
  tampered.commits[0].message = 'tampered';
  assert.throws(() => repo.fetchBundle('origin', tampered), /checksum/);
  assert.equal(repo.commits.size, 0);
  assert.equal(repo.remoteRefs.size, 0);
  const missing = structuredClone(peer.exportBundle());
  missing.commits[0].parent = 'a'.repeat(64);
  assert.throws(() => Git.fromBundle(missing), /Missing parent/);
  const cycle = structuredClone(peer.exportBundle());
  cycle.commits[0].parent = cycle.commits[0].id;
  assert.throws(() => Git.fromBundle(cycle), /cycle/);
  const duplicate = structuredClone(peer.exportBundle());
  duplicate.commits.push(duplicate.commits[0]);
  assert.throws(() => Git.fromBundle(duplicate), /duplicate/);
});

test('portable file validation rejects traversal, metadata, device names and collisions', () => {
  const repo = new Git('paths');
  for (const path of ['../outside', '/absolute', 'C:/outside', '.git/config', 'x/.LEARN-GIT/state.json',
    'a\\b', 'a//b', 'a/./b', 'NUL.txt', 'name.', 'file\0']) {
    assert.throws(() => repo.add(path, 'bad'), /path/);
  }
  repo.add('README', 'ok');
  assert.throws(() => repo.add('readme', 'collision'), /Conflicting/);
  repo.add('file', 'ok');
  assert.throws(() => repo.add('file/nested', 'collision'), /conflict/);
  assert.throws(() => repo.addRemote('origin', 'file:///repo'), /HTTP/);
  assert.throws(() => repo.addRemote('origin', 'http://user:password@localhost'), /HTTP/);
});

test('long histories deserialize without recursion', () => {
  const repo = new Git('long');
  for (let index = 0; index < 2500; index++) repo.commit(`commit ${index}`);
  const restored = Git.fromBundle(repo.exportBundle());
  assert.equal(restored.log().length, 2500);
});
