#!/usr/bin/env node
import { resolve, basename } from 'node:path';
import { networkInterfaces } from 'node:os';
import { once } from 'node:events';
import { createRemoteServer, clone, fetchRemote, pull, push } from './remote.js';
import {
  assertClean, createCloneDirectory, initializeRepository, loadRepository,
  mutateRepository, repositoryStatus, stagePaths,
} from './repository.js';

const HELP = `Learn Git — educational repositories with LAN sharing

Usage: node src/cli.js [-C <directory>] <command>

  init [name]                         Initialize a repository (main branch)
  add <file|directory|.> [...]         Stage files, including tracked deletions
  commit <message>                    Commit the staged snapshot
  status                              Show staged/unstaged/untracked changes
  log [branch]                        Show commit history, newest first
  branch                              List local and fetched branches
  checkout <branch>                   Switch to a branch, creating it if absent
  remote add <name> <url>              Configure a peer, e.g. http://192.168.1.10:9418
  remote                              List configured peers
  serve [--host <host>] [--port <n>]    Serve this repository (default 0.0.0.0:9418)
  clone <url> <directory>              Copy committed history and files from a peer
  fetch [remote]                      Fetch history without changing local files
  pull [remote] [branch]              Fetch and fast-forward the current branch
  push [remote] [branch]              Send a branch without overwriting remote history

Remote defaults to origin; branch defaults to the current branch.
Optional shared authentication: set LEARN_GIT_TOKEN on both machines.
Repository data lives in .learn-git, independently of real Git.`;

function argumentsCount(args, min, max = min) {
  if (args.length < min || args.length > max) throw new Error('Invalid arguments; use help to see command usage');
}

async function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  if (args[0] === '-C') {
    args.shift();
    const directory = args.shift();
    if (!directory) throw new Error('-C requires a directory');
    root = resolve(directory);
  }
  const command = args.shift() ?? 'help';
  const options = { token: process.env.LEARN_GIT_TOKEN || undefined };
  switch (command) {
    case 'help': case '--help': case '-h':
      console.log(HELP);
      break;
    case 'init':
      argumentsCount(args, 0, 1);
      initializeRepository(root, args[0]);
      console.log(`Initialized ${resolve(root)} on main`);
      break;
    case 'add':
      await mutateRepository(root, repo => stagePaths(root, repo, args));
      console.log('Staged files');
      break;
    case 'commit':
      argumentsCount(args, 1);
      console.log(await mutateRepository(root, repo => {
        if (!repo.isStaged) throw new Error('Nothing staged to commit');
        const commit = repo.commit(args[0]);
        return `${commit.id.slice(0, 12)} ${commit.message}`;
      }));
      break;
    case 'status': {
      argumentsCount(args, 0);
      const repo = loadRepository(root);
      console.log(`On branch ${repo.HEAD.name}`);
      const changes = repositoryStatus(root, repo);
      console.log(changes.length ? changes.map(item => `${item.staged}${item.unstaged} ${item.path}`).join('\n') : 'Working tree clean');
      break;
    }
    case 'log': {
      argumentsCount(args, 0, 1);
      const history = loadRepository(root).log(args[0]);
      console.log(history.length ? history.map(commit => `${commit.id.slice(0, 12)} ${commit.message}`).join('\n') : 'No commits yet');
      break;
    }
    case 'branch': {
      argumentsCount(args, 0);
      const repo = loadRepository(root);
      for (const branch of repo.branches.values()) console.log(`${branch === repo.HEAD ? '*' : ' '} ${branch.name}`);
      for (const [remote, refs] of repo.remoteRefs) for (const ref of refs) console.log(`  ${remote}/${ref.name}`);
      break;
    }
    case 'checkout':
      argumentsCount(args, 1);
      await mutateRepository(root, repo => { assertClean(root, repo); repo.checkout(args[0]); }, { checkout: true });
      console.log(`On branch ${args[0]}`);
      break;
    case 'remote':
      if (!args.length) {
        for (const [name, url] of loadRepository(root).remotes) console.log(`${name}\t${url}`);
      } else {
        argumentsCount(args, 3);
        if (args[0] !== 'add') throw new Error('Usage: remote add <name> <url>');
        await mutateRepository(root, repo => repo.addRemote(args[1], args[2]));
        console.log(`Added remote ${args[1]}`);
      }
      break;
    case 'fetch':
      argumentsCount(args, 0, 1);
      console.log(await mutateRepository(root, async repo => {
        const refs = await fetchRemote(repo, args[0], options);
        return refs.map(ref => `${args[0] ?? 'origin'}/${ref.name} ${ref.commit?.slice(0, 12) ?? '(empty)'}`).join('\n');
      }));
      break;
    case 'pull':
      argumentsCount(args, 0, 2);
      await mutateRepository(root, async repo => { assertClean(root, repo); await pull(repo, args[0], args[1], options); }, { checkout: true });
      console.log('Pulled; working tree is up to date');
      break;
    case 'push':
      argumentsCount(args, 0, 2);
      console.log(`Pushed ${await mutateRepository(root, repo => push(repo, args[0], args[1], options))}`);
      break;
    case 'clone': {
      argumentsCount(args, 2);
      const destination = resolve(root, args[1]);
      const repo = await clone(args[0], { ...options, name: basename(destination) });
      createCloneDirectory(destination, repo);
      console.log(`Cloned into ${destination}`);
      break;
    }
    case 'serve': {
      let host = '0.0.0.0';
      let port = 9418;
      while (args.length) {
        const flag = args.shift();
        const value = args.shift();
        if (!value) throw new Error(`Missing value for ${flag}`);
        if (flag === '--host') host = value;
        else if (flag === '--port' && /^\d+$/.test(value)) port = Number(value);
        else throw new Error(`Unknown or invalid option: ${flag}`);
      }
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be between 0 and 65535');
      root = resolve(root);
      loadRepository(root);
      const server = createRemoteServer(null, {
        ...options, readRepository: () => loadRepository(root),
        updateRepository: action => mutateRepository(root, action, { checkout: true }),
      });
      server.listen(port, host);
      await once(server, 'listening');
      const actualPort = server.address().port;
      console.log(`Serving ${root} on http://${host.includes(':') ? `[${host}]` : host}:${actualPort}`);
      if (host === '0.0.0.0') {
        for (const addresses of Object.values(networkInterfaces())) {
          for (const address of addresses ?? []) if (address.family === 'IPv4' && !address.internal) console.log(`LAN address: http://${address.address}:${actualPort}`);
        }
      }
      console.log(options.token ? 'Shared token authentication enabled' : 'Token not set; peers on this network can read and push');
      console.log('Leave this terminal running. Press Ctrl+C to stop.');
      const stop = () => { server.close(); server.closeAllConnections(); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      break;
    }
    default: throw new Error(`Unknown command: ${command}; use help to see command usage`);
  }
}

main().catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
