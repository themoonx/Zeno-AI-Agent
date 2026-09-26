


import { randomId } from '../core/crypto.js';
import { config } from '../core/config.js';
import { subscribe, publish, topics } from '../core/eventbus.js';

export function createApprovalGate({ repos }) {
  
  
  
  function request({ runId, userId, tool, args, meta = {} }) {
    const approvalId = randomId('apr');
    const summary =
      typeof tool.approvalSummary === 'function'
        ? tool.approvalSummary(args)
        : `${tool.displayName || tool.name}: ${JSON.stringify(args).slice(0, 300)}`;
    repos.runs.createApproval({
      id: approvalId,
      runId,
      userId,
      tool: tool.name,
      summary,
      payload: { ...args, ...meta },
    });
    publish(topics.userEvents(userId), { type: 'approval_required', approvalId, runId, tool: tool.name, summary });

    return {
      approvalId,
      summary,
      
      promise: new Promise((resolve) => {
        let settled = false;
        const finish = (decision) => {
          if (settled) return;
          settled = true;
          clearInterval(poll);
          unsubscribe?.();
          resolve(decision);
        };
        const check = () => {
          const current = repos.runs.getApproval(userId, approvalId);
          if (current && current.status !== 'pending') finish(current.status);
        };
        
        const unsubscribe = subscribe(topics.userEvents(userId), (event) => {
          if (event?.type === 'approval_decided' && event.approvalId === approvalId) check();
        });
        const poll = setInterval(check, 2000);
        setTimeout(() => {
          
          const current = repos.runs.getApproval(userId, approvalId);
          if (current?.status === 'pending') {
            repos.runs.decideApproval(userId, approvalId, 'denied', 'once');
          }
          check();
        }, config.agent.approvalTimeoutMs);
      }),
    };
  }

  return { request };
}
