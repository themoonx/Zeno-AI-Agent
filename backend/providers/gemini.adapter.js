
import { upstreamFromResponse } from '../core/errors.js';

function toGeminiContents(messages) {
  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.name || m.toolCallId, response: { result: m.content } } }],
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls) {
        parts.push({
          functionCall: {
            name: tc.name,
            args: typeof tc.arguments === 'string' ? safeJson(tc.arguments) : tc.arguments || {},
          },
        });
      }
      contents.push({ role: 'model', parts });
      continue;
    }
    const parts = [];
    if (m.images?.length) {
      for (const img of m.images) {
        parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
      }
    }
    if (m.content) parts.push({ text: m.content });
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  return contents;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}

function toolsToGemini(tools) {
  if (!tools?.length) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || { type: 'object', properties: {} },
      })),
    },
  ];
}

async function chatStream(ctx) {
  const { baseUrl, apiKey, headers, model, messages, tools, params, signal, onDelta, onToolCall, onUsage } = ctx;

  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');

  const body = {
    contents: toGeminiContents(messages),
    generationConfig: {
      ...(params?.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params?.top_p !== undefined ? { topP: params.top_p } : {}),
      ...(params?.max_tokens ? { maxOutputTokens: params.max_tokens } : {}),
    },
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(toolsToGemini(tools) ? { tools: toolsToGemini(tools) } : {}),
  };

  const url =
    baseUrl.replace(/\/+$/, '') +
    `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey || '', ...(headers || {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw upstreamFromResponse('Gemini', response.status, text || response.statusText);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  let finishReason = null;
  let sawToolCall = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        let ev;
        try {
          ev = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (ev.usageMetadata) {
          usage = {
            promptTokens: ev.usageMetadata.promptTokenCount ?? null,
            completionTokens: ev.usageMetadata.candidatesTokenCount ?? null,
          };
        }
        const candidate = ev.candidates?.[0];
        if (!candidate) continue;
        if (candidate.finishReason) finishReason = candidate.finishReason;
        for (const part of candidate.content?.parts || []) {
          if (part.text) onDelta?.({ type: 'text', text: part.text });
          if (part.thought) onDelta?.({ type: 'reasoning', text: part.text });
          if (part.functionCall) {
            sawToolCall = true;
            onToolCall?.({
              id: `call_${Math.random().toString(36).slice(2, 10)}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args || {},
            });
          }
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  if (usage) onUsage?.(usage);
  return { finishReason: sawToolCall ? 'tool_calls' : finishReason || 'stop' };
}

async function listModels({ baseUrl, apiKey, headers, signal }) {
  const url = baseUrl.replace(/\/+$/, '') + '/v1beta/models';
  const response = await fetch(url, { headers: { 'x-goog-api-key': apiKey || '', ...(headers || {}) }, signal });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw upstreamFromResponse('Gemini', response.status, text || response.statusText);
  }
  const data = await response.json();
  return (data?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: (m.name || '').replace(/^models\
    .filter((m) => !!m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export const geminiAdapter = { name: 'gemini', chatStream, listModels };
