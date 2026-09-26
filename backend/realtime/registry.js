



import { logger } from '../core/logger.js';

const log = logger('realtime');

export function createAgentRegistry() {
  
  const online = new Map();

  function register(userId, agentId, socket, agent) {
    if (!online.has(userId)) online.set(userId, new Map());
    online.get(userId).set(agentId, { socket, agent, connectedAt: Date.now() });
    log.info(`local agent ${agentId} (${agent?.name}) online for user ${userId}`);
  }

  function unregister(userId, agentId) {
    online.get(userId)?.delete(agentId);
    if (online.get(userId)?.size === 0) online.delete(userId);
    log.info(`local agent ${agentId} disconnected for user ${userId}`);
  }

  function isOnline(userId, agentId = null) {
    const set = online.get(userId);
    if (!set || set.size === 0) return false;
    if (agentId) return set.has(agentId);
    return true;
  }

  function list(userId) {
    return [...(online.get(userId)?.keys() || [])];
  }

  
  function relay(userId, op, params = {}, { agentId = null, timeoutMs = 30_000 } = {}) {
    const set = online.get(userId);
    const entry = agentId ? set?.get(agentId) : set?.values().next().value;
    if (!entry) {
      return Promise.reject(new Error('No local agent is connected. Pair one in Settings → Environments.'));
    }
    const { socket } = entry;
    const id = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.removeEventListener('message', onMessage);
        reject(new Error(`Local agent did not answer within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      const onMessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.type === 'result' && msg.id === id) {
          clearTimeout(timer);
          socket.removeEventListener('message', onMessage);
          if (msg.ok) resolve(msg.result);
          else reject(new Error(msg.error || 'Local agent operation failed'));
        }
      };
      socket.addEventListener('message', onMessage);
      socket.send(JSON.stringify({ type: 'op', id, op, params }));
    });
  }

  return { register, unregister, isOnline, list, relay };
}

let singleton = null;
export function getAgentRegistry() {
  if (!singleton) singleton = createAgentRegistry();
  return singleton;
}
