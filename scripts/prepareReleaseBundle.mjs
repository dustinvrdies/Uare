import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const removed = [];
for (const rel of ['data', 'logs']) {
  const target = path.join(root, rel);
  if (fs.existsSync(target)) {
    for (const entry of fs.readdirSync(target)) {
      if (entry === '.gitkeep') continue;
      fs.rmSync(path.join(target, entry), { recursive: true, force: true });
      removed.push(path.join(rel, entry));
    }
  }
}

const summary = {
  cleaned: removed,
  preparedAt: new Date().toISOString(),
  notes: [
    'Runtime data cleaned',
    'Dependencies are not bundled in release zip',
    'Use npm ci after unpacking',
  ],
};

fs.writeFileSync(path.join(root, 'RELEASE_PREP_SUMMARY.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
