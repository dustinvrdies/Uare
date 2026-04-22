import fs from 'fs';
import path from 'path';

export function createObjectStorageAdapter(runtime = {}) {
  const mirrorRoot = path.resolve(runtime?.objectStorageMirrorDir || './object_storage_mirror');
  fs.mkdirSync(mirrorRoot, { recursive: true });

  function executionDir(executionId) {
    return path.join(mirrorRoot, executionId);
  }

  function publicUrl(executionId, filename, runtimeConfig = {}) {
    const base = String(runtimeConfig?.artifactBaseUrl || '').replace(/\/$/, '');
    if (!base) return `/cad/artifacts/${executionId}/${filename}`;
    return `${base}/${executionId}/${filename}`;
  }

  function mirrorFile(localFilePath, executionId, filename) {
    const dir = executionDir(executionId);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, filename);
    fs.copyFileSync(localFilePath, target);
    return target;
  }

  return {
    mode: 'object-storage-mirror',
    publicUrl,
    mirrorFile,
    rootDir: mirrorRoot,
  };
}
