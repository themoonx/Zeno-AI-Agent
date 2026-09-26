










import { getWorldRegistry } from '../execution/world.js';
import { localRoots } from '../execution/local-fs.js';
import { logger } from '../core/logger.js';

const log = logger('local-bridge');
const READ_DEFAULT_CHARS = 24_000;

const worlds = getWorldRegistry();


export function localFsAvailable(userId) {
  return !!worlds.tryResolve('local-agent', { userId });
}

function requireWorld(userId) {
  const world = worlds.tryResolve('local-agent', { userId });
  if (!world) {
    throw new Error(
      'Local computer access is unavailable. Pair a local agent in Settings → Environments (for web deployments), or enable ZENO_LOCAL_BRIDGE=1 with ZENO_LOCAL_ROOTS on the Zeno server.'
    );
  }
  return world;
}

const rootHint = () => `Authorized roots: ${localRoots().join(', ') || 'configured on the paired local agent'}`;

export const localReadTool = {
  name: 'local_read',
  displayName: 'Read Local File',
  description:
    'Read a text file on the local computer (outside the workspace) from an authorized root such as the Desktop. Use an absolute path.',
  sensitive: true,
  workspaceSafe: false,
  permissionClass: 'fs.read',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the file' },
      max_chars: { type: 'integer', description: 'Max characters to return', default: READ_DEFAULT_CHARS },
    },
    required: ['path'],
  },
  approvalSummary: (args) => `Read file ${args?.path} on your computer`,
  async execute(args, { userId }) {
    const world = requireWorld(userId);
    const result = await world.fs.read(args.path);
    const maxChars = Math.min(120_000, Math.max(200, Number(args.max_chars) || READ_DEFAULT_CHARS));
    return {
      ...result,
      content: result.content.length > maxChars ? result.content.slice(0, maxChars) + '\n\n[truncated]' : result.content,
      truncated: result.truncated || result.content.length > maxChars,
    };
  },
};

export const localListTool = {
  name: 'local_list',
  displayName: 'List Local Directory',
  description: 'List the contents of a directory on the local computer (authorized roots only). Use an absolute path.',
  sensitive: true,
  workspaceSafe: false,
  permissionClass: 'fs.read',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute directory path (an authorized root, e.g. the Desktop)' },
      recursive: { type: 'boolean', default: false },
    },
    required: ['path'],
  },
  approvalSummary: (args) => `List directory ${args?.path} on your computer`,
  async execute(args, { userId }) {
    const world = requireWorld(userId);
    return world.fs.list(args.path, !!args.recursive);
  },
};

export const localWriteTool = {
  name: 'local_write',
  displayName: 'Write Local File',
  description:
    'Create or overwrite a text file on the local computer (authorized roots only, e.g. a file on the Desktop). Use an absolute path.',
  sensitive: true,
  workspaceSafe: false,
  permissionClass: 'fs.write',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute file path to create or overwrite' },
      content: { type: 'string', description: 'Full file contents to write' },
    },
    required: ['path', 'content'],
  },
  approvalSummary: (args) => `Write file ${args?.path} on your computer`,
  async execute(args, { userId }) {
    const world = requireWorld(userId);
    const result = await world.fs.write(args.path, args.content);
    log.info(`local_write ${result.path} (${result.bytesWritten}B)`);
    return result;
  },
};

export const localEditTool = {
  name: 'local_edit',
  displayName: 'Edit Local File',
  description:
    'Edit an existing text file on the local computer by replacing an exact snippet (authorized roots only). Fails unless the snippet matches exactly once unless replace_all is set.',
  sensitive: true,
  workspaceSafe: false,
  permissionClass: 'fs.write',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute file path to edit' },
      find: { type: 'string', description: 'Exact text to replace' },
      replace: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', default: false },
    },
    required: ['path', 'find', 'replace'],
  },
  approvalSummary: (args) => `Edit file ${args?.path} on your computer`,
  async execute(args, { userId }) {
    const world = requireWorld(userId);
    const result = await world.fs.edit(args.path, { find: args.find, replace: args.replace, replace_all: !!args.replace_all });
    log.info(`local_edit ${result.path} (${result.replacements} replacement(s))`);
    return result;
  },
};

export const localDeleteTool = {
  name: 'local_delete',
  displayName: 'Delete Local File',
  description: 'Delete a file on the local computer (authorized roots only). Directories and roots themselves are refused.',
  sensitive: true,
  workspaceSafe: false,
  permissionClass: 'fs.delete',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to delete' },
    },
    required: ['path'],
  },
  approvalSummary: (args) => `Delete file ${args?.path} on your computer`,
  async execute(args, { userId }) {
    const world = requireWorld(userId);
    const result = await world.fs.delete(args.path);
    log.info(`local_delete ${result.path}`);
    return result;
  },
};

export const localTools = [localReadTool, localListTool, localWriteTool, localEditTool, localDeleteTool];

export { rootHint as localRootsHint };