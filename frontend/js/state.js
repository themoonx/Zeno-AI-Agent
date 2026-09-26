


function createStore() {
  const state = {
    user: null,
    authChecked: false,

    providers: [],
    models: [],
    providerKinds: {},

    conversations: [],
    projects: [],
    tools: [],

    settings: {},
    sandboxMode: 'unknown',

    
    currentConversationId: null,
    currentModelId: null, 
    streaming: false,
    attachments: [], 

    
    permissionMode: 'ask', 
    planMode: false, 

    
    pendingApprovals: [],
  };

  const listeners = new Map(); 

  function emit(key) {
    const set = listeners.get(key);
    if (set) for (const fn of [...set]) fn(state);
    const wild = listeners.get('*');
    if (wild) for (const fn of [...wild]) fn(state);
  }

  return {
    get state() {
      return state;
    },
    subscribe(key, fn) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(fn);
      return () => listeners.get(key).delete(fn);
    },
    update(patch) {
      Object.assign(state, patch);
      for (const k of Object.keys(patch)) emit(k);
      emit('*');
    },
    emit,
  };
}

export const store = createStore();


export function currentConversation() {
  return store.state.conversations.find((c) => c.id === store.state.currentConversationId) || null;
}
export function currentModel() {
  return store.state.models.find((m) => m.id === store.state.currentModelId) || null;
}
export function providerOf(model) {
  return model ? store.state.providers.find((p) => p.id === model.providerId) : null;
}
export function defaultModel() {
  const { models, settings } = store.state;
  if (settings.default_model?.modelId) {
    const m = models.find((x) => x.id === settings.default_model.modelId);
    if (m) return m;
  }
  return models[0] || null;
}
