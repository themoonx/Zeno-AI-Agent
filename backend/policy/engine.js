












import { presetFor } from './presets.js';
import { wildcardMatch } from './match.js';

export function createPolicyEngine({ repos }) {
  function actionClassOf(tool) {
    if (tool?.permissionClass) return tool.permissionClass;
    const name = String(tool?.name || '');
    if (name.startsWith('local_')) return name.endsWith('_read') || name.endsWith('_list') ? 'fs.read' : name.endsWith('_delete') ? 'fs.delete' : 'fs.write';
    if (name.startsWith('file_')) return name.endsWith('_read') || name.endsWith('_list') ? 'fs.read' : name.endsWith('_delete') ? 'fs.delete' : 'fs.write';
    if (name === 'terminal') return 'shell.exec';
    if (name === 'code_exec') return 'code.exec';
    if (name === 'web_search' || name === 'browser_read') return 'net.read';
    if (name === 'http_request') return 'net.request';
    if (name.startsWith('memory_')) return name === 'memory_write' ? 'memory.write' : 'memory.read';
    if (name === 'skill_load') return 'skill.read';
    if (name === 'delegate') return 'agent.delegate';
    if (name === 'code_orchestrate') return 'code.mode';
    if (tool?.connectorId) return 'mcp.call';
    if (tool?.pluginId) return 'plugin.call';
    return 'misc';
  }

  function resourceOf(tool, args) {
    if (!args) return '*';
    if (typeof args.path === 'string') return args.path;
    if (typeof args.command === 'string') return '*';
    if (tool?.connectorId) return tool.connectorId;
    return tool?.pluginId || '*';
  }

  function subjectMatches(subject, { actionClass, resource, tool }) {
    const [classPart, ...rest] = String(subject).split(':');
    const pattern = rest.join(':');
    if (classPart !== actionClass && classPart !== '*') return false;
    if (!pattern || pattern === '*') return true;
    if (classPart === 'mcp') return wildcardMatch(pattern, tool?.connectorId || '') || wildcardMatch(pattern, tool?.name || '');
    if (classPart === 'plugin') return wildcardMatch(pattern, tool?.pluginId || '') || wildcardMatch(pattern, tool?.name || '');
    if (classPart.startsWith('fs')) {
      return wildcardMatch(pattern, String(resource).replace(/\\/g, '/'), { nocase: true });
    }
    return wildcardMatch(pattern, String(resource));
  }

  
  async function evaluate({ userId, tool, args, mode }) {
    const actionClass = actionClassOf(tool);
    const resource = resourceOf(tool, args);
    const preset = presetFor(mode);

    
    if (!tool?.sensitive) {
      return { decision: 'allow', reason: 'read-only capability' };
    }

    let rules = [];
    try {
      rules = repos.policy.listForDecision(userId);
    } catch {
      
    }

    
    for (const rule of rules) {
      if (rule.effect === 'deny' && subjectMatches(rule.subject, { actionClass, resource, tool })) {
        return { decision: 'deny', reason: `deny rule "${rule.subject}"` };
      }
    }

    
    if (preset.id === 'full') {
      return { decision: 'allow', reason: 'Full Access preset' };
    }

    
    for (const rule of rules) {
      if (rule.effect === 'deny') continue;
      if (subjectMatches(rule.subject, { actionClass, resource, tool })) {
        return { decision: rule.effect, reason: `rule "${rule.subject}" → ${rule.effect}` };
      }
    }

    
    const baseline = preset.autoClasses.includes(actionClass)
      ? 'allow'
      : preset.workspaceSafeAuto && tool?.workspaceSafe
        ? 'allow'
        : 'ask';
    return { decision: baseline, reason: `${preset.label} baseline for ${actionClass}` };
  }

  return { evaluate, actionClassOf, resourceOf };
}
