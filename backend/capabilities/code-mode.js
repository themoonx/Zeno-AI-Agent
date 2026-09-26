






import vm from 'node:vm';
import { randomId } from '../core/crypto.js';
import { logger } from '../core/logger.js';

const log = logger('code-mode');
const MAX_WALL_MS = 60_000;
const MAX_CALLS = 25;
const MAX_OUTPUT_CHARS = 24_000;

export function createCodeOrchestrateTool({ repos, executor }) {
  return {
    name: 'code_orchestrate',
    displayName: 'Code Orchestration',
    description:
      'Run a short JavaScript program that orchestrates multiple tool calls in one step via `await tools.call(name, args)`. Use when many small tool operations compose into one logical step (e.g. search 3 sources then write one summary file). All calls still pass permission checks. No filesystem or network access exists inside the sandbox beyond the tools.',
    sensitive: true,
    permissionClass: 'code.mode',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript (async). API: await tools.call("tool_name", {args}); helper: log(...) collects notes. Return a value (JSON-serializable) for the final result.' },
      },
      required: ['code'],
    },
    approvalSummary: () => 'Run a code-orchestration snippet that calls multiple tools',

    async execute(args, { userId, runId, sessionId, signal, emit, memory }) {
      const code = String(args.code || '');
      if (!code.trim()) throw new Error('code is required');
      const catalog = (await import('../tools/registry.js')).defaultCatalog();

      let callCount = 0;
      const logs = [];
      const sandboxConsole = { log: (...parts) => logs.push(parts.map((p) => (typeof p === 'object' ? JSON.stringify(p) : String(p))).join(' ')) };

      const tools = {
        
        call: async (name, callArgs) => {
          if (callCount >= MAX_CALLS) throw new Error(`Budget exceeded: more than ${MAX_CALLS} tool calls in one snippet`);
          callCount++;
          if (signal?.aborted) throw new Error('Aborted');
          const tool = catalog.get(String(name));
          if (!tool) throw new Error(`Unknown tool: ${name}`);
          const outcome = await executor.execute({
            tool,
            args: callArgs || {},
            callId: randomId('call'),
            userId,
            runId,
            sessionId,
            scopeKey: sessionId,
            conversationId: sessionId,
            mode: repos.users.getSetting(userId, 'permission_mode') || 'ask',
            signal,
            emit,
            memory,
          });
          if (!outcome.ok && !outcome.denied) throw new Error(`Tool ${name} failed: ${String(outcome.output || '').slice(0, 300)}`);
          if (outcome.denied) throw new Error(`Tool ${name} was denied by the user — stop and explain instead of retrying.`);
          try {
            return JSON.parse(outcome.output);
          } catch {
            return outcome.output;
          }
        },
      };

      const started = Date.now();
      const context = vm.createContext({
        tools,
        console: sandboxConsole,
        setTimeout: (fn, ms) => {
          if (ms > 5000) throw new Error('setTimeout capped at 5000ms inside code mode');
          return setTimeout(fn, Math.min(ms, 5000));
        },
        clearTimeout,
        JSON, Math, Date, Boolean, Number, String, Array, Object, RegExp, Error,
      });

      let result;
      try {
        result = await vm.runInContext(`(async () => {\n${code}\n})()`, context, { timeout: MAX_WALL_MS, displayErrors: true });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        
        if (/Script execution timed out/.test(err.message)) {
          throw new Error(`Code-mode budget exceeded (${MAX_WALL_MS / 1000}s wall time)`);
        }
        log.warn(`code-mode snippet failed: ${err.message}`);
        throw new Error(`Code-mode error: ${err.message}`);
      }

      let output = JSON.stringify({ ok: true, calls: callCount, durationMs: Date.now() - started, logs: logs.slice(0, 40), result: result ?? null }, null, 1);
      if (output.length > MAX_OUTPUT_CHARS) output = output.slice(0, MAX_OUTPUT_CHARS) + '\n[output truncated]';
      return JSON.parse(output);
    },
  };
}
