





import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../core/config.js';

const PREVIEW_CHARS = 16_000; 

export function workspaceDirFor(userId) {
  return path.join(config.workspacesDir, userId);
}

function resolveInWorkspace(userId, relPath) {
  const workspace = workspaceDirFor(userId);
  const target = path.resolve(workspace, String(relPath || '.'));
  if (target !== workspace && !target.startsWith(workspace + path.sep)) {
    throw new Error('Path escapes the workspace sandbox');
  }
  return target;
}

function clip(text) {
  const s = String(text ?? '');
  return s.length > PREVIEW_CHARS ? { content: s.slice(0, PREVIEW_CHARS), truncated: true } : { content: s, truncated: false };
}

export const fileReadTool = {
  name: 'file_read',
  displayName: 'Read File',
  description: 'Read a text file from your workspace. Paths are relative to the workspace root.',
  sensitive: false,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace root' },
      max_chars: { type: 'integer', description: 'Max characters to return', default: 20000 },
    },
    required: ['path'],
  },
  async execute(args, { userId }) {
    const target = resolveInWorkspace(userId, args.path);
    const stat = await fs.stat(target);
    if (stat.isDirectory()) throw new Error(`${args.path} is a directory`);
    const maxChars = Math.min(60_000, Math.max(200, Number(args.max_chars) || 20_000));
    const content = await fs.readFile(target, 'utf8');
    return {
      ok: true,
      path: args.path,
      size: stat.size,
      content: content.length > maxChars ? content.slice(0, maxChars) + '\n\n[truncated]' : content,
      truncated: content.length > maxChars,
    };
  },
};

export const fileListTool = {
  name: 'file_list',
  displayName: 'List Files',
  description: 'List files and directories in your workspace (optionally a subdirectory).',
  sensitive: false,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory relative to the workspace root', default: '.' },
      recursive: { type: 'boolean', default: false },
    },
  },
  async execute(args, { userId }) {
    const root = resolveInWorkspace(userId, args.path || '.');
    await fs.mkdir(workspaceDirFor(userId), { recursive: true });
    const entries = [];
    if (args.recursive) {
      const stack = [root];
      while (stack.length && entries.length < 500) {
        const dir = stack.pop();
        for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            stack.push(full);
            entries.push({ path: path.relative(root, full), type: 'dir' });
          } else {
            const st = await fs.stat(full).catch(() => null);
            entries.push({ path: path.relative(root, full), type: 'file', size: st?.size ?? null });
          }
        }
      }
    } else {
      for (const ent of await fs.readdir(root, { withFileTypes: true })) {
        entries.push({ path: ent.name, type: ent.isDirectory() ? 'dir' : 'file' });
      }
    }
    return { ok: true, path: args.path || '.', entries };
  },
};

export const fileWriteTool = {
  name: 'file_write',
  displayName: 'Write File',
  description: 'Create or overwrite a text file in your workspace (confined to the workspace sandbox).',
  sensitive: false,
  workspaceSafe: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace root' },
      content: { type: 'string', description: 'Full file contents to write' },
    },
    required: ['path', 'content'],
  },
  approvalSummary: (args) => `Write workspace file ${args?.path}`,
  async execute(args, { userId }) {
    const target = resolveInWorkspace(userId, args.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const body = String(args.content ?? '');
    const existed = await fs
      .stat(target)
      .then(() => true)
      .catch(() => false);
    await fs.writeFile(target, body, 'utf8');
    const st = await fs.stat(target);
    const preview = clip(body);
    return { ok: true, path: args.path, bytesWritten: st.size, created: !existed, preview };
  },
};

export const fileEditTool = {
  name: 'file_edit',
  displayName: 'Edit File',
  description:
    'Edit an existing text file in your workspace by replacing an exact snippet. Fails if the snippet is not found or matches more than once (pass replace_all to replace every occurrence).',
  sensitive: false,
  workspaceSafe: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace root' },
      find: { type: 'string', description: 'Exact text to replace' },
      replace: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence instead of exactly one', default: false },
    },
    required: ['path', 'find', 'replace'],
  },
  approvalSummary: (args) => `Edit workspace file ${args?.path}`,
  async execute(args, { userId }) {
    const target = resolveInWorkspace(userId, args.path);
    const original = await fs.readFile(target, 'utf8');
    const find = String(args.find ?? '');
    const replace = String(args.replace ?? '');
    if (!find) throw new Error('find must not be empty');
    const occurrences = original.split(find).length - 1;
    if (occurrences === 0) throw new Error('Snippet not found in file — nothing was changed');
    if (occurrences > 1 && !args.replace_all) {
      throw new Error(`Snippet matches ${occurrences} times; pass replace_all to replace every occurrence, or include more surrounding context`);
    }
    const updated = args.replace_all ? original.split(find).join(replace) : original.replace(find, () => replace);
    await fs.writeFile(target, updated, 'utf8');
    const st = await fs.stat(target);
    const preview = clip(updated);
    return { ok: true, path: args.path, replacements: args.replace_all ? occurrences : 1, size: st.size, preview };
  },
};

export const fileDeleteTool = {
  name: 'file_delete',
  displayName: 'Delete File',
  description: 'Delete a file from your workspace (confined to the workspace sandbox).',
  sensitive: true,
  workspaceSafe: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace root' },
    },
    required: ['path'],
  },
  approvalSummary: (args) => `Delete workspace file ${args?.path}`,
  async execute(args, { userId }) {
    const target = resolveInWorkspace(userId, args.path);
    await fs.unlink(target);
    return { ok: true, path: args.path, deleted: true };
  },
};
