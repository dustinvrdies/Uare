import { createProjectStore } from '../src/store/projectStore.mjs';

const store = createProjectStore();

async function run() {
  const saved = await store.save({ id: 'p1', owner_id: 'u1', title: 'Demo Project', workflow_status: 'draft' });
  const list = await store.listByOwner('u1');
  const got = await store.get('p1');
  await store.appendAudit({ project_id: 'p1', actor_id: 'u1', action: 'project.save', payload: { ok: true } });
  const audit = await store.listAuditByProject('p1');
  const removed = await store.remove('p1', 'u1');

  if (!saved?.id || list.length != 1 || !got || audit.length != 1 || !removed) {
    throw new Error('Custom backend smoke test failed');
  }
  console.log('custom backend smoke test passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
