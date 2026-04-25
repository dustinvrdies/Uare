function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function positiveNumberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function compareGeometryFromManifest(manifest = {}) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const hasKernelStep = artifacts.some((item) => item.type === 'step');
  const hasKernelStl = artifacts.some((item) => item.type === 'stl_kernel');
  const hasEnvelope = artifacts.some((item) => item.type === 'stl_envelope');

  const params = manifest?.recipe?.parameters || manifest?.parameters || {};
  const executionSummary = manifest?.execution_summary || {};
  const length = positiveNumberOr(params.bracket_length_mm, 120);
  const width = positiveNumberOr(params.bracket_width_mm, 40);
  const height = positiveNumberOr(params.bracket_height_mm, 30);
  const wall = positiveNumberOr(params.wall_thickness_mm, 4);
  const hole = positiveNumberOr(params.bolt_hole_diameter_mm, 8);
  const envelopeVolume = round(length * width * height, 3);
  const nominalRemovedHoleVolume = round((Math.PI * ((hole / 2) ** 2) * Math.max(height, wall) * 3), 3);
  const summaryPartVolume = Number(executionSummary.estimated_part_volume_mm3);
  const estimatedFeatureAdjustedVolume = Number.isFinite(summaryPartVolume) && summaryPartVolume > 0
    ? round(summaryPartVolume, 3)
    : round(Math.max(0, envelopeVolume - nominalRemovedHoleVolume), 3);

  return {
    comparable: hasEnvelope && (hasKernelStep || hasKernelStl),
    fallback_present: hasEnvelope,
    kernel_present: hasKernelStep || hasKernelStl,
    estimated_envelope_volume_mm3: envelopeVolume,
    estimated_feature_adjusted_volume_mm3: estimatedFeatureAdjustedVolume,
    comparison_status: (hasEnvelope && (hasKernelStep || hasKernelStl)) ? 'ready_for_kernel_geometry_comparison' : 'insufficient_kernel_artifacts',
    comparison_inputs: {
      length_mm: length,
      width_mm: width,
      height_mm: height,
      wall_thickness_mm: wall,
      bolt_hole_diameter_mm: hole,
      used_execution_summary_part_volume: Number.isFinite(summaryPartVolume) && summaryPartVolume > 0,
    },
    notes: [
      'Estimated feature-adjusted volume subtracts nominal hole volumes from the envelope.',
      'True geometric diffing still requires parsing kernel-generated solids.'
    ]
  };
}
