



export function createSkillLoadTool({ harness }) {
  return {
    name: 'skill_load',
    displayName: 'Load Skill',
    description: 'Load the full instructions for a skill by slug. Use when a listed skill matches the current work.',
    sensitive: false,
    permissionClass: 'skill.read',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The skill slug from the roster' },
      },
      required: ['slug'],
    },
    async execute(args, { userId }) {
      const slug = String(args.slug || '').trim();
      if (!slug) throw new Error('slug is required');
      const skills = harness.skillCatalog(userId).filter((s) => s.enabled);
      const skill = skills.find((s) => s.slug === slug);
      if (!skill) {
        return { ok: false, error: `Unknown or disabled skill: ${slug}`, available: skills.map((s) => s.slug).slice(0, 24) };
      }
      return { ok: true, slug: skill.slug, name: skill.name, instructions: skill.instructions?.slice(0, 24_000) || '' };
    },
  };
}
