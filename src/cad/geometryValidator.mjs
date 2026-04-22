export function validateExecutionArtifacts(manifest = {}) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const types = new Set(artifacts.map((item) => item.type));
  const required = ['plan', 'recipe', 'cadquery_script', 'svg_preview', 'stl_envelope'];
  const missing = required.filter((item) => !types.has(item));

  return {
    valid: missing.length === 0,
    missing,
    kernel_present: types.has('step') || types.has('stl_kernel'),
    artifact_count: artifacts.length,
  };
}
