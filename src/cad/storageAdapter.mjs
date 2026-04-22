import fs from 'fs';
import path from 'path';

export function createStorageAdapter(rootDir) {
  const absoluteRoot = path.resolve(rootDir || './artifacts');
  fs.mkdirSync(absoluteRoot, { recursive: true });

  function localUrl(executionId, filename) {
    return `/cad/artifacts/${executionId}/${filename}`;
  }

  function publicUrl(executionId, filename, runtime = {}) {
    if (runtime?.artifactBaseUrl) {
      return `${String(runtime.artifactBaseUrl).replace(/\/$/, '')}/${executionId}/${filename}`;
    }
    return localUrl(executionId, filename);
  }

  return {
    publicUrl,
    mode: 'local-disk',
    rootDir: absoluteRoot,
  };
}
