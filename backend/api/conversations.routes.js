import { Router } from 'express';
import { validate } from '../core/validate.js';
import { errors } from '../core/errors.js';
import { randomId } from '../core/crypto.js';

export function createConversationRoutes({ repos, config }) {
  const router = Router();

  router.get('/', (req, res) => {
    const { archived, projectId } = req.query;
    const conversations = repos.chat.listConversations(req.auth.userId, {
      includeArchived: archived === 'true' || archived === '1',
      projectId: projectId || null,
    });
    res.json({ conversations });
  });

  router.post('/', (req, res, next) => {
    try {
      const body = validate(req.body, {
        projectId: { type: 'string', max: 64 },
        title: { type: 'string', max: 200 },
        systemPrompt: { type: 'string', max: 8000 },
        providerId: { type: 'string', max: 64 },
        modelId: { type: 'string', max: 64 },
      });
      if (repos.chat.countConversations(req.auth.userId) >= config.limits.maxConversations) {
        throw errors.badRequest(`Conversation limit reached (${config.limits.maxConversations})`);
      }
      let projectId = body.projectId || null;
      if (projectId && !repos.projects.getProject(req.auth.userId, projectId)) throw errors.notFound('Project');

      
      let systemPrompt = body.systemPrompt || null;
      if (projectId && !systemPrompt) {
        systemPrompt = repos.projects.getProject(req.auth.userId, projectId)?.systemPrompt || null;
      }

      const id = randomId('conv');
      repos.chat.createConversation({
        id,
        userId: req.auth.userId,
        projectId,
        title: body.title || 'New conversation',
        systemPrompt,
        providerId: body.providerId || null,
        modelId: body.modelId || null,
      });
      res.status(201).json({ conversation: repos.chat.getConversation(req.auth.userId, id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const conversation = repos.chat.getConversation(req.auth.userId, req.params.id);
      if (!conversation) throw errors.notFound('Conversation');
      const messages = repos.chat.listMessages(conversation.id);
      res.json({ conversation, messages });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', (req, res, next) => {
    try {
      const conversation = repos.chat.getConversation(req.auth.userId, req.params.id);
      if (!conversation) throw errors.notFound('Conversation');
      const body = validate(req.body, {
        title: { type: 'string', min: 1, max: 200 },
        systemPrompt: { type: 'string', max: 8000 },
        providerId: { type: 'string', max: 64 },
        modelId: { type: 'string', max: 64 },
        modelLabel: { type: 'string', max: 200 },
        pinned: { type: 'boolean' },
        archived: { type: 'boolean' },
        projectId: { type: 'string', max: 64 },
        params: { type: 'object' },
      });
      repos.chat.updateConversation(req.auth.userId, conversation.id, body);
      res.json({ conversation: repos.chat.getConversation(req.auth.userId, conversation.id) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const conversation = repos.chat.getConversation(req.auth.userId, req.params.id);
      if (!conversation) throw errors.notFound('Conversation');
      repos.chat.deleteConversation(req.auth.userId, conversation.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/messages', (req, res, next) => {
    try {
      const conversation = repos.chat.getConversation(req.auth.userId, req.params.id);
      if (!conversation) throw errors.notFound('Conversation');
      const beforeSeq = req.query.before ? Number(req.query.before) : null;
      const messages = repos.chat.listMessages(conversation.id, { beforeSeq });
      res.json({ messages });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
