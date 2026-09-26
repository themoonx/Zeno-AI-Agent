


export const memoryWriteTool = {
  name: 'memory_write',
  displayName: 'Memory Write',
  description:
    'Save a durable fact, preference, or note to persistent memory for future conversations. Only call this for information that stays useful later — transient details are rejected automatically.',
  sensitive: false,
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['fact', 'preference', 'project', 'summary', 'semantic', 'episodic'], description: 'Memory category' },
      content: { type: 'string', description: 'The memory content to store (2-4000 chars)' },
      importance: { type: 'number', description: 'Optional 0-1 importance hint; omit to let Zeno score it' },
    },
    required: ['content'],
  },
  async execute(args, { userId, memory }) {
    const content = String(args.content || '').trim();
    if (content.length < 2) throw new Error('content must be at least 2 characters');
    const kind = ['fact', 'preference', 'project', 'summary', 'semantic', 'episodic'].includes(args.kind) ? args.kind : 'fact';
    const result = await memory.remember({ userId, kind, content: content.slice(0, 4000), source: 'agent-tool', importance: args.importance });
    switch (result.action) {
      case 'stored':
        return { ok: true, id: result.id, kind, importance: result.importance, note: 'Stored in persistent memory.' };
      case 'superseded':
        return { ok: true, id: result.id, kind, note: 'Stored; it updated an outdated memory on the same topic.' };
      case 'reinforced':
        return { ok: true, id: result.id, kind, note: 'Already known — reinforced the existing memory instead of duplicating it.' };
      case 'rejected':
        return { ok: false, reason: result.reason, note: result.reason === 'low importance' ? 'Not durable enough to remember (transient detail).' : 'Empty content.' };
      default:
        return { ok: false, note: 'Memory write skipped.' };
    }
  },
};
