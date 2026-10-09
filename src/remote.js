import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Git } from './git.js';

export const MAX_TRANSFER_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

async function readJSON(stream) {
  let size = 0;
  const chunks = [];
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_TRANSFER_BYTES) throw new Error('Repository transfer exceeds the 16 MiB limit');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON response or request'); }
}

function sendJSON(response, status, body) {
  const data = JSON.stringify(body);
  if (Buffer.byteLength(data) > MAX_TRANSFER_BYTES) {
    response.writeHead(413, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Repository transfer exceeds the 16 MiB limit' }));
    return;
  }
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(data);
}

function authorized(request, token) {
  if (!token) return true;
  const provided = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Hooks let the CLI reload and lock on every request while the server stays running. */
export function createRemoteServer(repository, {
  token, readRepository = () => repository,
  updateRepository = action => action(repository),
} = {}) {
  const server = createServer(async (request, response) => {
    try {
      if (!authorized(request, token)) {
        request.resume();
        sendJSON(response, 401, { error: 'Invalid or missing LEARN_GIT_TOKEN' });
        return;
      }
      if (request.method === 'GET' && request.url === '/repository') {
        sendJSON(response, 200, readRepository().exportBundle());
      } else if (request.method === 'POST' && request.url === '/push') {
        if (!request.headers['content-type']?.startsWith('application/json')) {
          request.resume();
          sendJSON(response, 415, { error: 'Expected application/json' });
          return;
        }
        const payload = await readJSON(request);
        const id = await updateRepository(repo => repo.receivePush(payload));
        sendJSON(response, 200, { id });
      } else {
        request.resume();
        sendJSON(response, 404, { error: 'Unknown endpoint' });
      }
    } catch (error) {
      if (!response.destroyed && !response.headersSent) sendJSON(response, 409, { error: error.message });
    }
  });
  server.requestTimeout = TIMEOUT_MS;
  server.headersTimeout = TIMEOUT_MS;
  return server;
}

async function requestJSON(url, { token, method = 'GET', body } = {}) {
  let data;
  if (body !== undefined) {
    data = JSON.stringify(body);
    if (Buffer.byteLength(data) > MAX_TRANSFER_BYTES) throw new Error('Repository transfer exceeds the 16 MiB limit');
  }
  try {
    const response = await fetch(url, {
      method, body: data, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    const result = await readJSON(response.body ?? []);
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    return result;
  } catch (error) {
    const detail = error.cause?.code ? ` (${error.cause.code})` : '';
    throw new Error(`Remote ${new URL(url).origin}: ${error.message}${detail}`, { cause: error });
  }
}

function remoteURL(repository, remote) {
  const url = repository.remotes.get(remote);
  if (!url) throw new Error(`Unknown remote: ${remote}`);
  return url;
}

export async function fetchRemote(repository, remote = 'origin', options = {}) {
  const bundle = await requestJSON(`${remoteURL(repository, remote)}/repository`, options);
  return repository.fetchBundle(remote, bundle);
}

export async function pull(repository, remote = 'origin', branch = repository.HEAD.name, options = {}) {
  await fetchRemote(repository, remote, options);
  return repository.pullFetched(remote, branch);
}

export async function push(repository, remote = 'origin', branch = repository.HEAD.name, options = {}) {
  const url = remoteURL(repository, remote);
  const local = repository.branches.get(branch);
  if (!local?.commit) throw new Error(`No commits to push on branch: ${branch}`);
  const bundle = await requestJSON(`${url}/repository`, options);
  Git.fromBundle(bundle);
  const expectedTip = bundle.branches.find(ref => ref.name === branch)?.commit ?? null;
  const result = await requestJSON(`${url}/push`, {
    ...options, method: 'POST', body: { bundle: repository.exportBundle(), branch, expectedTip },
  });
  if (result.id !== local.commit.id) throw new Error('Remote acknowledged an unexpected commit');
  const refs = repository.fetchBundle(remote, bundle);
  const ref = refs.find(item => item.name === branch);
  if (ref) ref.commit = result.id;
  else refs.push({ name: branch, commit: result.id });
  return result.id;
}

export async function clone(url, { name, token } = {}) {
  const configuration = new Git('clone');
  configuration.addRemote('origin', url);
  const bundle = await requestJSON(`${configuration.remotes.get('origin')}/repository`, { token });
  const repository = Git.fromBundle(bundle);
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Repository name must not be empty');
    repository.name = name;
  }
  repository.addRemote('origin', url);
  repository.fetchBundle('origin', bundle);
  return repository;
}
