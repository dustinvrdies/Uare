function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function compareGeometryFromManifest(manifest = {}) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const hasKernelStep = artifacts.some((item) => item.type === 'step');
  const hasKernelStl = artifacts.some((item) => item.type === 'stl_kernel');
  const hasEnvelope = artifacts.some((item) => item.type === 'stl_envelope');

  const params = manifest?.recipe?.parameters || manifest?.parameters || {};
  const length = Number(params.bracket_length_mm || 120);
  const width = Number(params.bracket_width_mm || 40);
  const height = Number(params.bracket_height_mm || 30);
  const wall = Number(params.wall_thickness_mm || 4);
  const hole = Number(params.bolt_hole_diameter_mm || 8);
  const envelopeVolume = round(length * width * height, 3);
  const nominalRemovedHoleVolume = round((Math.PI * ((hole / 2) ** 2) * Math.max(height, wall) * 3), 3);
  const estimatedFeatureAdjustedVolume = round(Math.max(0, envelopeVolume - nominalRemovedHoleVolume), 3);

  return {
    comparable: hasEnvelope && (hasKernelStep || hasKernelStl),
    fallback_present: hasEnvelope,
    kernel_present: hasKernelStep || hasKernelStl,
    estimated_envelope_volume_mm3: envelopeVolume,
    estimated_feature_adjusted_volume_mm3: estimatedFeatureAdjustedVolume,
    comparison_status: (hasEnvelope && (hasKernelStep || hasKernelStl)) ? 'ready_for_kernel_geometry_comparison' : 'insufficient_kernel_artifacts',
    notes: [
      'Estimated feature-adjusted volume subtracts nominal hole volumes from the envelope.',
      'True geometric diffing still requires parsing kernel-generated solids.'
    ]
  };
}
