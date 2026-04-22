"""
UARE CAD DSL — Assembly document schema validator & part normaliser.

Provides:
  - validate_assembly(doc)  → ValidationReport
  - normalise_part(part)    → dict  (fills in defaults, resolves aliases)
  - SHAPE_ALIASES           → canonical shape name mapping
  - REQUIRED_DIMS           → per-shape required dimension keys
"""
from __future__ import annotations

import math
from typing import Any

try:
    from geo_library import SHAPE_ALIASES_EXTENDED, GEO_REQUIRED_DIMS, GEO_DEFAULTS
    _HAS_GEO_LIBRARY = True
except ImportError:
    SHAPE_ALIASES_EXTENDED = {}
    GEO_REQUIRED_DIMS = {}
    GEO_DEFAULTS = {}
    _HAS_GEO_LIBRARY = False


# ─── Canonical shape aliases ──────────────────────────────────────────────────

SHAPE_ALIASES: dict[str, str] = {
    # Axes / shafts
    "axle": "shaft", "rod": "shaft", "spindle": "shaft",
    "leadscrew": "shaft",
    # Gears
    "worm_gear": "gear", "bevel_gear": "gear", "helical_gear": "gear",
    "spur_gear": "gear", "ring_gear": "gear",
    # Bearings
    "ball_bearing": "bearing", "roller_bearing": "bearing",
    "thrust_bearing": "bearing", "needle_bearing": "bearing",
    # Fasteners
    "bolt_hex": "bolt", "cap_screw": "bolt", "stud": "bolt",
    # Seals
    "lip_seal": "lip_seal", "radial_seal": "lip_seal",
    # Beams / structural
    "beam": "ibeam", "hbeam": "ibeam", "channel": "ibeam",
    # Blades
    "turbine_blade": "rotor_blade", "propeller_blade": "rotor_blade",
    "wind_blade": "rotor_blade",
    # Drives
    "harmonic_drive": "worm_drive", "cycloidal_drive": "worm_drive",
    # Misc
    "liner": "cylinder", "pin": "cylinder",
    "disc": "flange",
    "wire": "tube", "cable": "tube",
    "enclosure": "housing", "casing": "housing",
}

# ─── Per-shape dimension requirements ─────────────────────────────────────────

REQUIRED_DIMS: dict[str, list[str]] = {
    "box":         ["x", "y", "z"],
    "plate":       ["width", "depth", "thickness"],
    "cylinder":    ["diameter", "length"],
    "tube":        ["diameter", "length"],
    "shaft":       ["diameter", "length"],
    "flange":      ["outer_diameter", "thickness"],
    "gear":        ["module", "num_teeth", "face_width"],
    "bearing":     ["outerD", "innerD", "width"],
    "spring":      ["outerD", "wireD", "freeLen"],
    "nozzle":      ["exit_diameter", "height"],
    "dome":        ["radius", "wall_thickness"],
    "impeller":    ["outer_diameter", "width"],
    "ibeam":       ["H", "W", "L"],
    "bracket":     ["w", "h", "d"],
    "pcb":         ["width", "depth", "thickness"],
    "housing":     ["w", "h", "d"],
    "o_ring":      ["inner_diameter", "cross_section"],
    "bolt":        ["diameter", "length"],
    "lip_seal":    ["outerD", "innerD", "width"],
    "gasket":      ["outer_diameter", "thickness"],
    "coil_over":   ["bore", "extended_length"],
    "rotor_blade": ["length", "max_chord"],
    "coupling":    ["diameter", "length"],
    "worm_drive":  ["outer_diameter", "length"],
    "brake_rotor": ["outer_diameter", "thickness"],
    "ball_joint":  ["body_diameter"],
    "piston":      ["diameter", "height"],
    "crankshaft":  ["diameter", "length"],
    "camshaft":    ["diameter", "length"],
    "flywheel":    ["outer_diameter", "thickness"],
    "pulley":      ["outer_diameter", "thickness"],
    "connector":   ["width", "depth", "height"],
    "con_rod":     ["ctc", "bigEndD", "smallEndD"],
    "connecting_rod": ["ctc", "bigEndD", "smallEndD"],
    "cylinder_liner": ["outer_diameter", "inner_diameter", "length"],
    "cylinder_sleeve": ["outer_diameter", "inner_diameter", "length"],
    "valve":       ["head_diameter", "stem_diameter", "length"],
    "spark_plug":  ["thread_diameter", "hex_diameter", "length"],
    "fuel_injector": ["body_diameter", "length"],
    "engine_block": ["width", "height", "depth"],
    "block": ["width", "height", "depth"],
    "cylinder_head": ["width", "height", "depth"],
    "head": ["width", "height", "depth"],
    "intake_manifold": ["width", "height", "depth"],
    "exhaust_manifold": ["width", "height", "depth"],
    "turbocharger": ["compressor_diameter", "turbine_diameter", "length"],
    "oil_pump": ["outer_diameter", "thickness"],
    "water_pump": ["impeller_diameter", "body_diameter", "length"],
    "clutch_disc": ["outer_diameter", "inner_diameter", "thickness"],
    "timing_chain": ["pitch", "link_count", "width"],
    "oil_pan": ["width", "depth", "height"],
    "valve_cover": ["width", "depth", "height"],
    "throttle_body": ["bore_diameter", "length"],
    "intercooler": ["width", "height", "depth"],
    "radiator": ["width", "height", "depth"],
    "oil_filter": ["outer_diameter", "height"],
    "nut_hex": ["across_flats", "thickness", "thread_diameter"],
    "washer": ["outer_diameter", "inner_diameter", "thickness"],
    "dowel_pin": ["diameter", "length"],
}

