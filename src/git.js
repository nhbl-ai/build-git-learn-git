import { createHash } from 'node:crypto';

export const FORMAT_VERSION = 1;

export function validateName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(name)
    || name.includes('..') || name.includes('//') || name.endsWith('/') || name.endsWith('.')) {
    throw new Error(`Invalid branch or remote name: ${name}`);
  }
  return name;
}

export function validatePath(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0')) {
    throw new Error(`Invalid file path: ${path}`);
  }
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part)
      || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      || ['.git', '.learn-git'].includes(part.toLowerCase())) {
      throw new Error(`Unsafe file path: ${path}`);
    }
  }
  return path;
}

function snapshot(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Invalid file snapshot');
  const result = Object.create(null);
  const names = new Set();
  for (const path of Object.keys(files).sort()) {
    validatePath(path);
    const content = files[path];
    if (typeof content !== 'string' || Buffer.from(content, 'base64').toString('base64') !== content) {
      throw new Error(`Invalid base64 content: ${path}`);
    }
    if (names.has(path.toLowerCase())) throw new Error(`Conflicting file path: ${path}`);
    names.add(path.toLowerCase());
    result[path] = content;
  }
  for (const path of names) {
    const parts = path.split('/');
    parts.pop();
    while (parts.length) {
      if (names.has(parts.join('/'))) throw new Error(`File/directory conflict: ${path}`);
      parts.pop();
    }
  }
  return Object.freeze(result);
}

export function sameFiles(left, right) {
  const paths = Object.keys(left);
  return paths.length === Object.keys(right).length && paths.every(path => left[path] === right[path]);
}

function commitId(parent, message, files) {
  return createHash('sha256').update(JSON.stringify([parent?.id ?? null, message, files])).digest('hex');
}

/** An immutable commit with a full snapshot of files encoded as base64. */
export class Commit {
  constructor(id, parent, message, files = {}) {
    if (typeof message !== 'string' || !message.trim()) throw new Error('Commit message must not be empty');
    this.parent = parent;
    this.message = message;
    this.files = snapshot(files);
    this.id = id ?? commitId(parent, message, this.files);
    Object.freeze(this);
  }

  toJSON() {
    return { id: this.id, parent: this.parent?.id ?? null, message: this.message, files: this.files };
  }
}

/** A named, movable pointer to a commit. */
export class Branch {
  constructor(name, commit = null) {
    this.name = validateName(name);
    this.commit = commit;
  }
}

