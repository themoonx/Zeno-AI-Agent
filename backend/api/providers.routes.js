import { Router } from 'express';
import { validate } from '../core/validate.js';
import { errors } from '../core/errors.js';
import { randomId, encryptSecret, maskSecret, decryptSecret } from '../core/crypto.js';
import { assertValidBaseUrl } from '../providers/gateway.js';
import { PROVIDER_KINDS, CAPABILITIES } from '../providers/registry.js';
import { clientIp } from '../core/ratelimit.js';

export function createProviderRoutes({ repos, gateway, audit, config }) {
  const router = Router();

  router.get('/meta', (req, res) => {
    res.json({ kinds: PROVIDER_KINDS, capabilities: CAPABILITIES });
  });

  router.get('/', (req, res) => {
    const providers = repos.providers.listProviders(req.auth.userId).map((p) => ({
      ...p,
      credentialsPreview: p.hasCredentials ? maskSecret(decryptSecret(rawCredentials(repos, p.id)) || '') : null,
    }));
    const models = repos.providers.listModels(req.auth.userId);
    res.json({ providers, models });
  });

  function rawCredentials(repos, providerId) {
    const raw = repos.providers.getProviderRaw(providerId);
    if (!raw?.credentials) return null;
    return decryptSecret(raw.credentials);
  }

  router.post('/', async (req, res, next) => {
    try {
      const body = validate(req.body, {
        kind: { type: 'string', required: true, enum: Object.keys(PROVIDER_KINDS) },
        name: { type: 'string', required: true, min: 1, max: 80 },
        baseUrl: { type: 'string', required: true, max: 400 },
        apiKey: { type: 'string', max: 500 },
        extraHeaders: { type: 'object' },
        params: { type: 'object' },
        test: { type: 'boolean', default: true },
      });
      if (repos.providers.countProviders(req.auth.userId) >= config.limits.maxProviders) {
        throw errors.badRequest(`Provider limit reached (${config.limits.maxProviders})`);
      }
      const baseUrl = assertValidBaseUrl(body.baseUrl);
      const kindMeta = PROVIDER_KINDS[body.kind];
      if (kindMeta.requiresKey && !body.apiKey) {
        throw errors.badRequest(`${kindMeta.label} requires an API key`);
      }

      let testResult = null;
      if (body.test) {
        try {
          testResult = await gateway.testConnection({
            kind: body.kind,
            baseUrl,
            apiKey: body.apiKey || null,
            extraHeaders: body.extraHeaders,
          });
        } catch (err) {
          testResult = { ok: false, error: err.message };
        }
      }

      const id = randomId('prov');
      repos.providers.createProvider({
        id,
        userId: req.auth.userId,
        kind: body.kind,
        name: body.name,
        baseUrl,
        credentialsEnc: body.apiKey ? encryptSecret(body.apiKey) : null,
        extraHeaders: body.extraHeaders || {},
        params: body.params || {},
      });
      if (testResult) {
        repos.providers.updateProviderStatus(
          req.auth.userId,
          id,
          testResult.ok ? 'connected' : 'error',
          testResult.ok ? `${testResult.modelCount} models visible` : testResult.error
        );
      }
      audit({ userId: req.auth.userId, action: 'provider.create', target: id, ip: clientIp(req), meta: { kind: body.kind } });
      const provider = repos.providers.getProvider(req.auth.userId, id);
      res.status(201).json({ provider, testResult });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/test', async (req, res, next) => {
    try {
      const provider = repos.providers.getProvider(req.auth.userId, req.params.id);
      if (!provider) throw errors.notFound('Provider');
      const apiKey = rawCredentials(repos, provider.id);
      try {
        const result = await gateway.testConnection({
          kind: provider.kind,
          baseUrl: provider.baseUrl,
          apiKey,
          extraHeaders: provider.extraHeaders,
        });
        repos.providers.updateProviderStatus(req.auth.userId, provider.id, 'connected', `${result.modelCount} models visible`);
        res.json({ ok: true, modelCount: result.modelCount });
      } catch (err) {
        repos.providers.updateProviderStatus(req.auth.userId, provider.id, 'error', err.message);
        res.json({ ok: false, error: err.message });
      }
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/models', async (req, res, next) => {
    try {
      const models = await gateway.listModels({ userId: req.auth.userId, providerRowId: req.params.id });
      res.json({ models });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const provider = repos.providers.getProvider(req.auth.userId, req.params.id);
      if (!provider) throw errors.notFound('Provider');
      const body = validate(req.body, {
        name: { type: 'string', min: 1, max: 80 },
        baseUrl: { type: 'string', max: 400 },
        apiKey: { type: 'string', max: 500 },
        extraHeaders: { type: 'object' },
        params: { type: 'object' },
      });
      const fields = {};
      if (body.name !== undefined) fields.name = body.name;
      if (body.baseUrl !== undefined) fields.base_url = assertValidBaseUrl(body.baseUrl);
      if (body.extraHeaders !== undefined) fields.extra_headers = body.extraHeaders;
      if (body.params !== undefined) fields.params = body.params;
      if (body.apiKey) fields.credentials = encryptSecret(body.apiKey);
      if (body.apiKey === '') fields.credentials = null;
      if (Object.keys(fields).length) {
        fields.has_credentials = fields.credentials ? 1 : 0;
        repos.providers.updateProvider(req.auth.userId, provider.id, fields);
        repos.providers.updateProviderStatus(req.auth.userId, provider.id, 'unverified', null);
      }
      res.json({ provider: repos.providers.getProvider(req.auth.userId, provider.id) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const provider = repos.providers.getProvider(req.auth.userId, req.params.id);
      if (!provider) throw errors.notFound('Provider');
      repos.providers.deleteProvider(req.auth.userId, provider.id);
      audit({ userId: req.auth.userId, action: 'provider.delete', target: provider.id, ip: clientIp(req) });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  
  router.post('/:id/models', (req, res, next) => {
    try {
      const provider = repos.providers.getProvider(req.auth.userId, req.params.id);
      if (!provider) throw errors.notFound('Provider');
      const body = validate(req.body, {
        modelId: { type: 'string', required: true, min: 1, max: 200 },
        displayName: { type: 'string', required: true, min: 1, max: 120 },
        contextWindow: { type: 'number', min: 1024, max: 100_000_000 },
        maxOutputTokens: { type: 'number', min: 16, max: 10_000_000 },
        capabilities: { type: 'array', items: { type: 'string' } },
        params: { type: 'object' },
      });
      if (repos.providers.countModels(req.auth.userId) >= config.limits.maxProviders * 20) {
        throw errors.badRequest('Model limit reached');
      }
      const id = randomId('mdl');
      repos.providers.createModel({
        id,
        userId: req.auth.userId,
        providerId: provider.id,
        modelId: body.modelId,
        displayName: body.displayName,
        contextWindow: body.contextWindow,
        maxOutputTokens: body.maxOutputTokens,
        capabilities: body.capabilities || ['chat'],
        params: body.params || {},
      });
      res.status(201).json({ model: repos.providers.getModel(req.auth.userId, id) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/models/:modelId', (req, res, next) => {
    try {
      const model = repos.providers.getModel(req.auth.userId, req.params.modelId);
      if (!model) throw errors.notFound('Model');
      const body = validate(req.body, {
        displayName: { type: 'string', min: 1, max: 120 },
        contextWindow: { type: 'number', min: 1024, max: 100_000_000 },
        maxOutputTokens: { type: 'number', min: 16, max: 10_000_000 },
        capabilities: { type: 'array', items: { type: 'string' } },
        params: { type: 'object' },
      });
      const fields = {};
      if (body.displayName !== undefined) fields.display_name = body.displayName;
      if (body.contextWindow !== undefined) fields.context_window = Math.round(body.contextWindow);
      if (body.maxOutputTokens !== undefined) fields.max_output_tokens = Math.round(body.maxOutputTokens);
      if (body.capabilities !== undefined) fields.capabilities = body.capabilities;
      if (body.params !== undefined) fields.params = body.params;
      repos.providers.updateModel(req.auth.userId, model.id, fields);
      res.json({ model: repos.providers.getModel(req.auth.userId, model.id) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/models/:modelId', (req, res, next) => {
    try {
      const model = repos.providers.getModel(req.auth.userId, req.params.modelId);
      if (!model) throw errors.notFound('Model');
      repos.providers.deleteModel(req.auth.userId, model.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