# ─── Per-shape constraint checks ──────────────────────────────────────────────

def _constraint_bearing(dims: dict, errors: list) -> None:
    od = dims.get("outerD", dims.get("outer_diameter"))
    id_ = dims.get("innerD", dims.get("inner_diameter"))
    if od is not None and id_ is not None:
        if float(id_) >= float(od):
            errors.append(f"bearing: innerD ({id_}) must be less than outerD ({od})")

def _constraint_tube(dims: dict, errors: list) -> None:
    d = dims.get("diameter", dims.get("outerD"))
    wall = dims.get("wall", dims.get("wall_t", 1.0))
    if d is not None and wall is not None:
        if float(wall) * 2 >= float(d):
            errors.append(f"tube: wall thickness ({wall} × 2) must be less than diameter ({d})")

def _constraint_flange(dims: dict, errors: list) -> None:
    od = dims.get("outer_diameter", dims.get("diameter", dims.get("outerD")))
    id_ = dims.get("inner_diameter", dims.get("bore", dims.get("innerD")))
    if od is not None and id_ is not None and float(id_) > 0:
        if float(id_) >= float(od):
            errors.append(f"flange: bore ({id_}) must be less than outer_diameter ({od})")

def _constraint_gear(dims: dict, errors: list) -> None:
    module = dims.get("module", 2.0)
    teeth = dims.get("num_teeth", dims.get("teeth"))
    if module is not None and (float(module) <= 0):
        errors.append(f"gear: module ({module}) must be > 0")
    if teeth is not None and int(teeth) < 3:
        errors.append(f"gear: num_teeth ({teeth}) must be ≥ 3")

def _constraint_dome(dims: dict, errors: list) -> None:
    r = dims.get("radius", dims.get("diameter", 0))
    wall = dims.get("wall_thickness", dims.get("wall", 0))
    if r and wall and float(wall) >= float(r):
        errors.append(f"dome: wall_thickness ({wall}) must be less than radius ({r})")

def _constraint_spring(dims: dict, errors: list) -> None:
    od = dims.get("outerD", dims.get("outer_diameter", dims.get("diameter", 0)))
    wire = dims.get("wireD", dims.get("wire_diameter", 0))
    if od and wire and float(wire) * 2 >= float(od):
        errors.append(f"spring: wire diameter ({wire}) is too large relative to outer diameter ({od})")

def _constraint_nozzle(dims: dict, errors: list) -> None:
    exit_d = dims.get("exit_diameter", dims.get("diameter", 0))
    throat_d = dims.get("throat_diameter")
    if throat_d and exit_d and float(throat_d) >= float(exit_d):
        errors.append(f"nozzle: throat_diameter ({throat_d}) must be less than exit_diameter ({exit_d})")

