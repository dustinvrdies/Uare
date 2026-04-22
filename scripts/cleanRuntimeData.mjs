import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.env.DATA_ROOT_DIR || path.join(process.cwd(), 'data');
const patterns = [
  /^product-store-\d+\.json$/,
  /^projects-\d+\.json$/,
  /^missions-\d+\.json$/,
  /^\.team_store_\d+\.json$/,
  /^\.project_store_\d+\.json$/,
  /^\.mission_store_\d+\.json$/,
];

await fs.mkdir(root, { recursive: true });
const entries = await fs.readdir(root).catch(() => []);
let removed = 0;
for (const name of entries) {
  if (patterns.some((pattern) => pattern.test(name))) {
    await fs.rm(path.join(root, name), { force: true });
    removed += 1;
  }
}
console.log(JSON.stringify({ ok: true, root, removed }, null, 2));
