import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export function createCloudObjectStorageAdapter(runtime = {}) {
  const bucketRoot = path.resolve(runtime?.objectStorageMirrorDir || './object_storage_mirror');
  fs.mkdirSync(bucketRoot, { recursive: true });

  function objectKey(executionId, filename) {
    return `${executionId}/${filename}`;
  }

  function objectPath(executionId, filename) {
    return path.join(bucketRoot, executionId, filename);
  }

  function ensureExecutionDir(executionId) {
    fs.mkdirSync(path.join(bucketRoot, executionId), { recursive: true });
  }

  function publicUrl(executionId, filename, runtimeConfig = {}) {
    const base = String(runtimeConfig?.artifactBaseUrl || '').replace(/\/$/, '');
    if (!base) return `/cad/artifacts/${executionId}/${filename}`;
    return `${base}/${objectKey(executionId, filename)}`;
  }

  function signUrl(url, runtimeConfig = {}, expiresInSeconds = 3600) {
    const secret = String(runtimeConfig?.sessionSecret || 'uare-dev-secret');
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = crypto.createHash('sha256').update(`${url}|${expiresAt}|${secret}`).digest('hex');
    return `${url}${url.includes('?') ? '&' : '?'}expires=${expiresAt}&sig=${signature}`;
  }

  function verifySignedUrl(url, expires, sig, runtimeConfig = {}) {
    const secret = String(runtimeConfig?.sessionSecret || 'uare-dev-secret');
    const expected = crypto.createHash('sha256').update(`${url}|${expires}|${secret}`).digest('hex');
    return String(expected) === String(sig) && Number(expires) >= 0;
  }

  function mirrorFile(localFilePath, executionId, filename) {
    ensureExecutionDir(executionId);
    const target = objectPath(executionId, filename);
    fs.copyFileSync(localFilePath, target);
    return target;
  }

  async function uploadPlaceholder(localFilePath, executionId, filename, runtimeConfig = {}) {
    const mirrored = mirrorFile(localFilePath, executionId, filename);
    const url = publicUrl(executionId, filename, runtimeConfig);
    return {
      ok: true,
      mode: 'cloud-emulated',
      object_key: objectKey(executionId, filename),
      local_mirror_path: mirrored,
      public_url: url,
      signed_url: signUrl(url, runtimeConfig),
    };
  }

  return {
    mode: 'cloud-object-storage-emulated',
    publicUrl,
    signUrl,
    verifySignedUrl,
    mirrorFile,
    uploadPlaceholder,
    rootDir: bucketRoot,
  };
}
