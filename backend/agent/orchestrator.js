

















import { randomId } from '../core/crypto.js';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { sandboxMode } from '../tools/registry.js';
import { capabilityPromptBlock } from '../harness/orchestrator.js';
import { permissionMode as storedPermissionMode, planModeEnabled } from '../harness/permissions.js';
import { toChatFrame } from './events.js';
import { assembleSystemPrompt, budgetCharsFor, estimateChars } from './context.js';
import { withModelRetry } from './retry.js';
import { projectMessages } from '../kernel/projections.js';
import { reconstructTranscript, checkInvariant, ReconstructionError } from '../kernel/invariant.js';
import { localFsAvailable } from '../tools/local-bridge.js';
import { getAgentRegistry } from '../realtime/registry.js';

const log = logger('orchestrator');

const PLANNER_SYSTEM = `You are the planning stage of Zeno, an AI agent. Before any action runs, produce a short, concrete execution plan for the user's request.
Respond with ONLY a JSON object, no markdown fences, exactly:
{"understanding":"one sentence of what the user wants","steps":[{"title":"short imperative step","detail":"what happens, which tool/capability it uses, or that it produces the answer"}]}
Rules: 1-7 steps; steps must be actionable with the capabilities described or produce the final answer; note which files will be created or changed when relevant; no prose outside the JSON.`;

const RESEARCH_PLANNER_SYSTEM = `You are the research-planning stage of an AI agent. Decompose the user's research request into independent web search queries that together cover it well.
Respond with ONLY a JSON object, no markdown fences, exactly:
{"subqueries":["search query 1","search query 2"]}
Rules: 1-5 queries; each query is self-contained (no pronouns); cover distinct facets (facts, comparisons, recency, sources); no prose outside the JSON.`;

const CHAR_PER_TOKEN = 3.6;

export class TurnError extends Error {}

export async function executeToolCalls({ toolCalls, catalog, runner, signal = null, maxParallel = 6 }) {
  const freeIdx = [];
  const gatedIdx = [];
  toolCalls.forEach((tc, i) => ((catalog.get(tc.name) || {}).sensitive ? gatedIdx : freeIdx).push(i));
  const cap = Math.max(1, maxParallel);
  const freeBatch = freeIdx.slice(0, cap);
  const freeOverflow = freeIdx.slice(cap);
  const runIndexed = async (idxList, sequential = false) => {
    const out = new Array(idxList.length);
    if (!sequential && idxList.length > 1) {
      await Promise.all(idxList.map(async (idx, k) => { out[k] = await runner(toolCalls[idx]); }));
    } else {
      for (let k = 0; k < idxList.length; k++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        out[k] = await runner(toolCalls[idxList[k]]);
      }
    }
    return out;
  };
  const [freeOut, gatedOut, overflowOut] = await Promise.all([
    freeBatch.length ? runIndexed(freeBatch) : Promise.resolve([]),
    gatedIdx.length ? runIndexed(gatedIdx, true) : Promise.resolve([]),
    freeOverflow.length ? runIndexed(freeOverflow, true) : Promise.resolve([]),
  ]);
  const outcomes = new Array(toolCalls.length);
  freeBatch.forEach((idx, k) => (outcomes[idx] = freeOut[k]));
  gatedIdx.forEach((idx, k) => (outcomes[idx] = gatedOut[k]));
  freeOverflow.forEach((idx, k) => (outcomes[idx] = overflowOut[k]));
  return outcomes;
}