_CONSTRAINTS: dict[str, Any] = {
    "bearing":  _constraint_bearing,
    "ball_bearing": _constraint_bearing,
    "tube":     _constraint_tube,
    "flange":   _constraint_flange,
    "pulley":   _constraint_flange,
    "flywheel": _constraint_flange,
    "gear":     _constraint_gear,
    "dome":     _constraint_dome,
    "spring":   _constraint_spring,
    "nozzle":   _constraint_nozzle,
}

# ─── Dimension defaults ───────────────────────────────────────────────────────

_DEFAULTS: dict[str, dict] = {
    "box":         {"x": 50, "y": 50, "z": 30},
    "plate":       {"width": 100, "depth": 80, "thickness": 5},
    "cylinder":    {"diameter": 20, "length": 60},
    "tube":        {"diameter": 20, "length": 60, "wall": 2},
    "shaft":       {"diameter": 20, "length": 120},
    "flange":      {"outer_diameter": 80, "thickness": 12, "inner_diameter": 20, "num_bolts": 4, "bolt_circle": 60},
    "gear":        {"module": 2, "num_teeth": 20, "face_width": 20},
    "bearing":     {"outerD": 52, "innerD": 25, "width": 15},
    "spring":      {"outerD": 20, "wireD": 2, "freeLen": 60, "coils": 8},
    "nozzle":      {"exit_diameter": 80, "throat_diameter": 28, "height": 120, "wall_thickness": 4},
    "dome":        {"radius": 60, "wall_thickness": 4},
    "impeller":    {"outer_diameter": 200, "hub_diameter": 60, "width": 24, "num_blades": 6},
    "ibeam":       {"H": 200, "W": 100, "L": 1000, "tw": 6, "tf": 10},
    "bracket":     {"w": 80, "h": 60, "d": 40, "thickness": 5},
    "pcb":         {"width": 100, "depth": 80, "thickness": 1.6},
    "housing":     {"w": 80, "h": 60, "d": 40, "wall": 4},
    "o_ring":      {"inner_diameter": 20, "cross_section": 3},
    "bolt":        {"diameter": 8, "length": 30},
    "lip_seal":    {"outerD": 62, "innerD": 40, "width": 8},
    "gasket":      {"outer_diameter": 100, "inner_diameter": 50, "thickness": 2},
    "coil_over":   {"bore": 50, "extended_length": 350, "spring_diameter": 90},
    "rotor_blade": {"length": 127, "max_chord": 20, "thickness": 3},
    "coupling":    {"diameter": 80, "length": 96, "bore": 28},
    "worm_drive":  {"outer_diameter": 100, "length": 45},
    "brake_rotor": {"outer_diameter": 330, "inner_diameter": 132, "thickness": 28, "num_vanes": 36},
    "ball_joint":  {"body_diameter": 30, "shank_diameter": 15, "shank_length": 45},
    "piston":      {"diameter": 86, "height": 70, "pin_diameter": 22, "ring_count": 3},
    "crankshaft":  {"diameter": 55, "length": 420, "rodD": 48, "stroke": 86, "throws": 4},
    "camshaft":    {"diameter": 26, "length": 360, "lobe_lift": 10, "lobes": 8},
    "flywheel":    {"outer_diameter": 280, "thickness": 32, "inner_diameter": 80},
    "pulley":      {"outer_diameter": 120, "thickness": 28, "inner_diameter": 20},
    "connector":   {"width": 20, "depth": 10, "height": 12, "pins": 8},
    "con_rod":     {"ctc": 155, "bigEndD": 52, "smallEndD": 24, "thickness": 22},
    "connecting_rod": {"ctc": 155, "bigEndD": 52, "smallEndD": 24, "thickness": 22},
    "cylinder_liner": {"outer_diameter": 86, "inner_diameter": 78, "length": 150},
    "cylinder_sleeve": {"outer_diameter": 86, "inner_diameter": 78, "length": 150},
    "valve":       {"head_diameter": 34, "stem_diameter": 6, "length": 105},
    "spark_plug":  {"thread_diameter": 14, "hex_diameter": 21, "length": 52},
    "fuel_injector": {"body_diameter": 16, "length": 68, "nozzle_diameter": 6, "connector_width": 14},
    "engine_block": {"width": 465, "height": 340, "depth": 220, "bore": 86, "cylinders": 4},
    "block": {"width": 465, "height": 340, "depth": 220, "bore": 86, "cylinders": 4},
    "cylinder_head": {"width": 380, "height": 78, "depth": 220, "cylinders": 4},
    "head": {"width": 380, "height": 78, "depth": 220, "cylinders": 4},
    "intake_manifold": {"width": 360, "height": 120, "depth": 140, "runners": 4},
    "exhaust_manifold": {"width": 340, "height": 110, "depth": 120, "runners": 4},
    "turbocharger": {"compressor_diameter": 96, "turbine_diameter": 88, "length": 170, "shaft_diameter": 14},
    "oil_pump": {"outer_diameter": 110, "thickness": 36, "inner_rotor_diameter": 46, "outer_rotor_diameter": 72},
    "water_pump": {"impeller_diameter": 72, "body_diameter": 90, "length": 120, "hub_diameter": 24},
    "clutch_disc": {"outer_diameter": 240, "inner_diameter": 130, "thickness": 8, "hub_diameter": 26},
    "timing_chain": {"pitch": 9.525, "link_count": 96, "width": 18, "roller_diameter": 6.2},
    "timing_belt": {"pitch": 9.525, "link_count": 96, "width": 18, "roller_diameter": 6.2},
    "oil_pan":     {"width": 420, "depth": 200, "height": 85, "wall_thickness": 4.0},
    "sump":        {"width": 420, "depth": 200, "height": 85, "wall_thickness": 4.0},
    "valve_cover": {"width": 440, "depth": 195, "height": 62, "wall_thickness": 3.5},
    "cam_cover":   {"width": 440, "depth": 195, "height": 62, "wall_thickness": 3.5},
    "throttle_body": {"bore_diameter": 70, "length": 80, "flange_thickness": 12, "wall_thickness": 6.0},
    "intercooler": {"width": 550, "height": 200, "depth": 80, "wall_thickness": 3.0},
    "charge_cooler": {"width": 550, "height": 200, "depth": 80, "wall_thickness": 3.0},
    "radiator":    {"width": 640, "height": 480, "depth": 36, "wall_thickness": 2.0},
    "oil_filter":  {"outer_diameter": 78, "height": 102, "wall_thickness": 2.5, "thread_diameter": 22},
    "nut_hex": {"across_flats": 13, "thickness": 8, "thread_diameter": 8},
    "washer": {"outer_diameter": 16, "inner_diameter": 8.4, "thickness": 1.6},
    "dowel_pin": {"diameter": 8, "length": 20},
}

