

export const PROVIDER_KINDS = {
  openai: {
    label: 'OpenAI',
    protocol: 'OpenAI API',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    docsHint: 'Keys start with sk-… (platform.openai.com)',
    supports: ['chat', 'embeddings', 'models-list'],
  },
  'openai-compatible': {
    label: 'Custom / OpenAI-compatible',
    protocol: 'OpenAI-compatible (/chat/completions)',
    defaultBaseUrl: '',
    requiresKey: false,
    docsHint: 'Works with OpenRouter, Groq, DeepSeek, Together, vLLM, LM Studio, and any /v1-compatible server',
    supports: ['chat', 'embeddings', 'models-list'],
  },
  anthropic: {
    label: 'Anthropic',
    protocol: 'Anthropic Messages API',
    defaultBaseUrl: 'https://api.anthropic.com',
    requiresKey: true,
    docsHint: 'Keys start with sk-ant-… (console.anthropic.com)',
    supports: ['chat', 'models-list'],
  },
  gemini: {
    label: 'Google Gemini',
    protocol: 'Gemini generateContent',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    requiresKey: true,
    docsHint: 'Keys from aistudio.google.com',
    supports: ['chat', 'models-list'],
  },
  ollama: {
    label: 'Ollama (local)',
    protocol: 'Ollama native API',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    requiresKey: false,
    docsHint: 'Run ollama serve locally; no API key needed',
    supports: ['chat', 'embeddings', 'models-list'],
  },
};

export const CAPABILITIES = [
  { id: 'chat', label: 'Chat' },
  { id: 'vision', label: 'Vision (image input)' },
  { id: 'tools', label: 'Tool calling' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'embeddings', label: 'Embeddings' },
];

export function providerKindMeta(kind) {
  return PROVIDER_KINDS[kind] || null;
}
