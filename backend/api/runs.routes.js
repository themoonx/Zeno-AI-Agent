import { Router } from 'express';
import { publish, topics, subscribe } from '../core/eventbus.js';
import { validate } from '../core/validate.js';
import { errors } from '../core/errors.js';

function sseHead(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');
}

export function createRunRoutes({ repos, runs, toolSchemas, sandboxMode, policy, policyReevaluator }) {
  const router = Router();

  router.get('/', (req, res) => {
    const { status, projectId } = req.query;
    const runsList = repos.runs.listRuns(req.auth.userId, { status, projectId });
    res.json({ runs: runsList });
  });

  router.get('/active', (req, res) => {
    res.json({ runs: repos.runs.listActiveRuns(req.auth.userId) });
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = validate(req.body, {
        task: { type: 'string', required: true, min: 1, max: 8000 },
        model: { type: 'object' },
        allowedTools: { type: 'array', items: { type: 'string' } },
        projectId: { type: 'string', max: 64 },
        systemPrompt: { type: 'string', max: 8000 },
      });
      const run = await runs.startRun({
        userId: req.auth.userId,
        agent: {
          name: 'Ad-hoc agent',
          model: body.model || null,
          allowedTools: body.allowedTools || null,
          systemPrompt: body.systemPrompt || null,
          projectId: body.projectId || null,
        },
        task: body.task,
      });
      res.status(202).json({ run });
    } catch (err) {
      next(err);
    }
  });

  router.get('/tools', (req, res) => {
    res.json({ tools: toolSchemas(), sandboxMode: sandboxMode() });
  });

  router.get('/approvals/pending', (req, res) => {
    const pending = repos.runs.listPendingApprovals(req.auth.userId).map((a) => ({
      ...a,
      run: repos.runs.getRun(req.auth.userId, a.runId),
    }));
    res.json({ approvals: pending });
  });

  router.get('/:id', (req, res, next) => {
    try {
      const run = repos.runs.getRun(req.auth.userId, req.params.id);
      if (!run) throw errors.notFound('Run');
      // Events come from the session kernel log (source of truth).
      const session = repos.sessions.activeForRun(run.id) || repos.sessions.activeForConversation(run.conversationId);
      const events = session
        ? repos.sessions.listEvents(session.id).map((ev) => ({ seq: ev.seq, runId: run.id, ts: ev.ts, type: ev.type, data: ev.data }))
        : repos.runs.listEvents(run.id);
      const approvals = repos.runs.listApprovals(run.id);
      res.json({ run, events, approvals });
    } catch (err) {
      next(err);
    }
  });

  // Live event stream for a run (SSE). Replays from ?after=seq on reconnect.
  router.get('/:id/events', (req, res, next) => {
    try {
      const run = repos.runs.getRun(req.auth.userId, req.params.id);
      if (!run) throw errors.notFound('Run');
      const afterSeq = Number(req.query.after) || 0;

      // Events live in the session kernel log (session_events) — the run row
      // is the task anchor, the log is the source of truth.
      const session = repos.sessions.activeForRun(run.id) || repos.sessions.activeForConversation(run.conversationId);
      sseHead(res);

      let lastSeq = afterSeq;
      if (session) {
        const backlog = repos.sessions.listEvents(session.id, { afterSeq });
        for (const ev of backlog) {
          const payload = { seq: ev.seq, runId: run.id, ts: ev.ts, type: ev.type, data: ev.data };
          res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(payload)}\n\n`);
          lastSeq = Math.max(lastSeq, ev.seq);
        }
      }
      let closed = false;

      const unsubscribe = subscribe(topics.runEvents(run.id), (event) => {
        if (closed || (event.seq && event.seq <= lastSeq)) return;
        if (event.seq) lastSeq = event.seq;
        res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        if (!closed) res.write(`:hb ${Date.now()}\n\n`);
      }, 15_000);

      // Close the stream shortly after the run reaches a terminal state.
      const finishCheck = setInterval(() => {
        const current = repos.runs.getRun(req.auth.userId, run.id);
        if (current && ['completed', 'failed', 'cancelled'].includes(current.status)) {
          setTimeout(() => {
            if (!closed) res.end();
          }, 1500);
          clearInterval(finishCheck);
        }
      }, 3000);

      // res 'close' = client disconnect or stream end (req 'close' fires as
      // soon as the body-less GET is "received", which would kill the SSE).
      res.on('close', () => {
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        clearInterval(finishCheck);
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/cancel', (req, res, next) => {
    try {
      const run = repos.runs.getRun(req.auth.userId, req.params.id);
      if (!run) throw errors.notFound('Run');
      repos.runs.requestCancel(req.auth.userId, run.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Approve or deny a pending approval.
  router.post('/approvals/:approvalId', (req, res, next) => {
    try {
      const body = validate(req.body, {
        decision: { type: 'string', required: true, enum: ['approved', 'denied'] },
        scope: { type: 'string', enum: ['once', 'task', 'always'] },
      });
      const approval = repos.runs.getApproval(req.auth.userId, req.params.approvalId);
      if (!approval) throw errors.notFound('Approval');
      if (approval.status !== 'pending') throw errors.conflict('Approval already decided');
      repos.runs.decideApproval(req.auth.userId, approval.id, body.decision, body.scope || 'once');
      if (body.decision === 'approved' && body.scope === 'task') {
        repos.runs.grantStanding(req.auth.userId, approval.runId, approval.tool);
      }
      if (body.decision === 'approved' && body.scope === 'always' && policy) {
        // Persistent approval: compile into an allow rule for this capability's
        // action class + resource (scoped, inspectable, revocable in Settings).
        const actionClass = policy.actionClassOf({ name: approval.tool });
        const resource = approval.payload?.path || '*';
        repos.policy.insert({
          id: `rule_${approval.id}`,
          userId: req.auth.userId,
          subject: `${actionClass}:${resource}`,
          effect: 'allow',
        });
        publish(topics.userEvents(req.auth.userId), { type: 'policy.changed', userId: req.auth.userId });
        policyReevaluator?.reevaluatePending(req.auth.userId);
      }
      // Wake the waiting runtime immediately (same-process fast path).
      publish(topics.userEvents(req.auth.userId), { type: 'approval_decided', approvalId: approval.id });
      res.json({ ok: true, decision: body.decision });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
