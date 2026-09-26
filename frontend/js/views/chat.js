



import { h, toast } from '../ui.js';
import { icon, zenoMark } from '../icons.js';
import { store, currentConversation, currentModel, defaultModel } from '../state.js';
import { api } from '../api.js';
import { renderUserMessage, renderAssistantMessage } from '../components/message.js';
import { activityCard, approvalCard, planCard, thinkingIndicator, rotateThinkingLabel, snapshotCard, subagentCard, reviewCard, verificationCard } from '../components/activity.js';
import { openFilePreview } from '../components/file-preview.js';
import { createComposer } from '../components/composer.js';
import { markdownEl } from '../markdown.js';

export function mountChatView(root, { conversationId }) {
  const view = h('div', { class: 'chat-wrap' });
  root.append(view);
  let abortStream = null;
  let composer = null;
  let disposed = false;
  let sending = false;
  let stickToBottom = true;
  let frame = null;
  let undoBar = null;
  let undoBarBusy = false;
  let threadEl, scrollEl, scrollBtn, composerZoneHolder;

  const state = {
    messages: [],
    conversation: null,
    streamingEl: null,
    editing: null,
  };

  view.append(buildSkeleton());
  init(conversationId);

  async function init(convId) {
    try {
      if (convId) {
        const res = await api.get(`/conversations/${convId}`);
        if (disposed) return;
        state.conversation = res.conversation;
        state.messages = res.messages;
        store.update({ currentConversationId: convId, currentModelId: res.conversation.modelId || null });
      } else {
        state.conversation = null;
        state.messages = [];
        store.update({ currentConversationId: null, currentModelId: null });
      }
    } catch (err) {
      if (convId) {
        toast(err.message, 'error');
        location.hash = '#/chat';
        return;
      }
    }
    rebuild();
  }

  function buildSkeleton() {
    scrollEl = h('div', { class: 'chat-scroll' });
    threadEl = h('div', { class: 'chat-thread' });
    scrollEl.append(threadEl);
    scrollEl.addEventListener('scroll', updateScrollBtn);
    scrollBtn = h('button', { class: 'scroll-btn hidden', html: icon('arrowDown'), onclick: scrollToBottom });
    composerZoneHolder = h('div');
    const wrap = h('div', { class: 'chat-stack' }, scrollEl, scrollBtn, composerZoneHolder);
    return wrap;
  }

  function rebuild() {
    if (disposed) return;
    threadEl.innerHTML = '';
    const hasMessages = state.messages.length > 0;
    view.classList.toggle('is-empty', !hasMessages);

    if (!hasMessages) {
      threadEl.append(buildHero());
    } else {
      let activityGroup = null;
      for (const msg of state.messages) {
        if (msg.role === 'user') {
          activityGroup = null;
          threadEl.append(renderUserMessage(msg, { onEdit: beginEdit }));
        } else if (msg.role === 'tool') {
          
          const att = msg.attachments || {};
          if (!activityGroup) {
            activityGroup = h('div', { class: 'chat-activity' });
            threadEl.append(activityGroup);
          }
          if (att.kind === 'snapshot') {
            activityGroup.append(snapshotCard({ action: att.action, snapshotId: att.snapshotId, written: att.written, removed: att.removed, files: att.files }));
          } else {
            activityGroup.append(activityCard({ tool: att.tool, displayName: att.displayName, ok: att.ok, denied: att.denied, file: att.file, result: msg.content }, { onOpenFile: openFilePreview }));
          }
        } else if (msg.role === 'assistant') {
          const att = msg.attachments && !Array.isArray(msg.attachments) ? msg.attachments : null;
          if (att?.kind === 'tool_step') {
            activityGroup = null; 
            continue;
          }
          if (att?.kind === 'plan') {
            activityGroup = null;
            threadEl.append(planCard({ planId: msg.id, understanding: att.understanding, steps: att.steps || [], status: att.status || 'done' }));
            continue;
          }
          activityGroup = null;
          threadEl.append(renderAssistantMessage(msg, { onRegenerate: () => regenerate() }));
        }
      }
    }

    
    composer?.destroy();
    composerZoneHolder.innerHTML = '';
    composer = createComposer({ onSend: handleSend, onStop: handleStop });
    composerZoneHolder.append(composer.el);
    composer.refreshModelChip();
    if (!defaultModel() && !currentModel()) {
      const heroNote = h('div', { class: 'upload-hint' },
        h('span', { text: 'No models configured. ' }),
        h('a', { href: '#/settings/providers', text: 'Add a provider →' })
      );
      composer.el.append(heroNote);
    }

    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (disposed) return;
      updateScrollBtn();
      if (hasMessages) scrollToBottom(true);
      composer.focus();
    });

    updateUndoBar();
  }

  
  
  
  async function updateUndoBar() {
    if (disposed) return;
    let st = { canUndo: false, canRedo: false };
    if (state.conversation) {
      try {
        st = await api.get(`/chat/snapshot-stack?conversationId=${encodeURIComponent(state.conversation.id)}`);
      } catch {  }
    }
    if (disposed) return;
    if (!undoBar || !undoBar.isConnected) {
      undoBar = h('div', { class: 'undo-bar' });
      composerZoneHolder.insertBefore(undoBar, composerZoneHolder.firstChild);
    }
    undoBar.replaceChildren();
    const show = !!(st.canUndo || st.canRedo) && !store.state.streaming;
    undoBar.classList.toggle('hidden', !show);
    if (!show) return;
    if (st.canUndo) {
      undoBar.append(h('button', { class: 'btn sm ghost undo-btn', html: `${icon('history')}<span>Undo last change</span>`, onclick: () => snapshotAction('undo') }));
    }
    if (st.canRedo) {
      undoBar.append(h('button', { class: 'btn sm ghost undo-btn', html: `${icon('refresh')}<span>Redo</span>`, onclick: () => snapshotAction('redo') }));
    }
  }

  async function snapshotAction(kind) {
    if (!state.conversation || store.state.streaming || undoBarBusy) return;
    undoBarBusy = true;
    undoBar?.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      await api.post(`/chat/${kind}`, { conversationId: state.conversation.id });
      await refreshMessages();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      undoBarBusy = false;
      updateUndoBar();
    }
  }

  function buildHero() {
    return h(
      'div',
      { class: 'chat-hero' },
      h('span', { class: 'mark', html: zenoMark(46) }),
      h('h1', { text: 'What should we work on?' }),
      h('p', { text: 'A little clarity. A fresh idea. A task taken care of. Start a conversation and let’s take it from there.' }),
      h(
        'div',
        { class: 'suggestions' },
        ...[
          'Explain a concept simply',
          'Research a topic on the web',
          'Write a file with my notes',
          'Review this code for bugs',
        ].map((s) =>
          h('button', {
            class: 'suggestion',
            text: s,
            onclick: () => {
              if (composer) {
                composer.textarea.value = s;
                composer.textarea.dispatchEvent(new Event('input'));
                composer.focus();
              }
            },
          })
        )
      )
    );
  }

  
  async function handleSend({ content, attachments }) {
    if (disposed || sending || store.state.streaming) return;
    sending = true;
    composer?.setStreaming(true);
    let optimistic = null;
    const model = currentModel() || defaultModel();
    let conv = state.conversation;
    try {
      if (!conv) {
        const res = await api.post('/conversations', {
          modelId: model?.id || null,
          modelLabel: model?.displayName || null,
          providerId: model?.providerId || null,
          projectId: null,
        });
        if (disposed) return;
        conv = res.conversation;
        state.conversation = conv;
        store.update({ currentConversationId: conv.id, conversations: [conv, ...store.state.conversations] });
        history.replaceState(null, '', `#/chat/${conv.id}`);
      }

      
      optimistic = {
        id: 'tmp_' + Date.now(),
        role: 'user',
        content,
        attachments: attachments.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
        createdAt: Date.now(),
      };
      if (state.editing) {
        const idx = state.messages.findIndex((m) => m.id === state.editing.id);
        if (idx !== -1) state.messages = state.messages.slice(0, idx);
        threadEl.querySelectorAll('.msg, .chat-activity, .plan-card').forEach((el) => {
          if (!el.dataset.id || !state.messages.some((m) => m.id === el.dataset.id)) el.remove();
        });
      }
      state.messages.push(optimistic);
      view.classList.remove('is-empty');
      threadEl.querySelector('.chat-hero')?.remove();
      threadEl.append(renderUserMessage(optimistic));
      scrollToBottom();
      const editMessageId = state.editing?.id;
      state.editing = null;
      await startStream({
        conversationId: conv.id,
        modelRowId: model?.id,
        content,
        attachmentIds: attachments.map((a) => a.id),
        mode: editMessageId ? 'edit' : 'send',
        editMessageId,
        permissionMode: store.state.permissionMode,
        plan: store.state.planMode,
      });
    } catch (err) {
      if (disposed) return;
      toast(err.message, 'error');
      state.messages = state.messages.filter((m) => m.id !== optimistic?.id);
      rebuild();
      composer.textarea.value = content;
      store.update({ attachments });
      composer.textarea.dispatchEvent(new Event('input'));
    } finally {
      sending = false;
      if (!disposed && !store.state.streaming) composer?.setStreaming(false);
    }
  }

  async function regenerate() {
    if (store.state.streaming || !state.conversation) return;
    
    while (state.messages.length && state.messages[state.messages.length - 1].role === 'assistant') state.messages.pop();
    threadEl.querySelectorAll('.msg.assistant').forEach((el) => {
      if (!state.messages.some((m) => m.id === el.dataset.id)) el.remove();
    });
    await startStream({ conversationId: state.conversation.id, mode: 'regenerate', permissionMode: store.state.permissionMode });
  }

  function beginEdit(msg) {
    if (store.state.streaming || !composer) return;
    composer.textarea.value = msg.content;
    composer.textarea.dispatchEvent(new Event('input'));
    composer.focus();
    state.editing = msg;
    
    composer.el.dataset.editId = msg.id;
  }

  async function startStream(payload) {
    store.update({ streaming: true });
    composer?.setStreaming(true);

    const model = currentModel() || defaultModel();
    const streamMsg = { id: 'streaming', role: 'assistant', content: '', reasoning: '', modelLabel: model?.displayName, status: 'complete' };
    const el = renderAssistantMessage(streamMsg, { streaming: true });
    state.streamingEl = el;

    
    const activityZone = h('div', { class: 'chat-activity' });
    let actingEl = null;
    const liveToolCards = new Map(); 
    const subagentCards = new Map(); 
    let thinking = null;
    let stopThinkingLabel = null;
    let planCardEl = null;
    let sawOutput = false;
    let pendingRender = 0;
    threadEl.append(activityZone);
    threadEl.append(el);
    scrollToBottom();

    const setActing = (label) => {
      const next = label ? actingIndicator(label) : null;
      actingEl?.remove();
      actingEl = next;
      if (next) el.before(next);
    };

    const ensureThinking = () => {
      if (thinking || sawOutput) return;
      thinking = thinkingIndicator();
      stopThinkingLabel = rotateThinkingLabel(thinking);
      el.before(thinking);
    };
    const stopThinking = () => {
      stopThinkingLabel?.();
      stopThinkingLabel = null;
      if (thinking) {
        if (thinking._open) thinking.classList.add('collapsed-done');
        else thinking.remove();
        thinking = null;
      }
    };

    payload.modelRowId ||= model?.id;

    let done = false;
    let keepAlive = null;

    const finish = (finalEvent) => {
      if (done || disposed) return;
      done = true;
      abortStream = null;
      clearInterval(keepAlive);
      cancelAnimationFrame(pendingRender);
      store.update({ streaming: false });
      composer?.setStreaming(false);
      setActing(null);
      stopThinking();
      activityZone.remove();
      el.remove();
      state.streamingEl = null;
      
      refreshMessages(finalEvent?.status);
      if (finalEvent?.status === 'aborted') toast('Generation stopped', 'info');
    };

    abortStream = api.chatStream(
      payload,
      (event) => {
        if (disposed || done) return;
        switch (event.type) {
          case 'status': {
            if (event.phase === 'thinking' || event.phase === 'planning' || event.phase === 'routing') {
              ensureThinking();
              if (event.label && thinking?._label) thinking._label.textContent = event.label;
            } else if (event.phase === 'researching' || event.phase === 'verifying') {
              
              stopThinkingLabel?.();
              setActing(event.label || (event.phase === 'researching' ? 'Researching sources…' : 'Verifying…'));
            } else if (event.phase === 'executing') {
              setActing(null);
            }
            break;
          }
          case 'plan': {
            ensureThinking();
            if (event.phase === 'ready') {
              const card = planCard({ planId: event.planId, understanding: event.understanding, steps: event.steps || [], status: 'pending', requiresApproval: event.requiresApproval });
              card.dataset.id = event.planId;
              if (!event.requiresApproval) {
                card.classList.remove('is-pending');
                card.classList.add('is-approved');
                card.querySelector('.plan-status').textContent = ' — executing';
              }
              planCardEl = card;
              activityZone.append(card);
              maybeScroll();
            } else if (event.phase === 'approved' || event.phase === 'denied') {
              planCardEl?.classList.remove('is-pending');
              planCardEl?.classList.add(event.phase === 'approved' ? 'is-approved' : 'is-denied');
              const st = planCardEl?.querySelector('.plan-status');
              if (st) st.textContent = event.phase === 'approved' ? ' — executing' : ' — declined';
            } else if (event.phase === 'progress') {
              
              planCardEl?._setProgress?.(event.completedSteps || 0);
              maybeScroll();
            } else if (event.phase === 'finished') {
              if (planCardEl) {
                planCardEl.classList.remove('is-executing');
                planCardEl.classList.add('is-done');
                const st = planCardEl.querySelector('.plan-status');
                if (st) st.textContent = ' — complete';
              }
            }
            break;
          }
          case 'user_message':
            
            if (event.message) {
              const idx = state.messages.findIndex((m) => m.id.startsWith('tmp_'));
              if (idx !== -1) state.messages[idx] = event.message;
            }
            break;
          case 'activity': {
            if (event.kind === 'acting') {
              setActing(event.label || 'Working…');
            } else if (event.kind === 'tool_call') {
              setActing(null);
              stopThinking();
              sawOutput = true;
              const card = activityCard({ tool: event.tool, displayName: event.displayName, args: event.arguments, autoApproved: event.autoApproved }, { live: true });
              liveToolCards.set(event.callId || event.tool, card);
              activityZone.append(card);
              maybeScroll();
            } else if (event.kind === 'tool_result') {
              setActing(null);
              stopThinking();
              sawOutput = true;
              const existing = liveToolCards.get(event.callId || '') || [...liveToolCards.values()].find((c) => c.dataset.tool === event.tool);
              for (const [k, c] of liveToolCards) if (c === existing) liveToolCards.delete(k);
              const fresh = activityCard({ tool: event.tool, displayName: event.displayName, ok: event.ok, denied: event.denied, durationMs: event.durationMs, file: event.file, result: event.output }, { onOpenFile: openFilePreview });
              if (existing) existing.replaceWith(fresh);
              else activityZone.append(fresh);
              maybeScroll();
            } else if (event.kind === 'approval_decided') {
              setActing(null);
              maybeScroll();
            } else if (event.kind === 'snapshot') {
              sawOutput = true;
              activityZone.append(snapshotCard({ action: event.action, snapshotId: event.snapshotId, label: event.label, files: event.files }));
              maybeScroll();
            } else if (event.kind === 'subagent') {
              setActing(null);
              stopThinking();
              sawOutput = true;
              if (event.state === 'assigned') {
                const card = subagentCard({ state: 'assigned', subSessionId: event.subSessionId, task: event.task });
                if (event.subSessionId) subagentCards.set(event.subSessionId, card);
                activityZone.append(card);
              } else {
                const existing = subagentCards.get(event.subSessionId);
                for (const [k, c] of subagentCards) if (c === existing) subagentCards.delete(k);
                const fresh = subagentCard({ state: event.state, subSessionId: event.subSessionId, result: event.result });
                if (existing) existing.replaceWith(fresh);
                else activityZone.append(fresh);
              }
              maybeScroll();
            } else if (event.kind === 'review') {
              setActing(null);
              sawOutput = true;
              activityZone.append(reviewCard({ findings: event.findings, verdict: event.verdict }));
              maybeScroll();
            } else if (event.kind === 'verification') {
              setActing(null);
              sawOutput = true;
              activityZone.append(verificationCard({ level: event.level, ok: event.ok, issues: event.issues, confidence: event.confidence, checker: event.checker, revised: event.revised }));
              maybeScroll();
            }
            break;
          }
          case 'approval_required': {
            setActing(null);
            
            if (event.tool === 'plan' && planCardEl?._setApprovalId) {
              planCardEl._setApprovalId(event.approvalId);
              maybeScroll();
              break;
            }
            const card = approvalCard({
              approvalId: event.approvalId,
              tool: event.tool,
              displayName: event.displayName,
              summary: event.summary,
              payload: event.payload,
            });
            activityZone.append(card);
            maybeScroll();
            break;
          }
          case 'delta': {
            setActing(null);
            stopThinking();
            sawOutput = true;
            streamMsg.content += event.text;
            
            
            if (!pendingRender) {
              pendingRender = requestAnimationFrame(() => {
                pendingRender = 0;
                if (disposed || done) return;
                const body = el._bodyEl;
                const md = body.querySelector('.markdown');
                if (md) md.replaceWith(markdownEl(streamMsg.content));
                else body.prepend(markdownEl(streamMsg.content));
                const cursor = body.querySelector('.cursor-blink');
                if (cursor) body.append(cursor);
                maybeScroll();
              });
            }
            break;
          }
          case 'reasoning': {
            ensureThinking();
            streamMsg.reasoning = (streamMsg.reasoning || '') + event.text;
            if (thinking?._body) {
              thinking._body.textContent = streamMsg.reasoning;
              if (thinking._open) thinking._body.parentElement.scrollTop = thinking._body.parentElement.scrollHeight;
            }
            const rb = el._reasoningBody;
            if (rb) rb.textContent = streamMsg.reasoning;
            maybeScroll();
            break;
          }
          case 'done':
            finish(event);
            break;
          case 'error':
            toast(event.message, 'error');
            streamMsg.status = 'error';
            streamMsg.error = event.message;
            finish({ status: 'error' });
            break;
          case 'aborted':
            finish({ status: 'aborted' });
            break;
          case 'stream_error':
            toast(event.message, 'error');
            finish({ status: 'error' });
            break;
        }
      },
      {}
    );

    
    
  }

  async function refreshMessages(statusHint) {
    if (disposed || !state.conversation) return;
    try {
      const res = await api.get(`/conversations/${state.conversation.id}`);
      if (disposed) return;
      state.conversation = res.conversation;
      state.messages = res.messages;
      store.update({ currentModelId: res.conversation.modelId || null });
      rebuild();
      composer?.refreshModelChip();
      const { loadConversations } = await import('../app.js');
      await loadConversations();
      scrollToBottom(true);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleStop() {
    abortStream?.();
  }

  
  function maybeScroll() {
    if (stickToBottom) scrollToBottom();
  }
  function scrollToBottom(instant = false) {
    stickToBottom = true;
    scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
  }
  function updateScrollBtn() {
    const nearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 120;
    stickToBottom = nearBottom;
    scrollBtn.classList.toggle('hidden', nearBottom);
  }

  const onEscape = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.scrim, .menu, .palette-scrim, .file-preview')) handleStop();
  };
  window.addEventListener('zeno:stop-stream', handleStop);
  document.addEventListener('keydown', onEscape);

  return {
    destroy() {
      disposed = true;
      abortStream?.();
      composer?.destroy();
      cancelAnimationFrame(frame);
      scrollEl.removeEventListener('scroll', updateScrollBtn);
      window.removeEventListener('zeno:stop-stream', handleStop);
      document.removeEventListener('keydown', onEscape);
      store.update({ streaming: false, attachments: [] });
    },
  };
}
