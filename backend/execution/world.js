














import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { getAgentRegistry } from '../realtime/registry.js';
import { localBridgeEnabled, resolveWithinRoots as resolveRoot, clip } from './local-fs.js';
import { execCommand, execCode } from './shell.js';
import {
  fileReadTool,
  fileListTool,
  fileWriteTool,
  fileEditTool,
  fileDeleteTool,
  workspaceDirFor,
} from '../tools/file-tools.js';

const log = logger('world');




function createWorkspaceWorld({ userId }) {
  const root = workspaceDirFor(userId);
  
  
  return {
    id: `workspace:${userId}`,
    kind: 'workspace',
    available: () => true,
    capabilities: ['fs', 'shell'],
    fs: {
      read(relPath, opts = {}) {
        return fileReadTool.execute({ path: relPath, max_chars: opts.maxChars }, { userId });
      },
      list(relPath, recursive = false) {
        return fileListTool.execute({ path: relPath || '.', recursive }, { userId });
      },
      write(relPath, content) {
        return fileWriteTool.execute({ path: relPath, content }, { userId });
      },
      edit(relPath, { find, replace, replace_all = false } = {}) {
        return fileEditTool.execute({ path: relPath, find, replace, replace_all }, { userId });
      },
      delete(relPath) {
        return fileDeleteTool.execute({ path: relPath }, { userId });
      },
    },
    shell: {
      exec(command) {
        return execCommand(command, { cwd: root });
      },
      code(code, language) {
        return execCode(code, language, { cwd: root });
      },
    },
  };
}


