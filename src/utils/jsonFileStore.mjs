import fs from 'fs';
import path from 'path';

function clone(v) { return JSON.parse(JSON.stringify(v)); }

export function createJsonFileStore(filePath, defaults = {}) {
  const resolved = path.resolve(filePath);
  let state = clone(defaults);
  let loaded = false;

  function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      if (fs.existsSync(resolved)) {
        state = { ...clone(defaults), ...JSON.parse(fs.readFileSync(resolved, 'utf8') || '{}') };
      } else {
        fs.writeFileSync(resolved, JSON.stringify(state, null, 2));
      }
    } catch {}
  }

  function save() {
    ensureLoaded();
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(state, null, 2));
  }

  return {
    read() {
      ensureLoaded();
      return clone(state);
    },
    mutate(fn) {
      ensureLoaded();
      const draft = clone(state);
      const result = fn(draft) ?? draft;
      state = result;
      save();
      return clone(state);
    },
    replace(next) {
      state = clone(next);
      save();
      return clone(state);
    },
    path: resolved,
  };
}
