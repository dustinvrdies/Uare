import { createReplayStore } from '../src/events/replayStore.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const store = createReplayStore({ maxEntries: 100, archiveEnabled: true, archiveMaxEntries: 200, retentionDays: 1 });
await store.append({ topic: 'task:old', payload: { task_id: 'old-1' }, published_at: '2020-01-01T00:00:00.000Z' });
await store.append({ topic: 'task:new', payload: { task_id: 'new-1' }, published_at: new Date().toISOString() });

const result = await store.archive({ before: '2021-01-01T00:00:00.000Z' });
assert(result.archived_count === 1, 'expected one archived replay row');

const active = await store.list({}, 10);
const archived = await store.list({ archived_only: true }, 10);
const stats = await store.stats();

assert(active.length === 1 && active[0].topic === 'task:new', 'expected recent event to remain active');
assert(archived.length === 1 && archived[0].archived === true, 'expected archived event to be listed');
assert(stats.active_count === 1, 'expected active_count to match');
assert(stats.archive_count === 1, 'expected archive_count to match');

console.log('eventReplayRetention.test.mjs passed');
