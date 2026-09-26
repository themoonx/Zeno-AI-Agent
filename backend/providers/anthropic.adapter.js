
import { upstreamFromResponse } from '../core/errors.js';

const ANTHROPIC_VERSION = '2023-06-01';

function buildHeaders(apiKey, extraHeaders) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey || '',
    'anthropic-version': ANTHROPIC_VERSION,
    ...(extraHeaders || {}),
  };
}

function messagesToAnthropic(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') continue; 
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: 'tool_use', id: tc.id || `call_${content.length}`, name: tc.name, input: typeof tc.arguments === 'string' ? safeJson(tc.arguments) : tc.arguments || {} });
      }
      out.push({ role: 'assistant', content });
      continue;
    }
    if (m.images?.length && m.role === 'user') {
      out.push({
        role: 'user',
        content: [
          ...m.images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } })),
          { type: 'text', text: m.content },
        ],
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  
  const merged = [];
  for (const msg of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role && !Array.isArray(prev.content) && !Array.isArray(msg.content)) {
      prev.content += '\n\n' + msg.content;
    } else {
      merged.push(msg);
    }
  }
  return merged;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}

async function chatStream(ctx) {
  const { baseUrl, apiKey, headers, model, messages, tools, params, signal, onDelta, onToolCall, onUsage } = ctx;

  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');

  const body = {
    model,
    messages: messagesToAnthropic(messages),
    stream: true,
    max_tokens: params?.max_tokens ?? params?.maxOutputTokens ?? 4096,
    ...(system ? { system } : {}),
    ...(params?.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params?.top_p !== undefined ? { top_p: params.top_p } : {}),
    ...(tools?.length
      ? {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description || '',
            input_schema: t.parameters || { type: 'object', properties: {} },
          })),
        }
      : {}),
  };

  const endpoint = baseUrl.replace(/\/+$/, '') + '/v1/messages';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(apiKey, headers),
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw upstreamFromResponse(model, response.status, text || response.statusText);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason = null;
  let usage = null;
  const toolAcc = new Map();

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
        if (ev.type === 'message_start' && ev.message?.usage) {
          usage = { promptTokens: ev.message.usage.input_tokens ?? null, completionTokens: null };
        }
        if (ev.type === 'content_block_delta') {
          const d = ev.delta || {};
          if (d.type === 'text_delta' && d.text) onDelta?.({ type: 'text', text: d.text });
          if (d.type === 'thinking_delta' && d.thinking) onDelta?.({ type: 'reasoning', text: d.thinking });
          if (d.type === 'input_json_delta' && d.partial_json) {
            const acc = toolAcc.get(ev.index) || { id: null, name: '', arguments: '' };
            acc.arguments += d.partial_json;
            toolAcc.set(ev.index, acc);
          }
        }
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          toolAcc.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, arguments: '' });
        }
        if (ev.type === 'content_block_stop' && toolAcc.has(ev.index)) {
          const acc = toolAcc.get(ev.index);
          let args = {};
          try {
            args = acc.arguments ? JSON.parse(acc.arguments) : {};
          } catch {
            args = { _raw: acc.arguments };
          }
          onToolCall?.({ id: acc.id, name: acc.name, arguments: args });
          toolAcc.delete(ev.index);
        }
        if (ev.type === 'message_delta') {
          if (ev.delta?.stop_reason) finishReason = ev.delta.stop_reason;
          if (ev.usage?.output_tokens) usage = { ...(usage || {}), completionTokens: ev.usage.output_tokens };
        }
        if (ev.type === 'error') {
          throw upstreamFromResponse(model, 500, ev.error?.message || 'Anthropic stream error');
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  if (usage) onUsage?.(usage);
  return { finishReason: finishReason === 'tool_use' ? 'tool_calls' : finishReason || 'stop' };
}

async function listModels({ baseUrl, apiKey, headers, signal }) {
  const endpoint = baseUrl.replace(/\/+$/, '') + '/v1/models';
  const response = await fetch(endpoint, { headers: buildHeaders(apiKey, headers), signal });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw upstreamFromResponse('Anthropic', response.status, text || response.statusText);
  }
  const data = await response.json();
  return (data?.data || [])
    .map((m) => ({ id: m.id, name: m.display_name || m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export const anthropicAdapter = { name: 'anthropic', chatStream, listModels };
