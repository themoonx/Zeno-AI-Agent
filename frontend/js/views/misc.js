
import { h, toast, confirmDialog, openModal, timeAgo, fmtBytes, fmtTokens } from '../ui.js';
import { icon } from '../icons.js';
import { store } from '../state.js';
import { api } from '../api.js';

const PROJECT_COLORS = ['#8B5CF6', '#6AA8EF', '#A78BFA', '#E8B45A', '#E5646E', '#8B93A3'];


export function mountProjectsView(root) {
  const view = h('div', { class: 'view' }, h('div', { class: 'view-inner' }));
  root.append(view);
  const inner = view.querySelector('.view-inner');

  async function render() {
    inner.innerHTML = '';
    inner.append(
      h(
        'div',
        { class: 'view-head row', style: 'justify-content:space-between;align-items:flex-start' },
        h('div', {}, h('h1', { text: 'Projects' }), h('p', { text: 'Group conversations, agents, files, and memory around a mission. Project system prompts apply to every chat inside.' })),
        h('button', { class: 'btn primary', html: `${icon('plus')}<span>New project</span>`, onclick: () => projectModal() })
      )
    );

    const projects = store.state.projects;
    if (!projects.length) {
      inner.append(
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'empty-icon', html: icon('folder') }),
          h('h3', { text: 'No projects yet' }),
          h('p', { text: 'Projects keep related work together — a client, a product, a research topic.' })
        )
      );
      return;
    }
    const grid = h('div', { class: 'card-grid' });
    for (const p of projects) {
      grid.append(
        h(
          'div',
          { class: 'card hoverable project-card', onclick: () => projectModal(p) },
          h('div', { class: 'pj-color', style: `background:${p.color || '#8B5CF6'}` }),
          h('div', { class: 'row', style: 'justify-content:space-between' },
            h('div', { class: 'pj-name', text: p.name }),
            h('div', { class: 'row', style: 'gap:2px', onclick: (e) => e.stopPropagation() },
              h('button', {
                class: 'icon-btn danger', html: icon('trash'), title: 'Delete project',
                onclick: async () => {
                  if (!(await confirmDialog({ title: 'Delete project?', message: `"${p.name}" will be removed. Conversations and agents are kept.`, confirmLabel: 'Delete', danger: true }))) return;
                  await api.del(`/projects/${p.id}`);
                  await reload();
                },
              })
            )
          ),
          h('div', { class: 'pj-desc', text: p.description || 'No description.' }),
          h('div', { class: 'faint', style: 'font-size:var(--fs-xs)', text: `Updated ${timeAgo(p.updatedAt)}` })
        )
      );
    }
    inner.append(grid);
  }

  function projectModal(existing = null) {
    const nameInput = h('input', { class: 'input', value: existing?.name || '', placeholder: 'Project name' });
    const descInput = h('textarea', { class: 'textarea', rows: '2', value: existing?.description || '', placeholder: 'What is this project about?' });
    const promptInput = h('textarea', { class: 'textarea', rows: '4', value: existing?.systemPrompt || '', placeholder: 'System prompt applied to all conversations in this project…' });
    let color = existing?.color || PROJECT_COLORS[0];
    const dots = h(
      'div',
      { class: 'color-dots' },
      PROJECT_COLORS.map((c) =>
        h('div', {
          class: `color-dot${c === color ? ' selected' : ''}`,
          style: `background:${c}`,
          onclick: (e) => {
            color = c;
            dots.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('selected'));
            e.currentTarget.classList.add('selected');
          },
        })
      )
    );
    const modal = openModal({
      title: existing ? `Edit ${existing.name}` : 'New project',
      body: [
        h('div', { class: 'field' }, h('label', { text: 'Name' }), nameInput),
        h('div', { class: 'field' }, h('label', { text: 'Description' }), descInput),
        h('div', { class: 'field' }, h('label', { text: 'System prompt' }), promptInput),
        h('div', { class: 'field' }, h('label', { text: 'Color' }), dots),
      ],
      footer: [
        h('button', { class: 'btn ghost', text: 'Cancel', onclick: () => modal.close() }),
        h('button', {
          class: 'btn primary', text: existing ? 'Save' : 'Create',
          onclick: async () => {
            const body = { name: nameInput.value.trim(), description: descInput.value.trim(), systemPrompt: promptInput.value.trim(), color };
            try {
              if (existing) await api.patch(`/projects/${existing.id}`, body);
              else await api.post('/projects', body);
              await reload();
              modal.close();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        }),
      ],
    });
  }

  async function reload() {
    const { loadProjects } = await import('../app.js');
    await loadProjects();
    render();
  }
  render();
  const onNew = () => projectModal();
  window.addEventListener('zeno:new-project', onNew);
  return { destroy() { window.removeEventListener('zeno:new-project', onNew); } };
}


