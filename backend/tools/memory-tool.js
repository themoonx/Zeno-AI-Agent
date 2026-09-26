

export const memorySearchTool = {
  name: 'memory_search',
  displayName: 'Memory Search',
  description: 'Search your persistent memory for facts, preferences, and past context relevant to a query.',
  sensitive: false,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look up in memory' },
    },
    required: ['query'],
  },
  async execute(args, { userId, memory }) {
    const query = String(args.query || '').trim();
    if (!query) throw new Error('query is required');
    const results = await memory.semanticSearch(userId, query, { limit: 8, reinforce: true });
    if (!results.length) return { ok: true, results: [], note: 'No relevant memories found.' };
    return {
      ok: true,
      results: results.map((r) => ({
        content: r.content,
        kind: r.kind,
        relevance: Number(r.score.toFixed(3)),
        importance: r.importance != null ? Number(Number(r.importance).toFixed(2)) : undefined,
      })),
    };
  },
};
