





import { randomId } from '../core/crypto.js';
import { logger } from '../core/logger.js';
import { projectToolActivity } from '../kernel/projections.js';

const log = logger('reviewer');

const CODE_EXTS = /\.(js|mjs|cjs|ts|tsx|py|rb|rs|go|java|c|h|cpp|hpp|cs|php|sh|ps1|sql|json|yaml|yml|toml|html|css|jsx)$/i;

export function createReviewer({ repos, kernel, orchestrator, snapshots }) {
    function changedCodeFiles(sessionId) {
    const calls = projectToolActivity(kernel.replay(sessionId));
    return calls
      .filter((c) => c.ok && ['file_write', 'file_edit'].includes(c.tool) && c.file?.path && CODE_EXTS.test(c.file.path))
      .map((c) => ({ path: c.file.path, action: c.tool === 'file_edit' ? 'edited' : 'written' }));
  }

    function buildDiff(beforeManifest, afterManifest, touchedPaths) {
    const before = new Map((beforeManifest?.files || []).map((f) => [f.path, f]));
    const after = new Map((afterManifest?.files || []).map((f) => [f.path, f]));
    const lines = [];
    for (const p of touchedPaths.slice(0, 12)) {
      const b = before.get(p);
      const a = after.get(p);
      if (!b && a) lines.push(`+ ${p} (new file, ${a.size} bytes)`);
      else if (b && !a) lines.push(`- ${p} (deleted)`);
      else if (b && a && b.hash !== a.hash) lines.push(`~ ${p} (modified, ${b.size} → ${a.size} bytes)`);
      else if (b && a) lines.push(`  ${p} (unchanged)`);
    }
    return lines.join('\n');
  }

    async function reviewSession({ userId, sessionId, runId, conversationId, modelRowId, signal, onPlan, persistStep, publishEvent }) {
    const setting = repos.users.getSetting(userId, 'ai_reviewer');
    const enabled = setting === null ? true : setting === true; 
    if (!enabled) return null;

    const touched = changedCodeFiles(sessionId);
    if (!touched.length) return null; 

    const session = kernel.create({ userId, kind: 'review', conversationId, runId, reuse: false });
    try {
      
      const events = kernel.replay(sessionId);
      const firstSnapshot = events.find((e) => e.type === 'snapshot/captured');
      const before = firstSnapshot ? await snapshots.load(userId, firstSnapshot.data.snapshotId).catch(() => null) : null;
      const after = await snapshots.capture(userId, { sessionId, label: 'review-after' });
      const diffSummary = buildDiff(before, after, touched.map((t) => t.path));

      const reviewPrompt =
        `You are a meticulous code reviewer. The primary agent just made these changes:\n\n${diffSummary}\n\n` +
        `Touched files: ${touched.map((t) => t.path).join(', ')}\n\n` +
        `Inspect the actual changed files with file_read, then report concrete problems: bugs, regressions, security issues, missing error handling, broken imports. ` +
        `Respond with ONLY a JSON object: {"verdict":"pass|needs-attention","findings":[{"file":"path","severity":"high|medium|low","issue":"what is wrong","suggestion":"how to fix"}]}. ` +
        `Report only real, verified findings — no style nits. If the changes are sound, return an empty findings array.`;

      const result = await orchestrator.runTurn({
        userId,
        sessionId: session.id,
        runId,
        kind: 'review',
        conversationId,
        projectId: null,
        query: 'Review the changes just made to the workspace.',
        modelRowId,
        planMode: false,
        permissionMode: repos.users.getSetting(userId, 'permission_mode') || 'ask',
        scopeKey: conversationId,
        signal,
        tools: (await import('../tools/registry.js')).toolSchemasFor(['file_read', 'file_list', 'file_search'].filter((n) => n !== 'file_search')),
        agentIdentity: { name: 'Zeno Reviewer', systemPrompt: 'You are a second-pass code reviewer. Be skeptical and concrete. Read the changed files before judging.' },
        onKernelEvent: publishEvent || null,
      });

      let findings = [];
      let verdict = 'needs-attention';
      try {
        const match = String(result.text || '').match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          findings = Array.isArray(parsed.findings) ? parsed.findings.slice(0, 12) : [];
          verdict = parsed.verdict || (findings.length ? 'needs-attention' : 'pass');
        }
      } catch {
        findings = [{ file: '', severity: 'low', issue: 'Reviewer output was not parseable', suggestion: String(result.text || '').slice(0, 500) }];
      }

      const reviewEvent = kernel.append(session.id, userId, 'review/findings', { reviewId: session.id, verdict, findings, diffSummary, touchedFiles: touched.map((t) => t.path) });
      publishEvent?.(reviewEvent);
      
      const primaryEvent = kernel.append(sessionId, userId, 'review/findings', { reviewId: session.id, verdict, findings, diffSummary });
      publishEvent?.(primaryEvent);
      kernel.end(session.id, userId, 'complete');
      log.info(`review ${session.id}: verdict=${verdict}, findings=${findings.length}`);
      return { reviewId: session.id, verdict, findings };
    } catch (err) {
      kernel.end(session.id, userId, 'failed', { error: err.message });
      log.warn(`review failed: ${err.message}`);
      return null;
    } finally {
      (async () => {
        const { disposeSession } = await import('../kernel/lifecycle-registry.js');
        await disposeSession(session.id, 'review-finished');
      })();
    }
  }

  return { reviewSession, changedCodeFiles, buildDiff };
}
