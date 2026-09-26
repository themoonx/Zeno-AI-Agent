



import { decryptSecret } from '../core/crypto.js';
import { errors } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { config } from '../core/config.js';
import { openAiAdapter } from './openai.adapter.js';
import { anthropicAdapter } from './anthropic.adapter.js';
import { geminiAdapter } from './gemini.adapter.js';
import { ollamaAdapter } from './ollama.adapter.js';

const log = logger('gateway');

const ADAPTERS = {
  openai: openAiAdapter,
  'openai-compatible': openAiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter,
};

export function createGateway({ repos }) {
  function adapterFor(kind) {
    const adapter = ADAPTERS[kind];
    if (!adapter) throw errors.badRequest(`Unsupported provider protocol: ${kind}`);
    return adapter;
  }

  
  function resolveModel(userId, modelRowId) {
    const model = repos.providers.getModel(userId, modelRowId);
    if (!model) throw errors.notFound('Model');
    const provider = repos.providers.getProvider(userId, model.providerId);
    if (!provider) throw errors.notFound('Provider for model');
    
    
    const raw = repos.providers.getProviderRaw(provider.id);
    const apiKey = raw?.credentials ? decryptSecret(raw.credentials) : null;
    return {
      model,
      provider,
      ctx: {
        baseUrl: provider.baseUrl,
        apiKey,
        headers: provider.extraHeaders || {},
        params: { ...(provider.params || {}), ...(model.params || {}) },
        model: model.modelId,
      },
    };
  }

  return {
    adapterFor,

    resolveModel,

    
    
    async chatStream({ userId, modelRowId, messages, tools = null, signal, onDelta, onToolCall, onUsage, timeoutMs = 300_000 }) {
      const { model, provider, ctx } = resolveModel(userId, modelRowId);
      const adapter = adapterFor(provider.kind);
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

      try {
        const result = await adapter.chatStream({
          ...ctx,
          messages,
          tools,
          signal: combined,
          onDelta,
          onToolCall,
          onUsage,
        });
        return result;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (err?.status) throw err;
        log.warn(`chatStream failed for model ${model.modelId}: ${err.message}`);
        throw errors.upstream(`Model request failed: ${err.message}`);
      }
    },

    
    
    
    async complete({ userId, modelRowId, messages, tools = null, timeoutMs = 120_000, onUsage = null }) {
      const { model, provider, ctx } = resolveModel(userId, modelRowId);
      const adapter = adapterFor(provider.kind);
      const signal = AbortSignal.timeout(timeoutMs);

      let text = '';
      let reasoning = '';
      const toolCalls = [];
      const result = await adapter.chatStream({
        ...ctx,
        messages,
        tools,
        signal,
        onDelta: (d) => {
          if (d.type === 'text') text += d.text;
          else reasoning += d.text;
        },
        onToolCall: (tc) => toolCalls.push(tc),
        onUsage: (u) => onUsage?.(u),
      });
      return { text, reasoning, toolCalls, finishReason: result.finishReason, model, provider };
    },

    async embed({ userId, modelRowId, input, timeoutMs = 60_000 }) {
      const { model, provider, ctx } = resolveModel(userId, modelRowId);
      const adapter = adapterFor(provider.kind);
      if (!adapter.embed) throw errors.badRequest(`Provider ${provider.kind} does not support embeddings`);
      const signal = AbortSignal.timeout(timeoutMs);
      const embeddings = await adapter.embed({ ...ctx, model: model.modelId, input, signal });
      return embeddings;
    },

    async listModels({ userId, providerRowId, timeoutMs = 20_000 }) {
      const provider = repos.providers.getProvider(userId, providerRowId);
      if (!provider) throw errors.notFound('Provider');
      const adapter = adapterFor(provider.kind);
      const raw = repos.providers.getProviderRaw(providerRowId);
      const apiKey = raw?.credentials ? decryptSecret(raw.credentials) : null;
      const signal = AbortSignal.timeout(timeoutMs);
      return adapter.listModels({ baseUrl: provider.baseUrl, apiKey, headers: provider.extraHeaders || {}, signal });
    },

    
    async testConnection({ kind, baseUrl, apiKey, extraHeaders, timeoutMs = 15_000 }) {
      const adapter = adapterFor(kind);
      const signal = AbortSignal.timeout(timeoutMs);
      const models = await adapter.listModels({ baseUrl, apiKey: apiKey || null, headers: extraHeaders || {}, signal });
      return { ok: true, modelCount: models.length };
    },
  };
}



export function assertValidBaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw errors.badRequest('Base URL must be a valid absolute URL (e.g. https://api.example.com/v1)');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw errors.badRequest('Base URL must use http or https');
  }
  return parsed.toString().replace(/\/+$/, '');
}
