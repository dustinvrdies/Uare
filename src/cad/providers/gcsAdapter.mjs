export function createGcsStorageAdapter(runtime = {}) {
  function requireBase() {
    if (!runtime.artifactBaseUrl) {
      throw new Error('ARTIFACT_BASE_URL is required for GCS-style URL generation');
    }
  }

  function publicUrl(executionId, filename, runtimeConfig = {}) {
    const base = String(runtimeConfig?.artifactBaseUrl || runtime.artifactBaseUrl || '').replace(/\/$/, '');
    requireBase();
    return `${base}/${executionId}/${filename}`;
  }

  function signUrl(url, runtimeConfig = {}, expiresInSeconds = 3600) {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `${url}${url.includes('?') ? '&' : '?'}provider=gcs&expires=${expiresAt}`;
  }

  async function uploadPlaceholder(localFilePath, executionId, filename, runtimeConfig = {}) {
    return {
      ok: true,
      provider: 'gcs',
      mode: 'provider-ready',
      local_file_path: localFilePath,
      object_key: `${executionId}/${filename}`,
      public_url: publicUrl(executionId, filename, runtimeConfig),
      signed_url: signUrl(publicUrl(executionId, filename, runtimeConfig), runtimeConfig),
      note: 'Replace uploadPlaceholder with real GCS SDK upload in deployed environment.'
    };
  }

  return { mode: 'gcs-ready', publicUrl, signUrl, uploadPlaceholder };
}
