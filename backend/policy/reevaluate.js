



import { publish, topics } from '../core/eventbus.js';
import { logger } from '../core/logger.js';

const log = logger('policy');

export function createPolicyReevaluator({ repos, policy }) {
  
  function reevaluatePending(userId) {
    let resolved = 0;
    for (const approval of repos.runs.listPendingApprovals(userId)) {
      const payload = approval.payload || {};
      const tool = { name: approval.tool, sensitive: true };
      policy
        .evaluate({ userId, tool, args: payload, mode: repos.users.getSetting(userId, 'permission_mode') || 'ask' })
        .then((verdict) => {
          if (verdict.decision === 'allow') {
            repos.runs.decideApproval(userId, approval.id, 'approved', 'policy');
            publish(topics.userEvents(userId), { type: 'approval_decided', approvalId: approval.id });
            resolved++;
          } else if (verdict.decision === 'deny') {
            repos.runs.decideApproval(userId, approval.id, 'denied', 'policy');
            publish(topics.userEvents(userId), { type: 'approval_decided', approvalId: approval.id });
            resolved++;
          }
        })
        .catch((err) => log.warn(`re-evaluation failed for ${approval.id}: ${err.message}`));
    }
    return resolved;
  }

  return { reevaluatePending };
}