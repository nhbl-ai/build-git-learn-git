import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Git, sameFiles, validatePath } from './git.js';

const METADATA = '.learn-git';
const EXCLUDED = new Set(['.git', METADATA, 'node_modules']);

function stat(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function metadata(root) {
  const path = join(root, METADATA);
  const info = stat(path);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) throw new Error('Not a Learn Git repository; run init first');
  return path;
}

function safeFile(root, path) {
  validatePath(path);
  let current = root;
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const info = stat(current);
    if (info?.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${path}`);
    if (info && i < parts.length - 1 && !info.isDirectory()) throw new Error(`File blocks directory: ${path}`);
    if (info && i === parts.length - 1 && !info.isFile()) throw new Error(`Path is not a regular file: ${path}`);
  }
  return current;
}

function saveRepository(root, repository) {
  const directory = metadata(root);
  const temporary = join(directory, `state-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(repository), { flag: 'wx' });
    renameSync(temporary, join(directory, 'state.json'));
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function loadRepository(root) {
  const state = join(metadata(root), 'state.json');
  const info = stat(state);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error('Invalid repository state file');
  return Git.fromJSON(JSON.parse(readFileSync(state, 'utf8')));
}

export function initializeRepository(root, name = basename(resolve(root))) {
  mkdirSync(root, { recursive: true });
  root = realpathSync(root);
  const path = join(root, METADATA);
  if (stat(path)) throw new Error('Repository already exists');
  const repository = new Git(name, { defaultBranch: 'main' });
  mkdirSync(path);
  saveRepository(root, repository);
  return repository;
}

export function assertClean(root, repository) {
  if (repository.isStaged) throw new Error('Commit staged changes before updating the working tree');
  assertTrackedClean(root, repository.files);
}

function assertTrackedClean(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const target = safeFile(root, path);
    if (!stat(target) || readFileSync(target).toString('base64') !== content) {
      throw new Error(`Uncommitted change would be overwritten: ${path}`);
    }
  }
}

/** Preflight every path before writing; return an undo action for a failed state save. */
function applyWorkingTree(root, before, after) {
  assertTrackedClean(root, before);
  const changes = [];
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[path] === after[path]) continue;
    const target = safeFile(root, path);
    if (before[path] === undefined && stat(target)) throw new Error(`Untracked file would be overwritten: ${path}`);
    changes.push({ target, before: before[path], after: after[path] });
  }
  const applied = [];
  const undo = () => {
    for (const change of applied.reverse()) {
      if (change.before === undefined) { if (stat(change.target)) unlinkSync(change.target); }
      else writeFileSync(change.target, Buffer.from(change.before, 'base64'));
    }
  };
  try {
    for (const change of changes) {
      applied.push(change);
      if (change.after === undefined) unlinkSync(change.target);
      else {
        mkdirSync(dirname(change.target), { recursive: true });
        writeFileSync(change.target, Buffer.from(change.after, 'base64'));
      }
    }
  } catch (error) { undo(); throw error; }
  return undo;
}

/** A short-lived lock prevents a CLI command and an incoming push losing each other's state. */
export async function mutateRepository(root, action, { checkout = false } = {}) {
  root = realpathSync(root);
  const lock = join(metadata(root), 'lock');
  let descriptor;
  try { descriptor = openSync(lock, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Repository is busy; retry after the other command finishes');
    throw error;
  }
  let undo;
  try {
    const repository = loadRepository(root);
    const before = repository.files;
    const result = await action(repository);
    if (checkout && !sameFiles(before, repository.files)) undo = applyWorkingTree(root, before, repository.files);
    saveRepository(root, repository);
    return result;
  } catch (error) { if (undo) undo(); throw error; }
  finally { closeSync(descriptor); unlinkSync(lock); }
}

function walk(root, directory = root) {
  const result = [];
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (EXCLUDED.has(item.name.toLowerCase())) continue;
    const absolute = join(directory, item.name);
    const path = relative(root, absolute).split(sep).join('/');
    if (item.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${path}`);
    if (item.isDirectory()) result.push(...walk(root, absolute));
    else if (item.isFile()) { validatePath(path); result.push(path); }
  }
  return result.sort();
}

export function stagePaths(root, repository, paths) {
  if (!paths.length) throw new Error('Usage: add <file|directory|.> [...]');
  for (const input of paths) {
    const absolute = resolve(root, input);
    const path = relative(root, absolute).split(sep).join('/');
    if (path) validatePath(path);
    // Never traverse symlink directories, including the explicit add argument.
    let current = root;
    for (const part of path ? path.split('/') : []) {
      current = join(current, part);
      if (stat(current)?.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${path}`);
    }
    if (path.split('/').some(part => EXCLUDED.has(part.toLowerCase()))) throw new Error(`Excluded path: ${path}`);
    const info = stat(absolute);
    const tracked = Object.keys(repository.index).filter(file => !path || file === path || file.startsWith(`${path}/`));
    if (!info && !tracked.length) throw new Error(`Path does not exist: ${input}`);
    const files = info?.isDirectory() ? walk(root, absolute) : info?.isFile() ? [path] : [];
    const found = new Set(files);
    for (const file of tracked) if (!found.has(file)) repository.remove(file);
    for (const file of files) repository.add(file, readFileSync(safeFile(root, file)));
  }
}

export function repositoryStatus(root, repository) {
  const paths = new Set([...Object.keys(repository.files), ...Object.keys(repository.index), ...walk(root)]);
  const changes = [];
  for (const path of [...paths].sort()) {
    const base = repository.files[path];
    const indexed = repository.index[path];
    const target = safeFile(root, path);
    const working = stat(target) ? readFileSync(target).toString('base64') : undefined;
    const kind = (before, after) => before === after ? ' ' : before === undefined ? 'A' : after === undefined ? 'D' : 'M';
    if (base === undefined && indexed === undefined) changes.push({ path, staged: '?', unstaged: '?' });
    else {
      const staged = kind(base, indexed);
      const unstaged = kind(indexed, working);
      if (staged !== ' ' || unstaged !== ' ') changes.push({ path, staged, unstaged });
    }
  }
  return changes;
}

export function createCloneDirectory(root, repository) {
  if (stat(root) && (!stat(root).isDirectory() || stat(root).isSymbolicLink() || readdirSync(root).length)) {
    throw new Error('Clone destination must be a new or empty directory');
  }
  mkdirSync(root, { recursive: true });
  root = realpathSync(root);
  const undo = applyWorkingTree(root, {}, repository.files);
  try { mkdirSync(join(root, METADATA)); saveRepository(root, repository); }
  catch (error) { undo(); throw error; }
}
