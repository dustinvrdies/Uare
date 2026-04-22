import { createStorageAdapter } from './storageAdapter.mjs';
import { createObjectStorageAdapter } from './objectStorageAdapter.mjs';
import { createCloudObjectStorageAdapter } from './cloudObjectStorageAdapter.mjs';
import { createS3StorageAdapter } from './providers/s3Adapter.mjs';
import { createR2StorageAdapter } from './providers/r2Adapter.mjs';
import { createGcsStorageAdapter } from './providers/gcsAdapter.mjs';

export function createCadStorageProvider(runtime = {}) {
  const mode = runtime.artifactStorageMode || 'local';
  if (mode === 'mirror') return createObjectStorageAdapter(runtime);
  if (mode === 'object') return createCloudObjectStorageAdapter(runtime);
  if (mode === 's3') return createS3StorageAdapter(runtime);
  if (mode === 'r2') return createR2StorageAdapter(runtime);
  if (mode === 'gcs') return createGcsStorageAdapter(runtime);
  return createStorageAdapter(runtime.artifactRootDir || './artifacts');
}
