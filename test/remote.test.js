import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Git } from '../src/git.js';
import { clone, createRemoteServer, fetchRemote, pull, push } from '../src/remote.js';

async function serve(t, repo, options = {}) {
  const server = createRemoteServer(repo, options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('clone transfers branches and files; fetch does not move HEAD, pull fast-forwards', async t => {
  const a = new Git('A', { defaultBranch: 'main' });
  a.add('hello.txt', 'hello').commit('initial');
  a.checkout('feature');
  a.commit('feature');
  a.checkout('main');
  a.add('not-committed', 'private staging');
  const url = await serve(t, a);
  const b = await clone(url);
  assert.equal(b.files['not-committed'], undefined);
  assert.equal(b.branches.size, 2);
  assert.equal(b.isStaged, false);
  assert.equal(b.remotes.get('origin'), url);
  a.remove('not-committed');
  a.add('hello.txt', 'updated').commit('update A');
  const old = b.HEAD.commit;
  await fetchRemote(b);
  assert.equal(b.HEAD.commit, old);
  assert.equal(Buffer.from(b.files['hello.txt'], 'base64').toString(), 'hello');
  await pull(b);
  assert.equal(b.HEAD.commit.id, a.HEAD.commit.id);
  assert.equal(Buffer.from(b.files['hello.txt'], 'base64').toString(), 'updated');
  await pull(b); // Repeating a pull is idempotent.
  assert.equal(b.log().length, 2);
});

test('two running peers can push in both directions and create remote branches', async t => {
  const a = new Git('A', { defaultBranch: 'main' });
  const aURL = await serve(t, a);
  const b = await clone(aURL);
  const bURL = await serve(t, b);
  a.addRemote('origin', bURL);
  b.add('file', 'from B').commit('B creates first commit');
  await push(b);
  assert.equal(a.HEAD.commit.id, b.HEAD.commit.id);
  assert.equal(b.remoteRefs.get('origin').find(ref => ref.name === 'main').commit, b.HEAD.commit.id);
  a.add('file', 'from A').commit('A updates');
  await push(a);
  assert.equal(b.HEAD.commit.id, a.HEAD.commit.id);
  b.checkout('feature');
  b.commit('feature');
  await push(b);
  assert.equal(a.HEAD.name, 'main');
  assert.equal(b.remoteRefs.get('origin').find(ref => ref.name === 'feature').commit, b.HEAD.commit.id);
  assert.equal(a.branches.get('feature').commit.id, b.HEAD.commit.id);
  assert.equal(a.log().length, 2);
});

test('divergent push and pull are rejected without losing either history', async t => {
  const a = new Git('A');
  a.commit('shared');
  const b = await clone(await serve(t, a));
  const tipA = a.commit('A diverges');
  const tipB = b.commit('B diverges');
  const objects = a.commits.size;
  await assert.rejects(push(b), /Non-fast-forward push/);
  assert.equal(a.HEAD.commit, tipA);
  assert.equal(a.commits.size, objects);
  await assert.rejects(pull(b), /Non-fast-forward pull/);
  assert.equal(b.HEAD.commit, tipB);
  assert.equal(a.log().length, 2);
  assert.equal(b.log().length, 2);
});

test('pull when ahead keeps local commits; staged remote changes block push', async t => {
  const a = new Git('A');
  a.commit('shared');
  const b = await clone(await serve(t, a));
  const local = b.commit('ahead');
  await pull(b);
  assert.equal(b.HEAD.commit, local);
  a.add('file', 'staged');
  await assert.rejects(push(b), /Remote has staged changes/);
  assert.equal(a.log().length, 1);
  b.add('local', 'staged');
  await assert.rejects(pull(b), /staged/);
});

test('token protects reads and writes and is not persisted in a clone', async t => {
  const a = new Git('A');
  a.commit('initial');
  const url = await serve(t, a, { token: 'test-secret' });
  await assert.rejects(clone(url), /Invalid or missing/);
  await assert.rejects(clone(url, { token: 'wrong' }), /Invalid or missing/);
  const b = await clone(url, { token: 'test-secret' });
  assert.equal(JSON.stringify(b).includes('test-secret'), false);
  b.commit('update');
  await assert.rejects(push(b), /Invalid or missing/);
  await push(b, 'origin', 'master', { token: 'test-secret' });
  assert.equal(a.HEAD.commit.id, b.HEAD.commit.id);
  const unauthorized = await fetch(`${url}/push`, { method: 'POST' });
  assert.equal(unauthorized.status, 401);
});

test('stale push, invalid payload and unknown endpoint leave the server usable', async t => {
  const a = new Git('A');
  a.commit('initial');
  const url = await serve(t, a);
  const b = await clone(url);
  const advertised = a.HEAD.commit.id;
  b.commit('B');
  const current = a.commit('A');
  const response = await fetch(`${url}/push`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bundle: b.exportBundle(), branch: 'master', expectedTip: advertised }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /changed/);
  assert.equal(a.HEAD.commit, current);
  assert.equal((await fetch(`${url}/unknown`)).status, 404);
  assert.equal((await fetch(`${url}/push`, { method: 'POST' })).status, 415);
  const malformed = await fetch(`${url}/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 409);
  assert.equal((await clone(url)).HEAD.commit.id, current.id);
});
