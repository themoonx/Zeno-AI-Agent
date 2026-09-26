









import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { logger } from '../core/logger.js';
import { getAgentRegistry } from './registry.js';

const log = logger('realtime');

export function attachAgentGateway({ server, repos, config }) {
  const wss = new WebSocketServer({ noServer: true });
  const registry = getAgentRegistry();

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname !== '/api/agent-ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    let authed = null; 
    let authTimer = setTimeout(() => ws.close(4001, 'auth timeout'), 10_000);

    const touch = () => {
      if (authed) repos.localAgents.touch(authed.agentId);
    };
    const hb = setInterval(touch, 15_000);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!authed) {
        if (msg.type !== 'auth' || typeof msg.token !== 'string') {
          ws.close(4003, 'auth required');
          return;
        }
        const tokenHash = crypto.createHash('sha256').update(msg.token).digest('hex');
        const agent = repos.localAgents.findByTokenHash(tokenHash);
        if (!agent) {
          ws.close(4003, 'invalid pairing token');
          return;
        }
        clearTimeout(authTimer);
        authed = { userId: agent.userId, agentId: agent.id, agent };
        registry.register(agent.userId, agent.id, ws, agent);
        repos.localAgents.touch(agent.id);
        ws.send(JSON.stringify({ type: 'ready', agentId: agent.id, roots: agent.roots }));
        return;
      }
      if (msg.type === 'heartbeat') {
        touch();
        return;
      }
      
    });

    ws.on('close', () => {
      clearInterval(hb);
      clearTimeout(authTimer);
      if (authed) registry.unregister(authed.userId, authed.agentId);
    });
    ws.on('error', () => {
      clearInterval(hb);
    });
  });

  log.info('agent gateway ready at /api/agent-ws');
  return { wss, registry };
}
