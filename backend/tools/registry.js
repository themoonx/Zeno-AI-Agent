


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




for (const t of localTools) registerTool(t);




export function defaultCatalog() {
  return new Map(registry);
}



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