export function createOrchestrator({ repos, gateway, memory, approvals, audit, harness, executor, policy, kernel, promptRegistry, telemetry, decision: decisionEngine, modelRouter, costGovernor, verification }) {
    async function runTurn(ctx) {
    const {
      userId, sessionId, runId, kind = 'chat', conversationId = null, projectId = null,
      query, modelRowId, scopeKey = null, signal, onEvent = null, onKernelEvent = null,
      persistStep = null, onPlan = null, agentIdentity = null,
    } = ctx;
    const permissionMode = ctx.permissionMode || storedPermissionMode(repos, userId);
    const planMode = ctx.planMode ?? planModeEnabled(repos, userId);
    const turnId = randomId('turn');
    const usage = { promptTokens: 0, completionTokens: 0 };
    const trackUsage = (u) => {
      usage.promptTokens += u.promptTokens || 0;
      usage.completionTokens += u.completionTokens || 0;
      ctx.onUsage?.({ promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
    };

    
    
    
    
    
    const emit = (type, data = {}, { persist = true } = {}) => {
      const event = kernel.append(sessionId, userId, type, data, { persist });
      if (event.seq != null) onKernelEvent?.(event);
      if (onEvent) {
        const frame = toChatFrame({ type, data, seq: event.seq });
        if (frame) onEvent(frame);
      }
      return event;
    };

    
    
    
    
    let modelRow = null;
    const rowFor = (id) => (id && modelRow && id === modelRow.id ? modelRow : repos.providers.getModel(userId, id));
    const emitModelCall = (purpose, latencyMs, usage, ok = true, error = null, modelRowIdUsed = null) => {
      let row = modelRow;
      if (modelRowIdUsed && (!modelRow || modelRowIdUsed !== modelRow.id)) {
        row = repos.providers.getModel(userId, modelRowIdUsed);
      }
      telemetry?.modelCall({
        userId, sessionId, runId, turnId,
        model: row?.modelId || modelRowIdUsed || modelRowId,
        provider: row?.providerId || null,
        purpose,
        promptTokens: usage?.promptTokens || 0,
        completionTokens: usage?.completionTokens || 0,
        latencyMs,
        ok,
        error: error ? String(error).slice(0, 200) : null,
      });
    };
    const observedModelCall = async (purpose, run, onUsage = null, { modelRowId: usedRowId = null } = {}) => {
      const started = Date.now();
      let usage = null;
      let ok = true;
      let error = null;
      try {
        return await run((u) => {
          usage = u;
          onUsage?.(u);
        });
      } catch (err) {
        ok = false;
        error = err?.message || String(err);
        throw err;
      } finally {
        emitModelCall(purpose, Date.now() - started, usage, ok, error, usedRowId);
        if (ok && usage && (usage.promptTokens || usage.completionTokens) && costGovernor) {
          try {
            costGovernor.record({
              userId, sessionId, runId, turnId,
              modelRow: usedRowId ? rowFor(usedRowId) : modelRow,
              purpose,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
            });
          } catch {  }
        }
      }
    };

    
    
    let decision = null;

    
    
    
    async function gateCost(purpose, rowId, messagesForEstimate = null) {
      if (!costGovernor || !rowId) return rowId;
      const row = rowFor(rowId);
      if (!row) return rowId;
      const estPromptTokens = Math.ceil((messagesForEstimate ? estimateChars(messagesForEstimate) : 2_000) / CHAR_PER_TOKEN);
      const verdict = costGovernor.authorize({ userId, modelRow: row, purpose, promptTokens: estPromptTokens, completionTokens: 1_000 });
      if (!verdict.allowed) {
        throw new TurnError(`Cost budget reached: ${verdict.reason}. Adjust budgets in Settings → Cost & Usage.`);
      }
      if (verdict.downgrade && modelRouter) {
        try {
          const tier = modelRouter.classifyModelRow(row);
          const idx = modelRouter.TIERS.indexOf(tier);
          if (idx > 0) {
            const cheaper = modelRouter.select(userId, modelRouter.TIERS[idx - 1], { excludeIds: [rowId] });
            if (cheaper) return cheaper.id;
          }
        } catch {  }
      }
      return rowId;
    }

    try {
      const session = repos.sessions.get(sessionId);
      if (!session) throw new TurnError(`Session ${sessionId} not found`);
      repos.runs.updateRun(runId, { status: 'running', startedAt: Date.now() });
      emit('turn/start', { turnId, query: String(query || '').slice(0, 300), kind });

      
      
      const reconstructed = reconstructTranscript(kernel, sessionId);
      const live = reconstructed.map((m) => ({ ...m, _seq: undefined }));
      const hasToolHistory = reconstructed.some((m) => m.role === 'tool');

      
      let schemas = ctx.tools || [];
      let capabilities = '';
      let matchedSkills = [];
      let allSkills = [];
      let offerTools = true;
      let catalog = new Map();
      if (harness && !ctx.tools) {
        const prepared = await harness.prepareTurn({ userId, query, projectId });
        catalog = prepared.catalog;
        offerTools = prepared.plan.offerTools;
        schemas = offerTools ? prepared.schemas : [];
        capabilities = capabilityPromptBlock(schemas, prepared.plan);
        matchedSkills = prepared.plan.matchedSkills || [];
        allSkills = prepared.skills.filter((s) => s.enabled && s.instructions);
      }

      
      
      
      
      let agentMode = true;
      if (decisionEngine && kind !== 'subagent' && kind !== 'review') {
        emit('phase/changed', { phase: 'routing', detail: 'Understanding the request' }, { persist: false });
        try {
          decision = await decisionEngine.decideTurn({
            userId,
            query,
            kind,
            hasTools: schemas.length > 0 || !!ctx.tools,
            toolNames: new Set(schemas.map((s) => s.name)),
            hasAttachments: (ctx.attachments || 0) > 0,
          });
        } catch (err) {
          log.warn(`decision round failed, defaulting to agent mode: ${err.message}`);
        }
        if (decision) {
          emit('routing/decided', {
            turnId,
            taskType: decision.taskType,
            complexity: decision.complexity,
            executionMode: decision.executionMode,
            agent: decision.agent,
            modelTier: decision.modelTier,
            verification: decision.verification,
            risk: decision.risk,
            parallel: decision.parallel,
            confidence: Math.round(decision.confidence * 100) / 100,
            source: decision.source,
            decisionMs: decision.decisionMs,
            cached: !!decision.cached,
          });
        }
      }
      if (decision) {
        const settings = repos.users.getSetting(userId, 'jev') || {};
        const floor = Number.isFinite(Number(settings.confidence_floor)) ? Number(settings.confidence_floor) : 0.6;
        
        
        
        agentMode = !(
          kind === 'chat' &&
          decision.executionMode === 'chat' &&
          decision.confidence >= floor &&
          !planMode &&
          !(ctx.attachments > 0) &&
          !hasToolHistory
        );
      }

      
      if (!agentMode) {
        schemas = [];
        offerTools = false;
        capabilities = '';
        matchedSkills = [];
      }
      const toolNames = new Set(schemas.map((t) => t.name));
      const hasLocal = schemas.some((t) => t.name.startsWith('local_')) || localFsAvailable(userId) || getAgentRegistry().isOnline(userId);

      
      let mainModelRowId = modelRowId;
      if (modelRouter) {
        try {
          mainModelRowId = modelRouter.purposeModel({ userId, requested: modelRowId, purpose: 'main', decision });
        } catch (err) {
          log.warn(`main model routing failed, using requested model: ${err.message}`);
        }
      }
      modelRow = repos.providers.getModel(userId, mainModelRowId) || repos.providers.getModel(userId, modelRowId);
      if (!modelRow) throw new TurnError(`Model ${modelRowId} not found`);
      if (mainModelRowId !== modelRowId) {
        emit('model/routed', { turnId, purpose: 'main', requested: modelRowId, used: mainModelRowId, tier: decision?.modelTier || null });
      }

      
      emit('phase/changed', { phase: 'thinking' });
      const memoryBlock = await memory.contextBlock(userId, { projectId, query, conversationId, limit: 10 });
      const conv = conversationId ? repos.chat.getConversation(userId, conversationId) : null;
      let system = promptRegistry
        ? promptRegistry.assemble({
            role: kind, mode: permissionMode, conv, agentIdentity, sandboxMode: sandboxMode(),
            localAvailable: hasLocal, memoryBlock, capabilities, plan: null, matchedSkills, allSkills, toolNames, modelRow,
          })
        : assembleSystemPrompt({
            role: kind === 'chat' ? 'chat' : 'agent', mode: permissionMode, conv, agentIdentity,
            sandboxMode: sandboxMode(), localAvailable: hasLocal, memoryBlock, capabilities, plan: null,
            matchedSkills, allSkills, toolNames, modelRow,
          });
      let messages = [{ role: 'system', content: system }, ...live];

      
      
      
      
      
      let evidenceDigest = null;
      if (agentMode && decision && (decision.taskType === 'research' || decision.taskType === 'web') && decision.complexity !== 'trivial') {
        try {
          const research = await runResearchStage({ catalog, schemas, signal });
          if (research) {
            evidenceDigest = research.digest;
            if (research.block) system += `\n\n${research.block}`;
            messages[0] = { role: 'system', content: system };
          }
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          log.warn(`research stage failed, continuing in-loop: ${err.message}`);
        }
      }

      
      
      
      try {
        const budget = budgetCharsFor(modelRow);
        if (estimateChars(live) > budget && live.length > 7) {
          const keepRecent = 6;
          const older = live.slice(0, live.length - keepRecent);
          const compactionRowId = modelRouter
            ? modelRouter.purposeModel({ userId, requested: mainModelRowId, purpose: 'compaction', decision })
            : mainModelRowId;
          await gateCost('compaction', compactionRowId, older);
          const { text } = await observedModelCall('compaction', (onUsage) =>
            gateway.complete({
              userId,
              modelRowId: compactionRowId,
              messages: [
                { role: 'system', content: 'Summarize the conversation so far for an assistant that will continue it. Capture durable facts, decisions, open questions, files touched, and current state in under 300 words. Plain text only.' },
                { role: 'user', content: older.map((m) => `${m.role}: ${String(m.content || '').slice(0, 1200)}`).join('\n').slice(0, 40_000) },
              ],
              timeoutMs: 60_000,
              onUsage,
            }), trackUsage, { modelRowId: compactionRowId });
          const summary = String(text || '').trim().slice(0, 1500);
          if (summary) {
            const uptoEventSeq = repos.sessions.lastSeq(sessionId);
            emit('context/compacted', { summary, uptoEventSeq });
            const summaryMsg = { role: 'user', content: `[Conversation so far — summary of earlier messages]\n${summary}` };
            const recent = live.slice(live.length - keepRecent);
            live.length = 0;
            live.push(summaryMsg, ...recent);
            messages = [{ role: 'system', content: system }, summaryMsg, ...recent];
          }
        }
      } catch (err) {
        log.warn(`history compaction skipped: ${err.message}`);
      }

      
      let plan = null;
      if (planMode && offerTools) {
        plan = await runPlanningStage({ userId, sessionId, turnId, runId, modelRowId: mainModelRowId, query, capabilities, conversationId, permissionMode, requiresApproval: kind === 'chat' && permissionMode === 'ask', emit, onPlan, observedModelCall, gateCost, trackUsage });
        if (plan.aborted) {
          emit('plan/finished', { planId: plan.planId });
          finishTurn('complete', plan.refusal, '');
          return { text: plan.refusal, reasoning: '', usage, status: 'complete' };
        }
        
        messages[0] = { role: 'system', content:
          promptRegistry
            ? promptRegistry.assemble({
                role: kind, mode: permissionMode, conv, agentIdentity, sandboxMode: sandboxMode(),
                localAvailable: hasLocal, memoryBlock, capabilities, plan, matchedSkills, allSkills, toolNames, modelRow,
              })
            : assembleSystemPrompt({
                role: kind === 'chat' ? 'chat' : 'agent', mode: permissionMode, conv, agentIdentity,
                sandboxMode: sandboxMode(), localAvailable: hasLocal, memoryBlock, capabilities, plan,
                matchedSkills, allSkills, toolNames, modelRow,
              }) };
      }

      
      const maxRounds = Math.max(1, Math.min(config.agent.maxSteps, Number(ctx.maxRoundsOverride) || 12));
      let regenUsed = false;
      for (let round = 1; round <= maxRounds; round++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        emit('phase/changed', { phase: 'thinking' });

        let stepText = '';
        let stepReasoning = '';
        const toolCalls = [];
        let deltaEmitted = false;

        await gateCost('turn', mainModelRowId, messages);
        await observedModelCall('turn', (onUsage) =>
          withModelRetry(async () => {
            
            
            stepText = '';
            stepReasoning = '';
            deltaEmitted = false;
            return gateway.chatStream({
              userId,
              modelRowId: mainModelRowId,
              messages,
              tools: schemas,
              signal,
              onDelta: (d) => {
                deltaEmitted = true;
                if (d.type === 'text') {
                  if (toolCalls.length) return; 
                  stepText += d.text;
                  emit('output/delta', { text: d.text }, { persist: false });
                } else {
                  stepReasoning += d.text;
                  emit('output/reasoning', { text: d.text }, { persist: false });
                }
              },
              onToolCall: (tc) => toolCalls.push(tc),
              onUsage,
            });
          }, {
            attempts: config.intelligence.modelRetryAttempts,
            canRetry: () => !deltaEmitted && !toolCalls.length,
            onRetry: (info) => telemetry?.retry({ userId, sessionId, attempt: info.attempt, error: info.error }),
            signal,
          }), trackUsage, { modelRowId: mainModelRowId });

        if (!toolCalls.length) {
          if (!stepText.trim() && round < maxRounds) {
            messages.push({ role: 'user', content: 'Continue working on the task. Use tools if needed, or produce the final answer.' });
            continue;
          }
          if (plan) emit('plan/finished', { planId: plan.planId });
          return await completeWithVerification(stepText, stepReasoning);
        }

        emit('phase/changed', { phase: 'executing' });
        persistStep?.({
          role: 'assistant',
          content: stepText,
          reasoning: stepReasoning || null,
          attachments: { kind: 'tool_step', toolCalls: toolCalls.map((t) => ({ id: t.id, name: t.name, arguments: t.arguments })) },
        });
        emit('assistant/attempt', { turnId, round, text: stepText, reasoning: stepReasoning || '', toolCalls: toolCalls.map((t) => ({ id: t.id, name: t.name, arguments: t.arguments })) });
        live.push({ role: 'assistant', content: stepText, toolCalls: toolCalls.map((t) => ({ id: t.id, name: t.name, arguments: t.arguments })) });
        messages.push({ role: 'assistant', content: stepText, toolCalls });

        
        
        
        const activeCatalog = harness && !ctx.tools ? catalog : new Map((ctx.tools || []).map((t) => [t.name, t]));
        const runner = (tc) => {
          const tool = activeCatalog.get(tc.name) || null;
          return executor.execute({
            tool, args: tc.arguments, callId: tc.id || randomId('call'),
            userId, runId, sessionId, scopeKey, conversationId, mode: permissionMode, signal, emit, memory,
          });
        };
        const outcomes = await executeToolCalls({ toolCalls, catalog: activeCatalog, runner, signal, maxParallel: config.intelligence.maxParallelTools });

        for (let i = 0; i < toolCalls.length; i++) {
          const tc = toolCalls[i];
          const outcome = outcomes[i];
          const output = String(outcome.output || '').slice(0, config.agent.maxToolOutputChars);
          
          
          const effectiveName = activeCatalog.get(tc.name) ? tc.name : 'unknown';
          persistStep?.({
            role: 'tool',
            content: output,
            displayName: outcome.displayName,
            attachments: {
              kind: 'tool_result', tool: tc.name, toolCallId: tc.id,
              ok: outcome.ok, denied: !!outcome.denied,
              ...(outcome.file ? { file: outcome.file } : {}),
            },
          });
          
          
          live.push({ role: 'tool', toolCallId: tc.id, name: effectiveName, content: output });
          messages.push({ role: 'tool', toolCallId: tc.id, name: effectiveName, content: outcome.output });
        }
        if (conversationId) repos.chat.touchConversation(conversationId);

        if (plan) {
          const done = Math.min(plan.steps.length, round);
          if (done !== plan.doneCount) {
            plan.doneCount = done;
            emit('plan/progress', { planId: plan.planId, completedSteps: done });
          }
        }
      }

      
      messages.push({
        role: 'user',
        content: 'You have reached the tool-use limit for this reply. Give your best final answer now based on everything so far.',
      });
      let wrap = '';
      const wrapupRowId = modelRouter
        ? modelRouter.purposeModel({ userId, requested: mainModelRowId, purpose: 'wrap-up', decision })
        : mainModelRowId;
      await gateCost('wrap-up', wrapupRowId, messages);
      await observedModelCall('wrap-up', (onUsage) =>
        gateway.chatStream({
          userId, modelRowId: wrapupRowId, messages, signal,
          onDelta: (d) => {
            if (d.type === 'text') {
              wrap += d.text;
              emit('output/delta', { text: d.text }, { persist: false });
            }
          },
          onUsage,
        }), trackUsage, { modelRowId: wrapupRowId });
      if (plan) emit('plan/finished', { planId: plan.planId });
      return await completeWithVerification(wrap, '');

      
      function finishTurn(status, text, reasoning) {
        let estCostUsd = 0;
        try {
          estCostUsd = costGovernor?.turnCost(turnId)?.cost || 0;
        } catch {  }
        const usageOut = { ...usage, ...(estCostUsd > 0 ? { estCostUsd: Number(estCostUsd.toFixed(6)) } : {}) };
        emit('assistant/message', { turnId, text, reasoning, usage: usageOut, status });
        live.push({ role: 'assistant', content: text });
        
        
        const replayed = projectMessages(kernel.replay(sessionId));
        const liveCanonical = live.map(({ _seq, ...m }) => m);
        checkInvariant(sessionId, liveCanonical, replayed);
        emit('turn/end', { turnId, status, usage: usageOut });
        
        decisionEngine?.recordOutcome({
          userId,
          taskType: decision?.taskType || 'general',
          decisionMs: decision?.decisionMs || 0,
          tokens: usageOut.promptTokens + usageOut.completionTokens,
          estCostUsd,
          escalated: regenUsed,
          failed: false,
        });
      }

            async function completeWithVerification(text, reasoning) {
        const level = verification && agentMode && decision ? verification.levelFor(decision, userId) : 'none';
        if (level === 'none' || !String(text || '').trim() || signal?.aborted) {
          finishTurn('complete', text, reasoning);
          return { text, reasoning, usage, status: 'complete' };
        }
        emit('phase/changed', { phase: 'verifying', detail: 'Verifying the result' }, { persist: false });
        let verdict = null;
        try {
          const verifyRowId = modelRouter
            ? modelRouter.purposeModel({ userId, requested: mainModelRowId, purpose: 'verification', decision })
            : mainModelRowId;
          verdict = await verification.verify({
            userId, decision, level, query, answer: text, evidenceDigest,
            modelRowId: verifyRowId, signal,
            onUsage: trackUsage,
          });
        } catch (err) {
          log.warn(`verification stage failed, finalizing anyway: ${err.message}`);
        }
        if (verdict) {
          emit('verification/completed', {
            turnId, level: verdict.level, ok: verdict.ok, issues: verdict.issues.slice(0, 5),
            confidence: Math.round((verdict.confidence || 0) * 100) / 100, checker: verdict.checker,
            skipped: !!verdict.skipped,
          });
        }

        let finalText = text;
        let finalReasoning = reasoning;
        if (verdict && !verdict.ok && level === 'strict' && !signal?.aborted) {
          const esc = modelRouter?.escalationModel(userId, mainModelRowId) || null;
          const regenRowId = esc?.id || mainModelRowId;
          try {
            await gateCost('verification-revision', regenRowId, messages);
            const issueLines = (verdict.issues || []).map((i) => `- ${i.claim}: ${i.problem}`).join('\n');
            const regenMessages = [
              ...messages,
              { role: 'assistant', content: finalText },
              {
                role: 'user',
                content:
                  `Your answer above did not pass verification. Issues found:\n${issueLines || '- claims were not sufficiently grounded in the gathered evidence.'}\n` +
                  'Produce a corrected final answer that fixes these issues — keep everything that was correct, ground unsupported claims (or drop them), and cite sources where they exist. Answer in full; do not mention the verification process.',
              },
            ];
            let revised = '';
            await observedModelCall('verification-revision', (onUsage) =>
              gateway.chatStream({
                userId, modelRowId: regenRowId, messages: regenMessages, signal,
                onDelta: (d) => { if (d.type === 'text') revised += d.text; },
                onUsage,
              }), trackUsage, { modelRowId: regenRowId });
            if (String(revised).trim().length > 40) {
              finalText = revised;
              finalReasoning = '';
              regenUsed = true;
              emit('verification/completed', { turnId, level, ok: true, issues: [], confidence: verdict.confidence, checker: 'regenerated', revised: true });
            }
          } catch (err) {
            if (err?.name === 'AbortError') throw err;
            log.warn(`verification revision failed, keeping original answer: ${err.message}`);
          }
        }
        finishTurn('complete', finalText, finalReasoning);
        return { text: finalText, reasoning: finalReasoning, usage, status: 'complete' };
      }

            async function runResearchStage({ catalog: cat, schemas: schemasNow, signal: sig }) {
        const researchSettings = repos.users.getSetting(userId, 'research') || {};
        if (researchSettings.enabled === false) return null;
        const visible = new Set(schemasNow.map((s) => s.name));
        const searchTool = visible.has('web_search') ? cat.get('web_search') : null;
        if (!searchTool) return null;
        const readTool = visible.has('browser_read') ? cat.get('browser_read') : null;
        const maxSubqueries = Math.max(1, Math.min(6, Number(researchSettings.max_subqueries) || config.intelligence.researchMaxSubqueries));
        const maxReads = Math.max(0, Math.min(6, Number(researchSettings.max_reads) ?? config.intelligence.researchMaxReads));

        emit('phase/changed', { phase: 'researching', detail: 'Planning the research' }, { persist: false });

        
        let subqueries = [String(query)];
        try {
          const planRowId = modelRouter
            ? modelRouter.purposeModel({ userId, requested: mainModelRowId, purpose: 'research-planning', decision })
            : mainModelRowId;
          await gateCost('research-planning', planRowId);
          const { text } = await observedModelCall('research-planning', (onUsage) =>
            gateway.complete({
              userId,
              modelRowId: planRowId,
              messages: [
                { role: 'system', content: RESEARCH_PLANNER_SYSTEM },
                { role: 'user', content: String(query).slice(0, 3000) },
              ],
              timeoutMs: 45_000,
              onUsage,
            }), trackUsage, { modelRowId: planRowId });
          const match = String(text || '').match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            const qs = (Array.isArray(parsed.subqueries) ? parsed.subqueries : [])
              .map((s) => String(s || '').trim())
              .filter(Boolean)
              .slice(0, maxSubqueries);
            if (qs.length) subqueries = qs;
          }
        } catch (err) {
          log.warn(`research decomposition failed, searching the request directly: ${err.message}`);
        }

        emit('research/started', { turnId, subqueries: subqueries.length, maxReads });

        
        
        
        
        
        const searchCallIds = subqueries.map(() => randomId('call'));
        const searchAttempt = subqueries.map((sq, i) => ({ id: searchCallIds[i], name: 'web_search', arguments: { query: sq, max_results: 6 } }));
        persistStep?.({
          role: 'assistant',
          content: 'Gathering research sources…',
          attachments: { kind: 'tool_step', toolCalls: searchAttempt.map((t) => ({ id: t.id, name: t.name, arguments: t.arguments })) },
        });
        emit('assistant/attempt', { turnId, round: 0, text: 'Gathering research sources…', reasoning: '', toolCalls: searchAttempt });
        live.push({ role: 'assistant', content: 'Gathering research sources…', toolCalls: searchAttempt });
        messages.push({ role: 'assistant', content: 'Gathering research sources…', toolCalls: searchAttempt });

        const pushToolResult = (callId, toolName, outcome) => {
          const output = String(outcome.output || '').slice(0, config.agent.maxToolOutputChars);
          persistStep?.({
            role: 'tool',
            content: output,
            displayName: outcome.displayName,
            attachments: { kind: 'tool_result', tool: toolName, toolCallId: callId, ok: outcome.ok, denied: !!outcome.denied },
          });
          live.push({ role: 'tool', toolCallId: callId, name: toolName, content: output });
          messages.push({ role: 'tool', toolCallId: callId, name: toolName, content: outcome.output });
        };

        
        
        const searchOutcomes = await Promise.all(
          subqueries.map((sq, i) =>
            executor.execute({
              tool: searchTool, args: { query: sq, max_results: 6 }, callId: searchCallIds[i],
              userId, runId, sessionId, scopeKey, conversationId, mode: permissionMode, signal: sig, emit, memory,
            }).then(
              (outcome) => {
                pushToolResult(searchCallIds[i], 'web_search', outcome);
                return outcome;
              },
              (err) => {
                const outcome = { ok: false, output: JSON.stringify({ ok: false, error: err.message }) };
                pushToolResult(searchCallIds[i], 'web_search', outcome);
                return outcome;
              }
            )
          )
        );
        const sources = [];
        const seenUrls = new Set();
        for (const outcome of searchOutcomes) {
          try {
            const parsed = JSON.parse(outcome.output || '{}');
            for (const r of parsed.results || []) {
              const url = String(r.url || '');
              if (!url || seenUrls.has(url)) continue;
              seenUrls.add(url);
              sources.push({ title: String(r.title || '').slice(0, 200), url, snippet: String(r.snippet || '').slice(0, 500) });
            }
          } catch {  }
        }
        if (!sources.length) return null;

        
        const readOutcomes = [];
        if (readTool && maxReads > 0) {
          const toRead = sources.slice(0, maxReads);
          const readCallIds = toRead.map(() => randomId('call'));
          const readAttempt = toRead.map((s, i) => ({ id: readCallIds[i], name: 'browser_read', arguments: { url: s.url } }));
          persistStep?.({
            role: 'assistant',
            content: 'Reading the most relevant sources…',
            attachments: { kind: 'tool_step', toolCalls: readAttempt.map((t) => ({ id: t.id, name: t.name, arguments: t.arguments })) },
          });
          emit('assistant/attempt', { turnId, round: 0, text: 'Reading the most relevant sources…', reasoning: '', toolCalls: readAttempt });
          live.push({ role: 'assistant', content: 'Reading the most relevant sources…', toolCalls: readAttempt });
          messages.push({ role: 'assistant', content: 'Reading the most relevant sources…', toolCalls: readAttempt });
          const reads = await Promise.all(
            toRead.map((s, i) =>
              executor.execute({
                tool: readTool, args: { url: s.url }, callId: readCallIds[i],
                userId, runId, sessionId, scopeKey, conversationId, mode: permissionMode, signal: sig, emit, memory,
              }).then(
                (outcome) => {
                  pushToolResult(readCallIds[i], 'browser_read', outcome);
                  return outcome;
                },
                (err) => {
                  const outcome = { ok: false, output: JSON.stringify({ ok: false, error: err.message }) };
                  pushToolResult(readCallIds[i], 'browser_read', outcome);
                  return outcome;
                }
              )
            )
          );
          reads.forEach((r, i) => readOutcomes.push({ source: toRead[i], outcome: r }));
        }

        
        const parts = [];
        for (const s of sources.slice(0, 12)) {
          parts.push(`[${s.url}] ${s.title}\n${s.snippet}`);
        }
        for (const { source, outcome } of readOutcomes) {
          if (!outcome.ok) continue;
          try {
            const parsed = JSON.parse(outcome.output || '{}');
            const content = String(parsed.content || parsed.text || '').replace(/\s+/g, ' ').slice(0, 1_500);
            if (content) parts.push(`[${source.url}] (full read) ${content}`);
          } catch {  }
        }
        const digest = parts.join('\n\n').slice(0, 12_000);
        const block =
          `Research evidence (gathered automatically before your answer). Ground your answer in these sources; cite the URLs you use; note conflicts between sources and flag anything the evidence does not cover:\n<evidence>\n${digest}\n</evidence>`;
        emit('research/completed', { turnId, searches: subqueries.length, sources: sources.length, reads: readOutcomes.filter((r) => r.outcome.ok).length });
        return { digest, block };
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        emit('turn/aborted', { turnId });
        throw err;
      }
      if (err instanceof ReconstructionError) {
        
        
        log.error(err.message);
        telemetry?.failure({ userId, sessionId, runId, where: 'invariant', error: err.message });
        try {
          kernel.append(sessionId, userId, 'session/failed', { error: 'reconstruction desync', details: err.details });
        } catch {  }
        throw err;
      }
      telemetry?.failure({ userId, sessionId, runId, where: 'turn', error: String(err?.message || err).slice(0, 300) });
      log.warn(`turn failed: ${err.message}`, { stack: err.stack });
      emit('turn/end', { turnId, status: 'failed', error: err.message });
      
      try {
        decisionEngine?.recordOutcome({
          userId,
          taskType: decision?.taskType || 'general',
          decisionMs: decision?.decisionMs || 0,
          tokens: 0,
          estCostUsd: 0,
          escalated: false,
          failed: true,
        });
      } catch {  }
      throw err;
    }
  }

  
  async function runPlanningStage({ userId, sessionId, turnId, runId, modelRowId, query, capabilities, conversationId, permissionMode, requiresApproval = false, emit, onPlan, observedModelCall, gateCost = null, trackUsage = null }) {
    emit('phase/changed', { phase: 'planning' });
    let steps = [];
    let understanding = '';
    try {
      await gateCost?.('planning', modelRowId);
      const { text } = await observedModelCall('planning', (onUsage) =>
        gateway.complete({
          userId,
          modelRowId,
          messages: [
            { role: 'system', content: PLANNER_SYSTEM },
            { role: 'user', content: `User request: ${String(query || '').slice(0, 4000)}\n\nAvailable capabilities:\n${(capabilities || '').slice(0, 2000)}` },
          ],
          timeoutMs: 90_000,
          onUsage,
        }), trackUsage, { modelRowId });
      const match = String(text || '').match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        steps = (Array.isArray(parsed.steps) ? parsed.steps : [])
          .filter((s) => s && s.title)
          .slice(0, 7)
          .map((s) => ({ title: String(s.title).slice(0, 160), detail: String(s.detail || '').slice(0, 400) }));
        understanding = String(parsed.understanding || '').slice(0, 300);
      }
    } catch (err) {
      log.warn(`planning stage failed, proceeding without a plan: ${err.message}`);
    }
    if (!steps.length) {
      steps = [{ title: 'Answer or act on the request directly', detail: 'No structured plan was produced; proceed step by step.' }];
    }

    const planId = randomId('plan');
    const plan = { planId, understanding, steps, doneCount: 0 };
    emit('plan/created', { planId, understanding, steps, requiresApproval, turnId });
    
    
    onPlan?.({ planId, understanding, steps, status: 'pending' });

    if (requiresApproval) {
      repos.runs.updateRun(runId, { status: 'waiting_approval' });
      const approval = approvals.request({
        runId,
        userId,
        tool: { name: 'plan', displayName: 'Execute plan', permissionClass: 'plan', approvalSummary: () => `Plan: ${steps.map((s) => s.title).join(' → ')}`.slice(0, 300) },
        args: { steps: steps.map((s) => s.title) },
        meta: conversationId ? { conversationId } : {},
      });
      emit('permission/requested', { approvalId: approval.approvalId, tool: 'plan', displayName: 'Execute plan', summary: approval.summary, payload: { steps: steps.map((s) => s.title) } });
      const decision = await approval.promise;
      emit('permission/decided', { tool: 'plan', displayName: 'Execute plan', decision });
      onPlan?.({ planId, understanding, steps, status: decision === 'approved' ? 'approved' : 'denied' });
      if (decision !== 'approved') {
        emit('plan/rejected', { planId });
        return { ...plan, aborted: true, refusal: 'The user did not approve this plan, so no actions were taken. Ask what they would like changed, or answer without acting.' };
      }
      emit('plan/approved', { planId });
    } else {
      onPlan?.({ planId, understanding, steps, status: 'approved' });
    }
    return plan;
  }

  return { runTurn };
}
