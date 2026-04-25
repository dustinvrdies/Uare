import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const removed = [];
const removeAllExceptGitkeep = ['data', 'logs', 'artifacts', 'backups', 'object_storage_mirror', 'object_storage_mirror_test'];
for (const rel of removeAllExceptGitkeep) {
  const target = path.join(root, rel);
  if (fs.existsSync(target)) {
    for (const entry of fs.readdirSync(target)) {
      if (entry === '.gitkeep') continue;
      fs.rmSync(path.join(target, entry), { recursive: true, force: true });
      removed.push(path.join(rel, entry));
    }
  }
}

for (const entry of fs.readdirSync(root)) {
  const full = path.join(root, entry);
  if (!fs.statSync(full).isFile()) continue;
  if (/\.log$/i.test(entry) || /_out\.txt$/i.test(entry) || /_output\.txt$/i.test(entry) || /_results\.txt$/i.test(entry) || /^regression_.*\.txt$/i.test(entry) || /^test_.*\.txt$/i.test(entry)) {
    fs.rmSync(full, { force: true });
    removed.push(entry);
  }
}

const summary = {
  cleaned: removed,
  preparedAt: new Date().toISOString(),
  notes: [
    'Runtime data cleaned',
    'Generated artifacts/logs cleaned',
    'Dependencies are not bundled in release zip',
    'Use npm ci after unpacking',
  ],
};

fs.writeFileSync(path.join(root, 'RELEASE_PREP_SUMMARY.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