if _HAS_GEO_LIBRARY:
    SHAPE_ALIASES.update(SHAPE_ALIASES_EXTENDED)
    for shape_name, req in GEO_REQUIRED_DIMS.items():
        REQUIRED_DIMS.setdefault(shape_name, req)
    for shape_name, defaults in GEO_DEFAULTS.items():
        _DEFAULTS.setdefault(shape_name, defaults)

# ─── ValidationReport ─────────────────────────────────────────────────────────

class ValidationReport:
    """Immutable result of validate_assembly()."""

    def __init__(self, valid: bool, errors: list[str], warnings: list[str], part_count: int):
        self.valid = valid
        self.errors = errors
        self.warnings = warnings
        self.part_count = part_count

    def to_dict(self) -> dict:
        return {
            "valid": self.valid,
            "part_count": self.part_count,
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "errors": self.errors,
            "warnings": self.warnings,
        }

    def __repr__(self) -> str:  # pragma: no cover
        status = "VALID" if self.valid else "INVALID"
        return f"<ValidationReport {status} parts={self.part_count} errors={len(self.errors)} warnings={len(self.warnings)}>"


# ─── Public API ───────────────────────────────────────────────────────────────

def canonical_shape(raw_shape: str, raw_kind: str = "") -> str:
    """Return the canonical shape name, resolving aliases."""
    s = str(raw_shape or "box").lower().strip()
    k = str(raw_kind or "").lower().strip()
    if s == "box" and "pcb" in k:
        return "pcb"
    return SHAPE_ALIASES.get(s, s)


