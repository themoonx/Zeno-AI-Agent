import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../backend/harness/index.js';




test('per-turn capability catalog includes enabled user connector tools', async () => {
  const plugin = { name: 'connector_echo', description: 'Echo', sensitive: true, parameters: { type: 'object' }, execute: async () => ({ echoed: true }) };
  let catalogUser = null;
  const harness = createHarness({
    repos: { users: { getSetting: () => null } },
    connectors: { catalog: async (userId) => { catalogUser = userId; return new Map([[plugin.name, plugin]]); } },
    audit: () => {},
  });
  const { catalog, origin } = await harness.toolCatalog('owner');
  assert.equal(catalogUser, 'owner');
  assert.ok(catalog.has(plugin.name), 'connector tool present in catalog');
  assert.equal(origin.get(plugin.name)?.kind, 'connector');
});
