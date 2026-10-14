// Tool registry. Adding a tool = registering a descriptor here (or via
// registerTool() from a plugin in the future). The agent runtime and the
// approval system are driven entirely by these descriptors.
import { webSearchTool } from './web-search.js';
import { browserReadTool } from './browser-read.js';
import { httpRequestTool } from './http-request.js';
import { fileReadTool, fileListTool, fileWriteTool, fileEditTool, fileDeleteTool } from './file-tools.js';
import { terminalTool, codeExecTool, sandboxMode } from './exec-tools.js';
import { memorySearchTool } from './memory-tool.js';
import { memoryWriteTool } from './memory-write.js';
import { localTools } from './local-bridge.js';

const registry = new Map();

export function registerTool(tool) {
  if (!tool.name || typeof tool.execute !== 'function') {
    throw new Error(`Invalid tool descriptor: ${tool.name}`);
  }
  registry.set(tool.name, tool);
}

for (const t of [webSearchTool, browserReadTool, httpRequestTool, fileReadTool, fileListTool, fileWriteTool, fileEditTool, fileDeleteTool, terminalTool, codeExecTool, memorySearchTool, memoryWriteTool]) {
  registerTool(t);
}

// Local-computer bridge tools register unconditionally; the harness filters
// them per user (paired local agent online, or server-side bridge enabled), so
// an unconfigured environment simply never offers them to the model.
for (const t of localTools) registerTool(t);

// The built-in tool registry as a Map. The harness composes this with
// connector and plugin tools to build a per-user catalog; callers get a copy so
// they can never mutate the global registry.
export function defaultCatalog() {
  return new Map(registry);
}

// Tool descriptors for a run: only the tools the agent is allowed to use,
// annotated with the current sandbox mode for the terminal/code tools.
export function toolSchemasFor(allowedTools, catalog = registry) {
  const names = allowedTools && allowedTools.length ? allowedTools : [...catalog.keys()];
  return names
    .map((n) => catalog.get(n))
    .filter(Boolean)
    .map((t) => ({
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      sensitive: !!t.sensitive,
      parameters: t.parameters,
    }));
}

export function allToolDescriptors() {
  return [...registry.values()].map((t) => ({
    name: t.name,
    displayName: t.displayName,
    description: t.description,
    sensitive: !!t.sensitive,
    parameters: t.parameters,
  }));
}

export { sandboxMode };
