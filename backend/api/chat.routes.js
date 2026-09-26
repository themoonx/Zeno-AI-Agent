











import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validate } from '../core/validate.js';
import { errors } from '../core/errors.js';
import { randomId } from '../core/crypto.js';
import { config } from '../core/config.js';
import { trackAbort } from '../agent/control.js';
import { toChatFrame } from '../agent/events.js';
import { permissionMode as storedPermissionMode, planModeEnabled, PERMISSION_MODES } from '../harness/permissions.js';
import { IMAGE_MIMES } from './files.routes.js';

function sseHead(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');
}

function sseSend(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function createChatRoutes({ repos, gateway, memory, orchestrator, kernel, snapshots, enqueueMemoryExtraction }) {
  
  
  const router = Router();

  
  
  
  
  function activeSessionFor(userId, conversationId) {
    const conv = repos.chat.getConversation(userId, conversationId);
    if (!conv) throw errors.notFound('Conversation');
    const session = repos.sessions.activeForConversation(conversationId);
    return { conv, session };
  }

  function recordSnapshotMessage(conversationId, userId, kind, result) {
    repos.chat.insertMessage({
      id: randomId('msg'),
      conversationId,
      userId,
      seq: repos.chat.nextSeq(conversationId),
      role: 'tool',
      content: '',
      attachments: {
        kind: 'snapshot',
        action: kind,
        snapshotId: result.snapshotId || null,
        written: result.written ?? 0,
        removed: result.removed ?? 0,
        files: result.files ?? 0,
      },
      modelLabel: null,
      status: 'complete',
    });
    repos.chat.touchConversation(conversationId);
  }

  router.get('/snapshot-stack', (req, res, next) => {
    try {
      const conversationId = String(req.query.conversationId || '');
      if (!conversationId) throw errors.badRequest('conversationId is required');
      const session = repos.sessions.activeForConversation(conversationId);
      if (!session || session.userId !== req.auth.userId) {
        return res.json({ canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 });
      }
      res.json(snapshots.stackState(session.id));
    } catch (err) {
      next(err);
    }
  });

  router.post('/undo', async (req, res, next) => {
    try {
      const body = validate(req.body, { conversationId: { type: 'string', required: true, max: 64 } });
      const { conversationId } = body;
      const { conv, session } = activeSessionFor(req.auth.userId, conversationId);
      if (!session) throw errors.badRequest('Nothing to undo yet — no active session for this conversation.');
      const result = await snapshots.undo(req.auth.userId, session.id, {
        emit: (type, data) => kernel.append(session.id, req.auth.userId, type, data),
      });
      if (!result.ok) throw errors.badRequest(result.error || 'Nothing to undo.');
      recordSnapshotMessage(conv.id, req.auth.userId, 'undo', result);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/redo', async (req, res, next) => {
    try {
      const body = validate(req.body, { conversationId: { type: 'string', required: true, max: 64 } });
      const { conversationId } = body;
      const { conv, session } = activeSessionFor(req.auth.userId, conversationId);
      if (!session) throw errors.badRequest('Nothing to redo yet — no active session for this conversation.');
      const result = await snapshots.redo(req.auth.userId, session.id, {
        emit: (type, data) => kernel.append(session.id, req.auth.userId, type, data),
      });
      if (!result.ok) throw errors.badRequest(result.error || 'Nothing to redo.');
      recordSnapshotMessage(conv.id, req.auth.userId, 'redo', result);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/stream', async (req, res, next) => {
    let body;
    try {
      body = validate(req.body, {
        conversationId: { type: 'string', required: true, max: 64 },
        content: { type: 'string', max: 64_000 },
        attachmentIds: { type: 'array', items: { type: 'string' } },
        modelRowId: { type: 'string', max: 64 },
        mode: { type: 'string', enum: ['send', 'regenerate', 'edit'], default: 'send' },
        editMessageId: { type: 'string', max: 64 },
        permissionMode: { type: 'string', enum: PERMISSION_MODES },
        plan: { type: 'boolean' },
      });
    } catch (err) {
      return next(err);
    }

    
    const permissionMode = body.permissionMode || storedPermissionMode(repos, req.auth.userId);
    const planMode = body.plan ?? planModeEnabled(repos, req.auth.userId);

    const conversation = repos.chat.getConversation(req.auth.userId, body.conversationId);
    if (!conversation) return next(errors.notFound('Conversation'));

    const modelRowId = body.modelRowId || conversation.modelId || repos.users.getSetting(req.auth.userId, 'default_model')?.modelId;
    if (!modelRowId) {
      return next(errors.badRequest('No model selected. Add a provider and pick a model first.'));
    }
    try {
      gateway.resolveModel(req.auth.userId, modelRowId);
    } catch (err) {
      return next(err);
    }

    const mode = body.mode;
    sseHead(res);
    const clientAborted = new Promise((resolve) => res.on('close', resolve));

    try {
      
      const session = kernel.create({ userId: req.auth.userId, kind: 'chat', conversationId: conversation.id });

      
      if (mode === 'regenerate') {
        const messages = repos.chat.listMessages(conversation.id);
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && (!m.attachments || Array.isArray(m.attachments) || m.attachments?.kind !== 'tool_step'));
        if (!lastAssistant) throw errors.badRequest('Nothing to regenerate');
        repos.chat.deleteMessagesFrom(conversation.id, lastAssistant.seq);
        truncateSessionEvents(repos, session.id, { type: 'assistant/message' });
      } else if (mode === 'edit') {
        const target = repos.chat.getMessage(body.editMessageId);
        if (!target || target.conversationId !== conversation.id) throw errors.notFound('Message');
        if (target.role !== 'user') throw errors.badRequest('Can only edit user messages');
        repos.chat.deleteMessagesFrom(conversation.id, target.seq);
        truncateSessionEvents(repos, session.id, { messageId: target.id });
      }

      
      let finalContent = '';
      if (mode !== 'regenerate') {
        const content = String(body.content || '').trim();
        if (!content && !(body.attachmentIds || []).length) throw errors.badRequest('Message is empty');

        
        
        const images = [];
        let fileContext = '';
        const attachmentRefs = [];
        for (const fileId of body.attachmentIds || []) {
          const file = repos.files.get(req.auth.userId, fileId);
          if (!file) continue;
          attachmentRefs.push({ id: file.id, name: file.filename, kind: file.kind });
          const rawFile = repos.files.getRaw(file.id);
          const absPath = path.join(config.filesDir, rawFile.storage_path);
          if (file.kind === 'image' && IMAGE_MIMES.has(file.mime)) {
            const b64 = (await fs.readFile(absPath)).toString('base64');
            images.push({ mime: file.mime, base64: b64, name: file.filename });
          } else {
            const text = rawFile?.extracted_text;
            if (text) {
              fileContext += `\n\n<file name="${file.filename}">\n${text.slice(0, 20_000)}\n</file>`;
            } else {
              fileContext += `\n\n<file name="${file.filename}" note="no text extraction available for this file type" />`;
            }
          }
        }

        const msgId = randomId('msg');
        finalContent = content + fileContext;
        const seq = repos.chat.nextSeq(conversation.id);
        repos.chat.insertMessage({
          id: msgId,
          conversationId: conversation.id,
          userId: req.auth.userId,
          seq,
          role: 'user',
          content,
          attachments: attachmentRefs.length ? attachmentRefs : null,
        });
        if (fileContext) {
          repos.chat.updateMessage(msgId, { content: finalContent });
        }
        const row = repos.chat.getMessage(msgId);

        
        const userEvent = kernel.append(session.id, req.auth.userId, 'user/message', {
          content: finalContent,
          messageId: msgId,
          attachments: images.map((i) => ({ mime: i.mime, name: i.name })),
          displayAttachments: attachmentRefs.length ? attachmentRefs : null,
          messageRow: row,
        });
        
        
        const userFrame = toChatFrame(userEvent);
        if (userFrame) sseSend(res, userFrame);
      }

      
      if (conversation.title === 'New conversation' && mode !== 'regenerate') {
        const first = body.content || 'File conversation';
        repos.chat.updateConversation(req.auth.userId, conversation.id, {
          title: first.slice(0, 60) + (first.length > 60 ? '…' : ''),
        });
      }

      
      const abortController = new AbortController();
      clientAborted.then(() => abortController.abort());
      const untrack = trackAbort(session.id, abortController);

      const runId = randomId('run');
      repos.runs.createRun({
        id: runId,
        userId: req.auth.userId,
        agentId: null,
        agentName: 'Chat',
        projectId: conversation.projectId || null,
        task: (body.content || 'Chat turn').slice(0, 120),
        kind: 'chat',
        conversationId: conversation.id,
      });

      const assistantId = randomId('msg');
      let turnError = null;
      let turn = null;
      try {
        turn = await orchestrator.runTurn({
          userId: req.auth.userId,
          sessionId: session.id,
          runId,
          kind: 'chat',
          conversationId: conversation.id,
          projectId: conversation.projectId || null,
          query: body.content || 'Chat turn',
          modelRowId,
          attachments: (body.attachmentIds || []).length,
          signal: abortController.signal,
          permissionMode,
          planMode,
          scopeKey: conversation.id,
          
          
          onEvent: (frame) => sseSend(res, frame),
          persistStep: ({ role, content, reasoning, attachments, displayName }) => {
            repos.chat.insertMessage({
              id: randomId('msg'),
              conversationId: conversation.id,
              userId: req.auth.userId,
              seq: repos.chat.nextSeq(conversation.id),
              role,
              content,
              reasoning: reasoning || null,
              attachments: attachments ? { ...attachments, ...(displayName && role === 'tool' ? { displayName } : {}) } : null,
              modelLabel: null,
              status: 'complete',
            });
          },
          onPlan: ({ planId, understanding, steps, status }) => {
            const existing = repos.chat.getMessage(planId);
            if (existing) {
              repos.chat.updateMessage(planId, { attachments: { kind: 'plan', understanding, steps, status } });
            } else {
              repos.chat.insertMessage({
                id: planId,
                conversationId: conversation.id,
                userId: req.auth.userId,
                seq: repos.chat.nextSeq(conversation.id),
                role: 'assistant',
                content: '',
                attachments: { kind: 'plan', understanding, steps, status },
                modelLabel: null,
                status: 'complete',
              });
            }
          },
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          turnError = 'aborted';
        } else {
          turnError = err.message || 'Model request failed';
        }
      } finally {
        untrack?.();
      }

      const wasAborted = turnError === 'aborted';
      const text = turn?.text || '';
      const status = wasAborted ? 'aborted' : turnError ? 'error' : text || turn?.reasoning ? 'complete' : 'error';

      repos.chat.insertMessage({
        id: assistantId,
        conversationId: conversation.id,
        userId: req.auth.userId,
        seq: repos.chat.nextSeq(conversation.id),
        role: 'assistant',
        content: text,
        reasoning: turn?.reasoning || null,
        usage: turn?.usage || null,
        modelLabel: resolveModelLabel(repos, req.auth.userId, modelRowId),
        status,
        error: turnError && !wasAborted ? turnError : null,
      });
      repos.chat.touchConversation(conversation.id);

      if (turnError && !wasAborted) {
        sseSend(res, { type: 'error', message: turnError });
      }
      sseSend(res, {
        type: 'done',
        messageId: assistantId,
        usage: turn?.usage || null,
        status: wasAborted ? 'aborted' : status,
        conversation: repos.chat.getConversation(req.auth.userId, conversation.id),
      });
      res.end();

      
      
      if (!turnError && status === 'complete' && mode === 'send' && enqueueMemoryExtraction) {
        const extractionSetting = repos.users.getSetting(req.auth.userId, 'auto_memory');
        const enabled = extractionSetting === null ? true : !!extractionSetting;
        const recentMessages = repos.chat.listMessages(conversation.id, { limit: 10 });
        if (enabled && recentMessages.length <= 4 && repos.users.getSetting(req.auth.userId, 'default_model')) {
          enqueueMemoryExtraction(conversation.id, req.auth.userId);
        }
      }
    } catch (err) {
      if (!res.writableEnded) {
        sseSend(res, { type: 'error', message: err.message || 'Internal error' });
        res.end();
      } else {
        next(err);
      }
    }
  });

  return router;
}


function truncateSessionEvents(repos, sessionId, { type, messageId }) {
  const events = repos.sessions.listEvents(sessionId);
  let upto = -1;
  for (const ev of events) {
    if (type && ev.type === type) upto = ev.seq;
    if (messageId && ev.data?.messageId === messageId) upto = ev.seq;
  }
  if (upto >= 0) repos.sessions.truncateFrom(sessionId, upto);
}

function resolveModelLabel(repos, userId, modelRowId) {
  const model = repos.providers.getModel(userId, modelRowId);
  return model ? model.displayName : null;
}