export function mountMemoryView(root) {
  const view = h('div', { class: 'view' }, h('div', { class: 'view-inner narrow' }));
  root.append(view);
  const inner = view.querySelector('.view-inner');

  async function render() {
    inner.innerHTML = '';
    let memories = [];
    let embeddingConfigured = false;
    let stats = null;
    try {
      const res = await api.get('/memory');
      memories = res.memories;
      embeddingConfigured = res.embeddingConfigured;
      stats = res.stats || null;
    } catch (err) {
      toast(err.message, 'error');
    }

    inner.append(
      h(
        'div',
        { class: 'view-head row', style: 'justify-content:space-between;align-items:flex-start' },
        h('div', {},
          h('h1', { text: 'Memory' }),
          h('p', { text: 'What Zeno remembers across conversations — facts, preferences, project context. Every write is deduplicated and importance-scored; consolidation merges and prunes automatically.' })
        ),
        h('div', { class: 'row' },
          h('button', {
            class: 'btn',
            html: `${icon('history')}<span>Consolidate</span>`,
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              try {
                const res = await api.post('/memory/consolidate', {});
                toast(`Consolidated: ${res.merged} merged, ${res.pruned} pruned, ${res.strengthened} strengthened`, 'success');
                render();
              } catch (err) {
                toast(err.message, 'error');
              } finally {
                btn.disabled = false;
              }
            },
          }),
          h('button', { class: 'btn primary', html: `${icon('plus')}<span>Add memory</span>`, onclick: addModal })
        )
      )
    );

    inner.append(
      h('div', { class: 'row', style: 'gap:8px;margin-bottom:16px;flex-wrap:wrap' },
        h('span', { class: `badge ${embeddingConfigured ? 'accent' : ''}`, text: embeddingConfigured ? 'semantic search on (embeddings)' : 'keyword search (no embedding model configured)' }),
        stats && stats.total ? h('span', { class: 'badge', text: `${stats.total} active · avg importance ${stats.avgImportance.toFixed(2)}` }) : null,
        h('a', { href: '#/settings', class: 'hint', style: 'font-size:var(--fs-xs);color:var(--text-3)', text: embeddingConfigured ? '' : 'Configure an embeddings model in Settings →' })
      )
    );

    const searchInput = h('input', { class: 'input', placeholder: 'Search memory… (semantic when enabled)' });
    const listBox = h('div', { class: 'memory-list' });

    async function renderList(query = null) {
      listBox.innerHTML = '';
      let items = memories;
      let scores = null;
      if (query) {
        try {
          const res = await api.post('/memory/search', { query });
          scores = new Map(res.results.map((r) => [r.id, r.score]));
          items = memories.filter((m) => scores.has(m.id)).map((m) => m);
        } catch {
          items = memories;
        }
      }
      if (!items.length) {
        listBox.append(h('p', { class: 'faint', style: 'padding:14px 2px', text: query ? 'No matching memories.' : 'Memory is empty. Zeno will learn as you chat, or add facts manually.' }));
        return;
      }
      for (const m of items) {
        const score = scores?.get(m.id);
        listBox.append(
          h(
            'div',
            { class: 'memory-item' },
            h(
              'div',
              { style: 'flex:1;min-width:0' },
              h('div', { class: 'mem-content', text: m.content }),
              h(
                'div',
                { class: 'mem-meta' },
                h('span', { class: `badge ${kindClass(m.kind)}`, text: m.kind }),
                (m.importance ?? null) != null ? h('span', { class: 'faint', style: 'font-size:var(--fs-xs)', title: 'Importance — set at write time, strengthened by use', text: `importance ${Number(m.importance).toFixed(2)}` }) : null,
                (m.accessCount || 0) > 0 ? h('span', { class: 'faint', style: 'font-size:var(--fs-xs)', title: 'Times recalled', text: `recalled ×${m.accessCount}` }) : null,
                h('span', { class: 'faint', style: 'font-size:var(--fs-xs)', text: m.source === 'auto-extract' ? 'auto' : m.source || timeAgo(m.createdAt) }),
                score != null ? h('span', { class: 'faint', style: 'font-size:var(--fs-xs)', text: `score ${score.toFixed(2)}` }) : null
              ),
              score != null ? h('div', { class: 'score-bar' }, h('i', { style: `width:${Math.round(score * 100)}%` })) : null
            ),
            h('button', {
              class: 'icon-btn danger', html: icon('trash'), title: 'Forget',
              onclick: async () => {
                if (!(await confirmDialog({ title: 'Forget this memory?', message: 'Zeno will no longer recall it. Consolidation history keeps the audit trail.', confirmLabel: 'Forget', danger: true }))) return;
                try {
                  await api.del(`/memory/${m.id}`);
                  memories = memories.filter((x) => x.id !== m.id);
                  renderList(searchInput.value.trim() || null);
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            })
          )
        );
      }
    }

    searchInput.addEventListener('input', debounce(() => renderList(searchInput.value.trim() || null), 350));

    inner.append(h('div', { class: 'field', style: 'margin-bottom:16px' }, searchInput), listBox);
    renderList();

    function addModal() {
      const contentInput = h('textarea', { class: 'textarea', rows: '3', placeholder: 'e.g. Prefers TypeScript; deploying on Fly.io; allergic to shell scripts…' });
      const kindSelect = h('select', { class: 'select' }, ['fact', 'preference', 'project'].map((k) => h('option', { value: k, text: k })));
      const modal = openModal({
        title: 'Add memory',
        body: [
          h('div', { class: 'field' }, h('label', { text: 'Kind' }), kindSelect),
          h('div', { class: 'field' }, h('label', { text: 'Content' }), contentInput),
        ],
        footer: [
          h('button', { class: 'btn ghost', text: 'Cancel', onclick: () => modal.close() }),
          h('button', {
            class: 'btn primary', text: 'Remember',
            onclick: async () => {
              try {
                await api.post('/memory', { kind: kindSelect.value, content: contentInput.value.trim(), source: 'manual' });
                modal.close();
                render();
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          }),
        ],
      });
    }
  }

  function kindClass(kind) {
    return { fact: '', preference: 'violet', project: 'blue', agent: 'amber', summary: '', semantic: '', episodic: 'amber' }[kind] || '';
  }

  render();
  return { destroy() {} };
}


export function mountFilesView(root) {
  const view = h('div', { class: 'view' }, h('div', { class: 'view-inner' }));
  root.append(view);
  const inner = view.querySelector('.view-inner');
  const fileInput = h('input', { type: 'file', multiple: true, style: 'display:none', onchange: upload });

  async function render() {
    inner.innerHTML = '';
    let files = [];
    try {
      const res = await api.get('/files');
      files = res.files;
    } catch (err) {
      toast(err.message, 'error');
    }
    inner.append(
      h(
        'div',
        { class: 'view-head row', style: 'justify-content:space-between;align-items:flex-start' },
        h('div', {}, h('h1', { text: 'Files' }), h('p', { text: 'Uploaded files used in chats. Images are sent to vision models; text and PDF contents are extracted for context.' })),
        h('div', { class: 'row' }, fileInput, h('button', { class: 'btn primary', html: `${icon('plus')}<span>Upload</span>`, onclick: () => fileInput.click() }))
      )
    );

    if (!files.length) {
      inner.append(h('div', { class: 'empty' }, h('div', { class: 'empty-icon', html: icon('file') }), h('h3', { text: 'No files yet' }), h('p', { text: 'Attach files in the composer or upload here. Files are referenced in conversations by id, never re-uploaded.' })));
      return;
    }
    const grid = h('div', { class: 'file-grid' });
    for (const f of files) {
      grid.append(
        h(
          'div',
          { class: 'file-card' },
          h('div', { class: `fc-icon ${f.kind}`, html: icon(f.kind === 'image' ? 'image' : 'ftText') }),
          h(
            'div',
            { class: 'fc-main' },
            h('div', { class: 'fc-name', title: f.filename, text: f.filename }),
            h('div', { class: 'fc-sub', text: `${fmtBytes(f.size)} · ${f.kind}${f.hasExtractedText ? ' · text extracted' : ''} · ${timeAgo(f.createdAt)}` })
          ),
          h('div', { class: 'row', style: 'gap:2px' },
            h('button', { class: 'icon-btn', html: icon('external'), title: 'Open', onclick: () => window.open(api.fileUrl(f.id), '_blank') }),
            h('button', {
              class: 'icon-btn danger', html: icon('trash'), title: 'Delete',
              onclick: async () => {
                if (!(await confirmDialog({ title: 'Delete file?', message: f.filename, confirmLabel: 'Delete', danger: true }))) return;
                await api.del(`/files/${f.id}`);
                render();
              },
            })
          )
        )
      );
    }
    inner.append(grid);
  }

  async function upload() {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (!files.length) return;
    toast('Uploading…', 'info', { timeout: 1200 });
    try {
      await api.upload('/files', files);
      await render();
      toast('Uploaded', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  render();
  return { destroy() {} };
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
