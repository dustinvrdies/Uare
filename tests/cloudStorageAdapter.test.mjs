import { createCloudObjectStorageAdapter } from '../src/cad/cloudObjectStorageAdapter.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const adapter = createCloudObjectStorageAdapter({
  objectStorageMirrorDir: './object_storage_mirror_test',
  artifactBaseUrl: 'https://cdn.example.com/cad',
  sessionSecret: 'test-secret',
});

const url = adapter.publicUrl('exec-1', 'file.stl', { artifactBaseUrl: 'https://cdn.example.com/cad' });
const signed = adapter.signUrl(url, { sessionSecret: 'test-secret' });
assert(url.includes('exec-1/file.stl'), 'public URL should contain object key');
assert(signed.includes('expires='), 'signed URL should include expires');
console.log('cloudStorageAdapter.test.mjs passed');
