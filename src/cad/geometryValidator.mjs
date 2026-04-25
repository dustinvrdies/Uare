export function validateExecutionArtifacts(manifest = {}) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const types = new Set(artifacts.map((item) => item.type));
  const required = ['plan', 'recipe', 'cadquery_script', 'svg_preview', 'stl_envelope'];
  const missing = required.filter((item) => !types.has(item));
  const missingUrlArtifacts = artifacts
    .filter((item) => !item?.url)
    .map((item) => ({ type: item?.type || 'unknown', filename: item?.filename || '' }));

  return {
    valid: missing.length === 0,
    missing,
    kernel_present: types.has('step') || types.has('stl_kernel'),
    artifact_count: artifacts.length,
    artifact_url_coverage_ratio: artifacts.length ? Number(((artifacts.length - missingUrlArtifacts.length) / artifacts.length).toFixed(4)) : 1,
    missing_url_artifacts: missingUrlArtifacts,
  };
}