/** A learning model; its wire format is independent of real Git. */
export class Git {
  constructor(name, { defaultBranch = 'master' } = {}) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Repository name must not be empty');
    this.name = name;
    this.commits = new Map();
    this.HEAD = new Branch(defaultBranch);
    this.branches = new Map([[defaultBranch, this.HEAD]]);
    this.index = snapshot({});
    this.remotes = new Map();
    this.remoteRefs = new Map();
  }

  add(path, content) {
    validatePath(path);
    if (typeof content !== 'string' && !Buffer.isBuffer(content)) throw new Error('Content must be a string or Buffer');
    this.index = snapshot({ ...this.index, [path]: Buffer.from(content).toString('base64') });
    return this;
  }

  remove(path) {
    validatePath(path);
    const files = { ...this.index };
    delete files[path];
    this.index = snapshot(files);
    return this;
  }

  get files() { return this.HEAD.commit?.files ?? {}; }
  get isStaged() { return !sameFiles(this.index, this.files); }

  commit(message) {
    const commit = new Commit(null, this.HEAD.commit, message, this.index);
    this.commits.set(commit.id, commit);
    this.HEAD.commit = commit;
    return commit;
  }

  log(branchName = this.HEAD.name) {
    const branch = this.branches.get(branchName);
    if (!branch) throw new Error(`Unknown branch: ${branchName}`);
    const history = [];
    for (let commit = branch.commit; commit; commit = commit.parent) history.push(commit);
    return history;
  }

  checkout(branchName) {
    validateName(branchName);
    if (this.isStaged) throw new Error('Commit staged changes before switching branches');
    if (!this.branches.has(branchName)) this.branches.set(branchName, new Branch(branchName, this.HEAD.commit));
    this.HEAD = this.branches.get(branchName);
    this.index = snapshot(this.files);
    return this.HEAD;
  }

  addRemote(name, url) {
    validateName(name);
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
      || parsed.search || parsed.hash || parsed.pathname !== '/') {
      throw new Error('Remote must be an HTTP(S) origin, for example http://192.168.1.10:9418');
    }
    if (this.remotes.has(name)) throw new Error(`Remote already exists: ${name}`);
    this.remotes.set(name, parsed.origin);
    return this;
  }

  /** Share committed history only, never staged files or remote configuration. */
  exportBundle() {
    const reachable = new Map();
    for (const branch of this.branches.values()) {
      for (let commit = branch.commit; commit && !reachable.has(commit.id); commit = commit.parent) reachable.set(commit.id, commit);
    }
    return {
      version: FORMAT_VERSION, name: this.name, head: this.HEAD.name,
      branches: [...this.branches.values()].map(branch => ({ name: branch.name, commit: branch.commit?.id ?? null })),
      commits: [...reachable.values()].map(commit => commit.toJSON()),
    };
  }

  static fromBundle(bundle) {
    if (!bundle || bundle.version !== FORMAT_VERSION || !Array.isArray(bundle.commits)
      || !Array.isArray(bundle.branches) || bundle.branches.length === 0) throw new Error('Invalid repository bundle');
    const repo = new Git(bundle.name, { defaultBranch: bundle.head });
    const raw = new Map();
    for (const item of bundle.commits) {
      if (!item || typeof item.id !== 'string' || !/^[a-f0-9]{64}$/.test(item.id) || raw.has(item.id)
        || !(item.parent === null || typeof item.parent === 'string')) throw new Error('Invalid or duplicate commit');
      raw.set(item.id, item);
    }
    // Resolve parent chains iteratively, including bundles whose objects arrive out of order.
    for (const id of raw.keys()) {
      const chain = [];
      const seen = new Set();
      let next = id;
      while (next !== null && !repo.commits.has(next)) {
        if (seen.has(next)) throw new Error('Commit history contains a cycle');
        const item = raw.get(next);
        if (!item) throw new Error(`Missing parent commit: ${next}`);
        seen.add(next);
        chain.push(item);
        next = item.parent;
      }
      for (const item of chain.reverse()) {
        const parent = item.parent === null ? null : repo.commits.get(item.parent);
        const commit = new Commit(null, parent, item.message, item.files);
        if (commit.id !== item.id) throw new Error(`Commit checksum mismatch: ${item.id}`);
        repo.commits.set(commit.id, commit);
      }
    }
    repo.branches.clear();
    for (const ref of bundle.branches) {
      if (!ref || repo.branches.has(ref.name)) throw new Error('Invalid or duplicate branch');
      const commit = ref.commit === null ? null : repo.commits.get(ref.commit);
      if (commit === undefined) throw new Error(`Missing branch commit: ${ref.name}`);
      repo.branches.set(ref.name, new Branch(ref.name, commit));
    }
    repo.HEAD = repo.branches.get(bundle.head);
    if (!repo.HEAD) throw new Error('Missing HEAD branch');
    repo.index = snapshot(repo.files);
    return repo;
  }

  toJSON() {
    // Fetched objects can be unreachable from local branches and still need persistence.
    return { ...this.exportBundle(), commits: [...this.commits.values()].map(commit => commit.toJSON()),
      index: this.index, remotes: [...this.remotes], remoteRefs: [...this.remoteRefs] };
  }

  static fromJSON(data) {
    const repo = Git.fromBundle(data);
    repo.index = snapshot(data.index);
    if (!Array.isArray(data.remotes) || !Array.isArray(data.remoteRefs)) throw new Error('Invalid repository configuration');
    for (const [name, url] of data.remotes) repo.addRemote(name, url);
    for (const [remote, refs] of data.remoteRefs) {
      if (!repo.remotes.has(remote) || !Array.isArray(refs)) throw new Error('Invalid remote references');
      const names = new Set();
      for (const ref of refs) {
        validateName(ref.name);
        if (names.has(ref.name) || (ref.commit !== null && !repo.commits.has(ref.commit))) throw new Error('Invalid remote reference');
        names.add(ref.name);
      }
      repo.remoteRefs.set(remote, refs);
    }
    return repo;
  }

  fetchBundle(remote, bundle) {
    if (!this.remotes.has(remote)) throw new Error(`Unknown remote: ${remote}`);
    const incoming = Git.fromBundle(bundle);
    for (const [id, commit] of incoming.commits) this.commits.set(id, commit);
    const refs = bundle.branches.map(ref => ({ ...ref }));
    this.remoteRefs.set(remote, refs);
    return refs;
  }

  isAncestor(ancestor, descendant) {
    if (ancestor === null) return true;
    for (let commit = descendant; commit; commit = commit.parent) if (commit.id === ancestor.id) return true;
    return false;
  }

  pullFetched(remote, branchName = this.HEAD.name) {
    if (this.isStaged) throw new Error('Commit staged changes before pulling');
    const ref = this.remoteRefs.get(remote)?.find(ref => ref.name === branchName);
    if (!ref) throw new Error(`Unknown remote branch: ${remote}/${branchName}`);
    const incoming = ref.commit === null ? null : this.commits.get(ref.commit);
    if (this.isAncestor(incoming, this.HEAD.commit)) return this.HEAD.commit;
    if (!this.isAncestor(this.HEAD.commit, incoming)) throw new Error('Non-fast-forward pull: histories have diverged; automatic merge is not implemented');
    this.HEAD.commit = incoming;
    this.index = snapshot(this.files);
    return incoming;
  }

  receivePush({ bundle, branch: branchName, expectedTip }) {
    validateName(branchName);
    const incoming = Git.fromBundle(bundle);
    const source = incoming.branches.get(branchName);
    if (!source?.commit) throw new Error(`No commits to push on branch: ${branchName}`);
    const target = this.branches.get(branchName);
    if ((target?.commit?.id ?? null) !== expectedTip) throw new Error('Remote branch changed; fetch and retry');
    if (!this.isAncestor(target?.commit ?? null, source.commit)) throw new Error('Non-fast-forward push: remote history would be lost');
    if (target === this.HEAD && this.isStaged) throw new Error('Remote has staged changes; commit them before receiving a push');
    for (const [id, commit] of incoming.commits) this.commits.set(id, commit);
    if (target) target.commit = this.commits.get(source.commit.id);
    else this.branches.set(branchName, new Branch(branchName, this.commits.get(source.commit.id)));
    if (target === this.HEAD) this.index = snapshot(this.files);
    return source.commit.id;
  }
}
