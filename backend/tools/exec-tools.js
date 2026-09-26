




import fs from 'node:fs/promises';
import { workspaceDirFor } from './file-tools.js';
import { execCommand, execCode, sandboxMode } from '../execution/shell.js';

export const terminalTool = {
  name: 'terminal',
  displayName: 'Terminal',
  description:
    'Execute a shell command inside the task sandbox (isolated from the server). Working directory is the task workspace. Requires approval.',
  sensitive: true,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to run, with arguments' },
    },
    required: ['command'],
  },
  async execute(args, { userId, runId }) {
    const cwd = workspaceDirFor(userId);
    await fs.mkdir(cwd, { recursive: true });
    const out = await execCommand(args.command, { runId, cwd });
    return { ok: out.exitCode === 0, ...out };
  },
};

export const codeExecTool = {
  name: 'code_exec',
  displayName: 'Code Execution',
  description:
    'Execute a short code snippet (python or node) in the sandbox and get stdout/stderr. The snippet must print its result. Requires approval.',
  sensitive: true,
  parameters: {
    type: 'object',
    properties: {
      language: { type: 'string', enum: ['python', 'node'], default: 'python' },
      code: { type: 'string', description: 'Complete code to run' },
    },
    required: ['language', 'code'],
  },
  async execute(args, { userId, runId }) {
    const cwd = workspaceDirFor(userId);
    await fs.mkdir(cwd, { recursive: true });
    const out = await execCode(args.code, args.language, { runId, cwd });
    return { ok: out.exitCode === 0, ...out };
  },
};

export { sandboxMode };