def _num(v: Any, fallback: float | None = None) -> float | None:
    try:
        n = float(v)
        if math.isfinite(n):
            return n
    except (TypeError, ValueError):
        pass
    return fallback


def _canon_dims(raw_dims: dict) -> dict:
    """Merge mixed dimension vocabularies into a robust canonical map."""
    dims = dict(raw_dims or {})

    def pick(*keys, default=None):
        for key in keys:
            if key in dims and dims.get(key) is not None:
                n = _num(dims.get(key))
                if n is not None:
                    return n
        return default

    x = pick("x", "width", "w", "diameter", "outer_diameter", "outerD")
    y = pick("y", "depth", "d", "diameter", "outer_diameter", "outerD")
    z = pick("z", "height", "h", "thickness", "length", "L")

    if x is not None:
        dims.setdefault("x", x)
        dims.setdefault("w", x)
        dims.setdefault("width", x)
    if y is not None:
        dims.setdefault("y", y)
        dims.setdefault("d", y)
        dims.setdefault("depth", y)
    if z is not None:
        dims.setdefault("z", z)
        dims.setdefault("h", z)
        dims.setdefault("height", z)

    length = pick("length", "L", "z", "h", "height")
    if length is not None:
        dims.setdefault("length", length)
        dims.setdefault("L", length)

    diameter = pick("diameter", "dia", "d", "outer_diameter", "outerD")
    if diameter is not None:
        dims.setdefault("diameter", diameter)
        dims.setdefault("dia", diameter)

    od = pick("outer_diameter", "outerD", "od", "diameter", "d")
    if od is not None:
        dims.setdefault("outer_diameter", od)
        dims.setdefault("outerD", od)

    id_ = pick("inner_diameter", "innerD", "id", "bore")
    if id_ is not None:
        dims.setdefault("inner_diameter", id_)
        dims.setdefault("innerD", id_)

    out = {}
    for key, val in dims.items():
        n = _num(val)
        out[key] = n if n is not None else val
    return out


def _numeric_dims(raw_dims: dict) -> dict:
    """Keep only numeric coercion for existing keys, without adding generic aliases."""
    out = {}
    for key, val in dict(raw_dims or {}).items():
        n = _num(val)
        out[key] = n if n is not None else val
    return out


_SEMANTIC_DIM_SHAPES = {
    "piston", "crankshaft", "camshaft", "flywheel", "pulley", "connector",
    "con_rod", "connecting_rod", "cylinder_liner", "cylinder_sleeve",
    "valve", "spark_plug", "fuel_injector",
    "engine_block", "block", "cylinder_head", "head",
    "intake_manifold", "exhaust_manifold",
    "turbocharger", "oil_pump", "water_pump",
    "clutch_disc", "timing_chain", "timing_belt",
    "oil_pan", "sump", "valve_cover", "cam_cover", "rocker_cover",
    "throttle_body", "throttle", "intercooler", "charge_cooler",
    "radiator", "coolant_radiator", "oil_filter",
    "nut_hex", "washer", "dowel_pin",
}

_GENERIC_AXIS_ALIASES = {"x", "y", "z", "w", "d", "h"}


def normalise_part(part: dict) -> dict:
    """
    Return a normalised copy of *part* with:
    - canonical shape name
    - dimensions_mm filled in with sensible defaults for missing keys
    - transform_mm defaulting to {x:0, y:0, z:0}
    """
    part = dict(part)
    shape_src = part.get("shape", part.get("type", "box"))
    shape = canonical_shape(shape_src, part.get("kind", ""))
    part["shape"] = shape
    part["type"] = str(part.get("type", shape)).lower().strip()

    raw_dims = {**dict(part.get("dims") or {}), **dict(part.get("dimensions_mm") or {})}
    dims = _numeric_dims(raw_dims) if shape in _SEMANTIC_DIM_SHAPES else _canon_dims(raw_dims)
    defaults = _DEFAULTS.get(shape, {"x": 20, "y": 20, "z": 20})
    for key, default_val in defaults.items():
        if key not in dims:
            dims[key] = default_val
    dims = _numeric_dims(dims) if shape in _SEMANTIC_DIM_SHAPES else _canon_dims(dims)

    if shape in _SEMANTIC_DIM_SHAPES:
        for alias in _GENERIC_AXIS_ALIASES:
            dims.pop(alias, None)

    part["dimensions_mm"] = dims
    part["dims"] = dict(dims)

    tx = part.get("transform_mm") or part.get("position") or {}
    if isinstance(tx, list):
        tx = {"x": tx[0] if len(tx) > 0 else 0, "y": tx[1] if len(tx) > 1 else 0, "z": tx[2] if len(tx) > 2 else 0}
    part["transform_mm"] = {
        "x": float(_num(tx.get("x", 0), 0) if isinstance(tx, dict) else 0),
        "y": float(_num(tx.get("y", 0), 0) if isinstance(tx, dict) else 0),
        "z": float(_num(tx.get("z", 0), 0) if isinstance(tx, dict) else 0),
    }
    part["position"] = [part["transform_mm"]["x"], part["transform_mm"]["y"], part["transform_mm"]["z"]]

    return part


