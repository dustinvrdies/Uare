export function createR2StorageAdapter(runtime = {}) {
  function requireBase() {
    if (!runtime.artifactBaseUrl) {
      throw new Error('ARTIFACT_BASE_URL is required for R2-style URL generation');
    }
  }

  function publicUrl(executionId, filename, runtimeConfig = {}) {
    const base = String(runtimeConfig?.artifactBaseUrl || runtime.artifactBaseUrl || '').replace(/\/$/, '');
    requireBase();
    return `${base}/${executionId}/${filename}`;
  }

  function signUrl(url, runtimeConfig = {}, expiresInSeconds = 3600) {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `${url}${url.includes('?') ? '&' : '?'}provider=r2&expires=${expiresAt}`;
  }

  async function uploadPlaceholder(localFilePath, executionId, filename, runtimeConfig = {}) {
    return {
      ok: true,
      provider: 'r2',
      mode: 'provider-ready',
      local_file_path: localFilePath,
      object_key: `${executionId}/${filename}`,
      public_url: publicUrl(executionId, filename, runtimeConfig),
      signed_url: signUrl(publicUrl(executionId, filename, runtimeConfig), runtimeConfig),
      note: 'Replace uploadPlaceholder with real R2 SDK/API upload in deployed environment.'
    };
  }

  return { mode: 'r2-ready', publicUrl, signUrl, uploadPlaceholder };
}