function createLocalAgentWorld({ userId }) {
  const registry = getAgentRegistry();
  const viaDaemon = async (op, params) => {
    if (!registry.isOnline(userId)) return null;
    try {
      return await registry.relay(userId, op, params, { timeoutMs: config.agent.toolTimeoutMs });
    } catch (err) {
      if (/No local agent is connected/.test(err.message)) return null;
      throw err;
    }
  };
  return {
    id: `local-agent:${userId}`,
    kind: 'local-agent',
    available: () => registry.isOnline(userId) || localBridgeEnabled(),
    capabilities: ['fs', 'shell'],
    fs: {
      async read(absPath) {
        const via = await viaDaemon('fs.read', { path: absPath });
        if (via) return via;
        const { target } = resolveRoot(absPath);
        const stat = await fs.stat(target);
        if (stat.isDirectory()) throw new Error(`${target} is a directory`);
        const buf = await fs.readFile(target);
        if (buf.subarray(0, 8192).includes(0)) throw new Error('Binary file — text tools cannot read it');
        return { ok: true, path: target, size: stat.size, content: buf.toString('utf8'), truncated: false };
      },
      async list(absPath, recursive = false) {
        const via = await viaDaemon('fs.list', { path: absPath, recursive });
        if (via) return via;
        const { target, root } = resolveRoot(absPath);
        const stat = await fs.stat(target);
        if (!stat.isDirectory()) throw new Error(`${target} is not a directory`);
        const entries = [];
        const rel = (p) => (recursive ? path.relative(root, p) || path.basename(p) : path.basename(p));
        if (recursive) {
          const stack = [target];
          while (stack.length && entries.length < 500) {
            const dir = stack.pop();
            for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
              const full = path.join(dir, ent.name);
              if (ent.isDirectory()) { stack.push(full); entries.push({ path: rel(full), type: 'dir' }); }
              else { const st = await fs.stat(full).catch(() => null); entries.push({ path: rel(full), type: 'file', size: st?.size ?? null }); }
            }
          }
        } else {
          for (const ent of await fs.readdir(target, { withFileTypes: true })) {
            entries.push({ path: ent.name, type: ent.isDirectory() ? 'dir' : 'file' });
          }
        }
        return { ok: true, path: target, entries };
      },
      async write(absPath, content) {
        const via = await viaDaemon('fs.write', { path: absPath, content });
        if (via) return via;
        const { target, root } = resolveRoot(absPath);
        if (norm(target) === norm(root)) throw new Error('Refusing to overwrite an authorized root itself');
        const body = String(content ?? '');
        if (Buffer.byteLength(body, 'utf8') > config.localBridge.maxWriteBytes) throw new Error(`Content exceeds the ${config.localBridge.maxWriteBytes} byte write limit`);
        await fs.mkdir(path.dirname(target), { recursive: true });
        const existed = await fs.stat(target).then(() => true).catch(() => false);
        await fs.writeFile(target, body, 'utf8');
        const st = await fs.stat(target);
        log.info(`local write ${target} (${st.size}B)`);
        return { ok: true, path: target, bytesWritten: st.size, created: !existed, preview: clip(body) };
      },
      async edit(absPath, { find, replace, replace_all = false } = {}) {
        const via = await viaDaemon('fs.edit', { path: absPath, find, replace, replace_all });
        if (via) return via;
        const { target, root } = resolveRoot(absPath);
        if (norm(target) === norm(root)) throw new Error('Refusing to edit an authorized root itself');
        const stat = await fs.stat(target);
        if (stat.size > config.localBridge.maxWriteBytes) throw new Error(`File exceeds the ${config.localBridge.maxWriteBytes} byte edit limit`);
        const buf = await fs.readFile(target);
        if (buf.subarray(0, 8192).includes(0)) throw new Error('Binary file — text tools cannot edit it');
        const text = buf.toString('utf8');
        if (!find) throw new Error('find must not be empty');
        const occurrences = text.split(find).length - 1;
        if (occurrences === 0) throw new Error('Snippet not found in file — nothing was changed');
        if (occurrences > 1 && !replace_all) throw new Error(`Snippet matches ${occurrences} times; pass replace_all or include more surrounding context`);
        const updated = replace_all ? text.split(find).join(replace) : text.replace(find, () => replace);
        await fs.writeFile(target, updated, 'utf8');
        log.info(`local edit ${target} (${occurrences} replacement(s))`);
        return { ok: true, path: target, replacements: replace_all ? occurrences : 1, size: stat.size, preview: clip(updated) };
      },
      async delete(absPath) {
        const via = await viaDaemon('fs.delete', { path: absPath });
        if (via) return via;
        const { target, root } = resolveRoot(absPath);
        if (norm(target) === norm(root)) throw new Error('Refusing to delete an authorized root');
        const stat = await fs.stat(target);
        if (stat.isDirectory()) throw new Error('Refusing to delete a directory — delete files individually');
        await fs.unlink(target);
        log.info(`local delete ${target}`);
        return { ok: true, path: target, deleted: true };
      },
    },
    
    
    shell: {
      exec(command) {
        return (async () => {
          const via = await viaDaemon('shell.exec', { command });
          if (via) return via;
          throw new Error('Shell execution requires a paired local agent started with --allow-shell, or the Docker sandbox (ZENO_SANDBOX_URL).');
        })();
      },
      code(code, language) {
        return (async () => {
          const via = await viaDaemon('code.exec', { code, language });
          if (via) return via;
          throw new Error('Code execution requires a paired local agent started with --allow-shell, or the Docker sandbox (ZENO_SANDBOX_URL).');
        })();
      },
    },
  };
}

function norm(p) {
  const r = path.resolve(String(p || ''));
  return process.platform === 'win32' ? r.toLowerCase() : r;
}



export function createWorldRegistry() {
  const providers = new Map(); 

  function registerProvider(kind, factory) {
    providers.set(kind, factory);
  }

  registerProvider('workspace', ({ userId }) => createWorkspaceWorld({ userId }));
  registerProvider('local-agent', ({ userId }) => createLocalAgentWorld({ userId }));

  
  function resolve(kind, { userId }) {
    const factory = providers.get(kind);
    if (!factory) throw new Error(`Unknown execution world: ${kind}`);
    const world = factory({ userId });
    if (!world.available()) throw new Error(`Execution world "${kind}" is not available`);
    return world;
  }

  function tryResolve(kind, { userId }) {
    try {
      return resolve(kind, { userId });
    } catch {
      return null;
    }
  }

  return { registerProvider, resolve, tryResolve, providers: [...providers.keys()] };
}

let worldRegistry = null;
export function getWorldRegistry() {
  if (!worldRegistry) worldRegistry = createWorldRegistry();
  return worldRegistry;
}