def validate_assembly(doc: dict) -> ValidationReport:
    """
    Validate an assembly document dict.

    Returns a ValidationReport describing any errors and warnings.
    An empty `parts` list is a warning, not an error.
    """
    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(doc, dict):
        return ValidationReport(False, ["Assembly document must be a JSON object"], [], 0)

    parts = doc.get("parts")
    if not isinstance(parts, list):
        return ValidationReport(False, ["'parts' must be a list"], [], 0)
    if len(parts) == 0:
        warnings.append("Assembly has no parts")

    seen_ids: set[str] = set()

    for idx, part in enumerate(parts):
        prefix = f"parts[{idx}]"
        if not isinstance(part, dict):
            errors.append(f"{prefix}: each part must be a JSON object")
            continue

        # Required top-level keys
        for key in ("id", "name", "kind"):
            if not part.get(key):
                errors.append(f"{prefix}: missing required field '{key}'")

        part_id = str(part.get("id", f"<index {idx}>"))
        if part_id in seen_ids:
            errors.append(f"{prefix}: duplicate part id '{part_id}'")
        seen_ids.add(part_id)

        # Shape
        raw_shape = part.get("shape", part.get("type", "box"))
        shape = canonical_shape(raw_shape, part.get("kind", ""))
        dims = _canon_dims(part.get("dimensions_mm") or part.get("dims") or {})

        if not isinstance(dims, dict):
            errors.append(f"{prefix} ({part_id}): 'dimensions_mm' must be an object")
            continue

        # Dimension value sanity
        for dim_key, dim_val in dims.items():
            try:
                v = float(dim_val)
                if v < 0:
                    errors.append(f"{prefix} ({part_id}): dimension '{dim_key}' is negative ({dim_val})")
                elif v == 0:
                    warnings.append(f"{prefix} ({part_id}): dimension '{dim_key}' is zero")
                elif not math.isfinite(v):
                    errors.append(f"{prefix} ({part_id}): dimension '{dim_key}' is not finite ({dim_val})")
            except (TypeError, ValueError):
                errors.append(f"{prefix} ({part_id}): dimension '{dim_key}' is not a number ({dim_val!r})")

        # Per-shape constraint checks
        constraint_fn = _CONSTRAINTS.get(shape)
        if constraint_fn:
            constraint_fn(dims, errors)

        # Warn if no dimensions at all
        if not dims:
            warnings.append(f"{prefix} ({part_id}): no dimensions_mm provided; defaults will be used")

        # Transform
        tx = part.get("transform_mm")
        if tx is not None and not isinstance(tx, (dict, list)):
            errors.append(f"{prefix} ({part_id}): 'transform_mm' must be an object or array")

    # Wiring/netlist are optional but must be lists if present
    for field in ("wiring", "netlist"):
        val = doc.get(field)
        if val is not None and not isinstance(val, list):
            errors.append(f"'{field}' must be a list")

    return ValidationReport(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
        part_count=len(parts),
    )


# ─── CLI usage ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print("Usage: python cad_dsl.py <assembly_document.json>")
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        doc = json.load(f)

    report = validate_assembly(doc)
    print(json.dumps(report.to_dict(), indent=2))
    sys.exit(0 if report.valid else 1)
