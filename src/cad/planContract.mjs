function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/\b(about|around|approx|approximately|~|ish)\b/i.test(trimmed)) return null;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function normalizeMode(modeValue) {
  const mode = String(modeValue || '').trim().toLowerCase();
  if (['engineering', 'precision', 'strict'].includes(mode)) return 'engineering';
  return 'concept';
}

function normalizeUnits(unitValue) {
  const unit = String(unitValue || '').trim().toLowerCase();
  if (!unit) return 'mm';
  return unit;
}

function extractDims(part = {}) {
  if (isPlainObject(part?.dims)) return part.dims;
  if (isPlainObject(part?.dimensions_mm)) return part.dimensions_mm;
  return {};
}

function validatePartInEngineeringMode(part = {}, index = 0) {
  const errors = [];
  const dims = extractDims(part);
  const partId = part?.id || `part_${index + 1}`;
  const x = parseFiniteNumber(dims.x ?? dims.w ?? dims.width ?? dims.diameter ?? dims.outer_diameter);
  const y = parseFiniteNumber(dims.y ?? dims.d ?? dims.depth ?? dims.width ?? dims.diameter ?? dims.outer_diameter);
  const z = parseFiniteNumber(dims.z ?? dims.h ?? dims.height ?? dims.length ?? dims.thickness);

  if (!part?.id || typeof part.id !== 'string') {
    errors.push({ code: 'part_id_required', message: `Part at index ${index} must include a stable string id.` });
  }

  if (!Number.isFinite(x) || x <= 0 || !Number.isFinite(y) || y <= 0 || !Number.isFinite(z) || z <= 0) {
    errors.push({ code: 'part_dims_invalid', part_id: partId, message: `Part ${partId} must define positive numeric dimensions.` });
  }

  const tolRaw = part?.metadata?.tolerance ?? part?.tolerance_mm ?? part?.tolerance;
  const tol = parseFiniteNumber(tolRaw);
  if (!Number.isFinite(tol) || tol <= 0 || tol > 1) {
    errors.push({
      code: 'part_tolerance_invalid',
      part_id: partId,
      message: `Part ${partId} must include a numeric tolerance in mm (0 < tol <= 1).`,
    });
  }

  return errors;
}

function validateInterfacesInEngineeringMode(plan = {}) {
  const errors = [];
  const interfaces = Array.isArray(plan?.interfaces)
    ? plan.interfaces
    : Array.isArray(plan?.mates)
      ? plan.mates
      : [];

  for (let i = 0; i < interfaces.length; i += 1) {
    const iface = interfaces[i] || {};
    const target = parseFiniteNumber(iface?.target_clearance_mm);
    if (!Number.isFinite(target)) {
      errors.push({
        code: 'interface_clearance_required',
        interface_index: i,
        message: `Interface at index ${i} must define numeric target_clearance_mm in engineering mode.`,
      });
    }
  }

  return errors;
}

export function normalizePlanContract(plan = {}) {
  const input = isPlainObject(plan) ? plan : {};
  const executionMode = normalizeMode(
    input.execution_mode
    ?? input.mode
    ?? input.precision_mode
    ?? input.engineering_mode,
  );

  const units = normalizeUnits(input.units ?? input.unit);
  const normalizedPlan = {
    ...input,
    execution_mode: executionMode,
    units,
    unit: units,
  };

  return { execution_mode: executionMode, normalizedPlan };
}

export function validatePlanContract(plan = {}) {
  const { execution_mode, normalizedPlan } = normalizePlanContract(plan);
  const errors = [];
  const warnings = [];

  if (execution_mode === 'engineering') {
    if (!Array.isArray(normalizedPlan.parts) || normalizedPlan.parts.length === 0) {
      errors.push({ code: 'parts_required', message: 'Engineering mode requires a non-empty parts array.' });
    }

    const unit = normalizeUnits(normalizedPlan.units ?? normalizedPlan.unit);
    if (unit !== 'mm') {
      errors.push({ code: 'units_must_be_mm', message: 'Engineering mode requires explicit millimeter units (units="mm").' });
    }

    const parts = Array.isArray(normalizedPlan.parts) ? normalizedPlan.parts : [];
    for (let i = 0; i < parts.length; i += 1) {
      errors.push(...validatePartInEngineeringMode(parts[i], i));
    }

    errors.push(...validateInterfacesInEngineeringMode(normalizedPlan));
  } else {
    warnings.push({
      code: 'concept_mode_active',
      message: 'Concept mode allows loose inputs. Use execution_mode="engineering" for deterministic constraints.',
    });
  }

  return {
    ok: errors.length === 0,
    execution_mode,
    normalizedPlan,
    errors,
    warnings,
  };
}
