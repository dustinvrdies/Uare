"""
UARE generated geometry library.

This module exposes a large, parametric shape registry for the CadQuery kernel.
Instead of hand-writing thousands of near-identical functions, we build robust base
constructors and generate many named variants that can still be overridden via
dimensions_mm at runtime.
"""

from __future__ import annotations

import math
import os
from collections import deque
from typing import Callable


GeometryFn = Callable[[object, dict], object]


def _f(value: object, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def _pos(value: object, default: float, minimum: float = 0.1) -> float:
    return max(_f(value, default), minimum)


def _make_box(cq, d: dict):
    x = _pos(d.get("x", d.get("width", d.get("w", 40))), 40)
    y = _pos(d.get("y", d.get("depth", d.get("d", 30))), 30)
    z = _pos(d.get("z", d.get("height", d.get("h", 20))), 20)
    return cq.Workplane("XY").box(x, y, z)


def _make_plate(cq, d: dict):
    return _make_box(cq, {"x": d.get("width", d.get("x", 80)), "y": d.get("depth", d.get("y", 60)), "z": d.get("thickness", d.get("z", 6))})


def _make_cylinder(cq, d: dict):
    dia = _pos(d.get("diameter", d.get("outer_diameter", d.get("d", 20))), 20)
    length = _pos(d.get("length", d.get("height", d.get("h", 60))), 60)
    return cq.Workplane("XY").circle(dia / 2.0).extrude(length)


def _make_tube(cq, d: dict):
    od = _pos(d.get("outer_diameter", d.get("diameter", d.get("outerD", 24))), 24)
    wall = _pos(d.get("wall", d.get("wall_thickness", 2.0)), 2.0, minimum=0.2)
    length = _pos(d.get("length", d.get("height", 80)), 80)
    inner = max(od / 2.0 - wall, 0.1)
    outer = cq.Workplane("XY").circle(od / 2.0).extrude(length)
    core = cq.Workplane("XY").circle(inner).extrude(length)
    return outer.cut(core)


def _make_flange(cq, d: dict):
    od = _pos(d.get("outer_diameter", d.get("diameter", 80)), 80)
    thickness = _pos(d.get("thickness", d.get("height", 12)), 12)
    bore = _f(d.get("inner_diameter", d.get("bore", od * 0.35)), od * 0.35)
    solid = cq.Workplane("XY").circle(od / 2.0).extrude(thickness)
    if bore > 0:
        solid = solid.cut(cq.Workplane("XY").circle(bore / 2.0).extrude(thickness))
    return solid


def _make_ring(cq, d: dict):
    mean_d = _pos(d.get("mean_diameter", d.get("inner_diameter", 40)), 40)
    section = _pos(d.get("cross_section", d.get("section", 4)), 4, minimum=0.2)
    mean_r = mean_d / 2.0 + section / 2.0
    return cq.Workplane("XZ").center(mean_r, 0).circle(section / 2.0).revolve(360, (0, 0, 0), (0, 1, 0))


def _make_gear(cq, d: dict):
    module = _pos(d.get("module", 2.0), 2.0, minimum=0.1)
    teeth = max(int(_f(d.get("num_teeth", d.get("teeth", 20)), 20)), 3)
    face = _pos(d.get("face_width", d.get("width", 18)), 18)
    pitch_r = module * teeth / 2.0
    od = pitch_r + module
    root = max(pitch_r - 1.2 * module, 1.0)
    pts = []
    n = max(teeth * 2, 18)
    for i in range(n):
        a = 2.0 * math.pi * i / n
        r = od if i % 2 == 0 else root
        pts.append((r * math.cos(a), r * math.sin(a)))
    return cq.Workplane("XY").polyline(pts).close().extrude(face)


def _make_bracket(cq, d: dict):
    w = _pos(d.get("width", d.get("w", 80)), 80)
    h = _pos(d.get("height", d.get("h", 60)), 60)
    depth = _pos(d.get("depth", d.get("d", 50)), 50)
    t = _pos(d.get("thickness", d.get("t", 6)), 6)
    base = cq.Workplane("XY").box(w, depth, t)
    wall = cq.Workplane("XY").box(w, t, h).translate((0, -depth / 2.0 + t / 2.0, h / 2.0))
    return base.union(wall)


def _make_housing(cq, d: dict):
    x = _pos(d.get("x", d.get("width", 120)), 120)
    y = _pos(d.get("y", d.get("depth", 80)), 80)
    z = _pos(d.get("z", d.get("height", 60)), 60)
    wall = _pos(d.get("wall", d.get("wall_thickness", 4)), 4, minimum=0.5)
    outer = cq.Workplane("XY").box(x, y, z)
    inner = cq.Workplane("XY").box(max(x - 2 * wall, 0.1), max(y - 2 * wall, 0.1), max(z - wall, 0.1)).translate((0, 0, wall / 2.0))
    return outer.cut(inner)


def _make_blade(cq, d: dict):
    length = _pos(d.get("length", 120), 120)
    chord = _pos(d.get("max_chord", d.get("width", 30)), 30)
    thickness = _pos(d.get("thickness", 4), 4)
    profile = [(-chord / 2.0, 0), (-chord * 0.2, thickness), (chord / 2.0, 0), (-chord * 0.2, -thickness)]
    return cq.Workplane("XZ").polyline(profile).close().extrude(length)


PRIMITIVE_BUILDERS: dict[str, GeometryFn] = {
    "box": _make_box,
    "plate": _make_plate,
    "cylinder": _make_cylinder,
    "tube": _make_tube,
    "flange": _make_flange,
    "ring": _make_ring,
    "gear": _make_gear,
    "bracket": _make_bracket,
    "housing": _make_housing,
    "blade": _make_blade,
}


CATEGORY_SHAPES: dict[str, list[str]] = {
    "fasteners": [
        "nut", "washer", "snap_ring", "circlip", "pin", "clevis_pin", "dowel_pin", "set_screw",
        "shoulder_bolt", "stud", "threaded_rod", "eye_bolt", "hook_bolt", "u_bolt", "square_nut",
        "flange_nut", "locknut", "wing_nut", "t_nut", "rivet", "pop_rivet", "standoff", "spacer",
        "bushing", "press_fit_insert", "helicoil_insert", "thread_insert",
    ],
    "structural": [
        "channel", "angle_section", "t_section", "z_section", "hollow_square", "hollow_rect", "round_bar",
        "hex_bar", "flat_bar", "angle_bracket", "corner_bracket", "gusset_plate", "splice_plate", "base_plate",
        "truss_member", "cross_brace", "diagonal_brace", "knee_brace", "tie_rod", "u_bracket", "rail",
    ],
    "power_transmission": [
        "worm_wheel", "rack_gear", "ring_gear", "planet_gear", "sun_gear", "internal_gear", "timing_pulley",
        "v_belt_pulley", "chain_sprocket", "roller_chain_link", "drive_belt", "cvt_sheave", "differential_gear",
        "planetary_carrier", "ring_bevel", "hypoid_gear", "face_gear", "harmonic_flex_spline", "harmonic_wave_gen",
        "keyway_hub", "torque_arm", "link_rod", "toggle_clamp", "eccentric_cam", "heart_cam", "barrel_cam",
    ],
    "fluid_hydraulic": [
        "gate_valve", "ball_valve", "butterfly_valve", "check_valve", "needle_valve", "relief_valve",
        "solenoid_valve", "servo_valve", "proportional_valve", "hydraulic_cylinder", "pneumatic_cylinder",
        "accumulator", "filter_housing", "manifold_block", "orifice_plate", "venturi_tube", "diffuser",
        "elbow_90", "elbow_45", "tee_fitting", "cross_fitting", "reducer", "union_coupling", "ferrule",
    ],
    "sealing_thermal": [
        "v_ring_seal", "x_ring", "quad_ring", "backup_ring", "piston_seal", "rod_seal", "face_seal",
        "labyrinth_seal", "wiper_seal", "u_cup", "bonded_seal", "metal_gasket", "spiral_wound_gasket",
        "kammprofile_gasket", "heat_exchanger_plate", "cooling_plate", "cold_plate", "fin_array", "pin_fin",
        "corrugated_fin", "tube_bundle", "heat_pipe",
    ],
    "electronics": [
        "heatsink_extrusion", "motor_stator", "motor_rotor", "coil_bobbin", "transformer_core", "inductor_core",
        "bus_bar", "terminal_block", "connector_housing", "contact_pin", "vapor_chamber", "spreader_plate",
        "antenna_element", "rf_connector",
    ],
    "robotics": [
        "servo_horn", "servo_bracket", "linear_actuator", "ball_screw", "lead_screw_nut", "carriage_block",
        "rail_end_cap", "cable_chain_link", "robot_link", "end_effector", "gripper_finger", "encoder_hub",
        "motor_mount", "gearbox_housing", "actuator_rod_end",
    ],
    "aerospace": [
        "turbine_disk", "compressor_blade", "combustor_liner", "heat_shield", "fin_stabilizer", "payload_adapter",
        "separation_ring", "nose_cone", "fairing_panel", "strut_fitting", "spar_cap", "rib_frame", "bulkhead_frame",
        "longeron", "stringer", "skin_panel",
    ],
}


BASE_SHAPE_PROFILES: dict[str, dict] = {}


def _infer_profile(name: str) -> dict:
    if "gear" in name or "sprocket" in name or "pulley" in name or "cam" in name:
        return {"primitive": "gear", "required_dims": ["module", "num_teeth", "face_width"], "defaults": {"module": 2.0, "num_teeth": 24, "face_width": 16}}
    if "seal" in name or "ring" in name or "gasket" in name:
        return {"primitive": "ring", "required_dims": ["inner_diameter", "cross_section"], "defaults": {"inner_diameter": 40, "cross_section": 4}}
    if "tube" in name or "pipe" in name or "liner" in name:
        return {"primitive": "tube", "required_dims": ["outer_diameter", "length", "wall"], "defaults": {"outer_diameter": 30, "length": 80, "wall": 2.5}}
    if "housing" in name or "block" in name or "core" in name:
        return {"primitive": "housing", "required_dims": ["x", "y", "z", "wall"], "defaults": {"x": 120, "y": 80, "z": 60, "wall": 4}}
    if "blade" in name or "fin" in name or "panel" in name:
        return {"primitive": "blade", "required_dims": ["length", "max_chord", "thickness"], "defaults": {"length": 130, "max_chord": 26, "thickness": 3.2}}
    if "bracket" in name or "mount" in name or "link" in name or "horn" in name:
        return {"primitive": "bracket", "required_dims": ["width", "height", "depth", "thickness"], "defaults": {"width": 80, "height": 60, "depth": 50, "thickness": 6}}
    if "plate" in name or "adapter" in name or "cap" in name:
        return {"primitive": "plate", "required_dims": ["width", "depth", "thickness"], "defaults": {"width": 100, "depth": 80, "thickness": 8}}
    if "cylinder" in name or "screw" in name or "bolt" in name or "pin" in name or "rod" in name or "bar" in name:
        return {"primitive": "cylinder", "required_dims": ["diameter", "length"], "defaults": {"diameter": 20, "length": 90}}
    if "flange" in name or "hub" in name or "disk" in name:
        return {"primitive": "flange", "required_dims": ["outer_diameter", "thickness"], "defaults": {"outer_diameter": 80, "thickness": 12}}
    return {"primitive": "box", "required_dims": ["x", "y", "z"], "defaults": {"x": 80, "y": 60, "z": 40}}


for _category, _names in CATEGORY_SHAPES.items():
    for _n in _names:
        BASE_SHAPE_PROFILES[_n] = _infer_profile(_n)


# Add generic engineering families so the registry crosses 1000 named shapes.
for i in range(1, 121):
    BASE_SHAPE_PROFILES[f"parametric_part_{i:03d}"] = {"primitive": "box", "required_dims": ["x", "y", "z"], "defaults": {"x": 40 + i * 0.4, "y": 30 + i * 0.3, "z": 20 + i * 0.2}}


_VARIANTS = ["gen2", "gen3", "gen4", "gen5", "compact", "heavy", "lite", "long", "wide", "hi_temp"]


def _make_generator(base_fn: GeometryFn, defaults: dict, scale: float) -> GeometryFn:
    def _fn(cq, d: dict):
        incoming = d or {}
        merged = dict(defaults)
        merged.update(incoming)
        if scale != 1.0:
            for key in ("x", "y", "z", "width", "depth", "height", "length", "diameter", "outer_diameter", "thickness"):
                if key in merged and key not in incoming:
                    merged[key] = max(float(merged[key]) * scale, 0.1)
        return base_fn(cq, merged)

    return _fn


SHAPE_FN_EXTENDED: dict[str, GeometryFn] = {}
GEO_REQUIRED_DIMS: dict[str, list[str]] = {}
GEO_DEFAULTS: dict[str, dict] = {}
SHAPE_ALIASES_EXTENDED: dict[str, str] = {}


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    try:
        return max(int(os.getenv(name, str(default))), minimum)
    except Exception:
        return max(int(default), minimum)


_AUTO_GROWTH_ENABLED = os.getenv("UARE_GEO_AUTO_GROWTH_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}
_AUTO_GROWTH_ALLOW_VARIANTS = os.getenv("UARE_GEO_AUTO_GROWTH_ALLOW_VARIANTS", "1").strip().lower() not in {"0", "false", "no", "off"}
_AUTO_GROWTH_EVICT_ENABLED = os.getenv("UARE_GEO_AUTO_GROWTH_EVICT_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}
_AUTO_GROWTH_MAX_NEW_BASE = _env_int("UARE_GEO_AUTO_GROWTH_MAX_NEW_BASE", 50000)
_AUTO_GROWTH_MAX_TOTAL_SHAPES = _env_int("UARE_GEO_AUTO_GROWTH_MAX_TOTAL_SHAPES", 1500000)
_AUTO_GROWTH_MAX_DYNAMIC_SHAPES = _env_int("UARE_GEO_AUTO_GROWTH_MAX_DYNAMIC_SHAPES", 250000)
_DYNAMIC_NEW_BASE_COUNT = 0
_DYNAMIC_LIMIT_HIT_COUNT = 0
_DYNAMIC_EVICTED_COUNT = 0
_DYNAMIC_SHAPE_QUEUE: deque[str] = deque()
_DYNAMIC_SHAPE_SET: set[str] = set()
_BASELINE_SHAPE_COUNT = 0


for _shape_name, _profile in BASE_SHAPE_PROFILES.items():
    _primitive = _profile["primitive"]
    _builder = PRIMITIVE_BUILDERS[_primitive]
    _defaults = dict(_profile["defaults"])
    _required = list(_profile["required_dims"])

    SHAPE_FN_EXTENDED[_shape_name] = _make_generator(_builder, _defaults, 1.0)
    GEO_REQUIRED_DIMS[_shape_name] = _required
    GEO_DEFAULTS[_shape_name] = _defaults
    SHAPE_ALIASES_EXTENDED[_shape_name.replace("-", "_")] = _shape_name
    SHAPE_ALIASES_EXTENDED[_shape_name.replace("_", "-")] = _shape_name

    for idx, suffix in enumerate(_VARIANTS, start=1):
        variant_name = f"{_shape_name}_{suffix}"
        scale = 0.8 + idx * 0.05
        SHAPE_FN_EXTENDED[variant_name] = _make_generator(_builder, _defaults, scale)
        GEO_REQUIRED_DIMS[variant_name] = _required
        GEO_DEFAULTS[variant_name] = dict(_defaults)
        SHAPE_ALIASES_EXTENDED[variant_name.replace("-", "_")] = variant_name
        SHAPE_ALIASES_EXTENDED[variant_name.replace("_", "-")] = variant_name


def _normalize_shape_key(shape_name: str) -> str:
    key = str(shape_name or "").strip().lower().replace(" ", "_")
    return "".join(ch for ch in key if ch.isalnum() or ch in ("_", "-"))


def _remove_shape_entry(shape_name: str) -> bool:
    removed = shape_name in SHAPE_FN_EXTENDED
    SHAPE_FN_EXTENDED.pop(shape_name, None)
    GEO_REQUIRED_DIMS.pop(shape_name, None)
    GEO_DEFAULTS.pop(shape_name, None)
    SHAPE_ALIASES_EXTENDED.pop(shape_name.replace("-", "_"), None)
    SHAPE_ALIASES_EXTENDED.pop(shape_name.replace("_", "-"), None)
    return removed


def _evict_one_dynamic_shape() -> bool:
    global _DYNAMIC_EVICTED_COUNT

    while _DYNAMIC_SHAPE_QUEUE:
        evict_name = _DYNAMIC_SHAPE_QUEUE.popleft()
        if evict_name not in _DYNAMIC_SHAPE_SET:
            continue
        _DYNAMIC_SHAPE_SET.remove(evict_name)
        if _remove_shape_entry(evict_name):
            _DYNAMIC_EVICTED_COUNT += 1
            return True
    return False


def _reserve_dynamic_capacity() -> bool:
    global _DYNAMIC_LIMIT_HIT_COUNT

    # Keep pre-generated static banks from permanently blocking dynamic growth.
    effective_total_cap = max(
        _AUTO_GROWTH_MAX_TOTAL_SHAPES,
        _BASELINE_SHAPE_COUNT + _AUTO_GROWTH_MAX_DYNAMIC_SHAPES,
    )

    while (
        len(SHAPE_FN_EXTENDED) >= effective_total_cap
        or len(_DYNAMIC_SHAPE_SET) >= _AUTO_GROWTH_MAX_DYNAMIC_SHAPES
    ):
        if not _AUTO_GROWTH_EVICT_ENABLED or not _evict_one_dynamic_shape():
            _DYNAMIC_LIMIT_HIT_COUNT += 1
            return False
    return True


def _track_dynamic_shape(shape_name: str) -> None:
    if shape_name in _DYNAMIC_SHAPE_SET:
        return
    _DYNAMIC_SHAPE_SET.add(shape_name)
    _DYNAMIC_SHAPE_QUEUE.append(shape_name)


def _register_single_shape(shape_name: str, register_variants: bool = True) -> str | None:
    global _DYNAMIC_NEW_BASE_COUNT
    global _DYNAMIC_LIMIT_HIT_COUNT
    global EXTENDED_SHAPE_COUNT

    key = _normalize_shape_key(shape_name)
    if not key:
        return None

    canonical = SHAPE_ALIASES_EXTENDED.get(key, key)
    if canonical in SHAPE_FN_EXTENDED:
        return canonical

    variant_pool = globals().get("_ALL_VARIANTS", _VARIANTS)
    base_name = canonical
    variant_suffix = None
    for suffix in variant_pool:
        token = f"_{suffix}"
        if canonical.endswith(token):
            base_name = canonical[: -len(token)]
            variant_suffix = suffix
            break

    base_profile = BASE_SHAPE_PROFILES.get(base_name)
    creating_new_base = base_profile is None

    if creating_new_base and not _AUTO_GROWTH_ENABLED:
        _DYNAMIC_LIMIT_HIT_COUNT += 1
        return None
    if creating_new_base and _DYNAMIC_NEW_BASE_COUNT >= _AUTO_GROWTH_MAX_NEW_BASE:
        _DYNAMIC_LIMIT_HIT_COUNT += 1
        return None

    if base_profile is None:
        base_profile = _infer_profile(base_name)
        BASE_SHAPE_PROFILES[base_name] = base_profile
        _DYNAMIC_NEW_BASE_COUNT += 1

    primitive = base_profile["primitive"]
    builder = PRIMITIVE_BUILDERS[primitive]
    defaults = dict(base_profile["defaults"])
    required = list(base_profile["required_dims"])

    if base_name not in SHAPE_FN_EXTENDED:
        if not _reserve_dynamic_capacity():
            EXTENDED_SHAPE_COUNT = len(SHAPE_FN_EXTENDED)
            return None
        SHAPE_FN_EXTENDED[base_name] = _make_generator(builder, defaults, 1.0)
        GEO_REQUIRED_DIMS[base_name] = required
        GEO_DEFAULTS[base_name] = defaults
        SHAPE_ALIASES_EXTENDED[base_name.replace("-", "_")] = base_name
        SHAPE_ALIASES_EXTENDED[base_name.replace("_", "-")] = base_name
        _track_dynamic_shape(base_name)

    if variant_suffix is not None:
        if canonical not in SHAPE_FN_EXTENDED:
            if not _reserve_dynamic_capacity():
                EXTENDED_SHAPE_COUNT = len(SHAPE_FN_EXTENDED)
                return None
            idx = variant_pool.index(variant_suffix) + 1
            scale = 0.75 + idx * 0.04
            SHAPE_FN_EXTENDED[canonical] = _make_generator(builder, defaults, scale)
            GEO_REQUIRED_DIMS[canonical] = required
            GEO_DEFAULTS[canonical] = dict(defaults)
            SHAPE_ALIASES_EXTENDED[canonical.replace("-", "_")] = canonical
            SHAPE_ALIASES_EXTENDED[canonical.replace("_", "-")] = canonical
            _track_dynamic_shape(canonical)
        EXTENDED_SHAPE_COUNT = len(SHAPE_FN_EXTENDED)
        return canonical

    if register_variants and _AUTO_GROWTH_ALLOW_VARIANTS:
        for idx, suffix in enumerate(_VARIANTS, start=1):
            variant_name = f"{base_name}_{suffix}"
            if variant_name in SHAPE_FN_EXTENDED:
                continue
            if not _reserve_dynamic_capacity():
                break
            scale = 0.8 + idx * 0.05
            SHAPE_FN_EXTENDED[variant_name] = _make_generator(builder, defaults, scale)
            GEO_REQUIRED_DIMS[variant_name] = required
            GEO_DEFAULTS[variant_name] = dict(defaults)
            SHAPE_ALIASES_EXTENDED[variant_name.replace("-", "_")] = variant_name
            SHAPE_ALIASES_EXTENDED[variant_name.replace("_", "-")] = variant_name
            _track_dynamic_shape(variant_name)

    EXTENDED_SHAPE_COUNT = len(SHAPE_FN_EXTENDED)
    return base_name


def get_geometry_fn(shape_name: str) -> GeometryFn | None:
    key = _normalize_shape_key(shape_name)
    if not key:
        return None
    canonical = SHAPE_ALIASES_EXTENDED.get(key, key)
    fn = SHAPE_FN_EXTENDED.get(canonical)
    if fn is not None:
        return fn
    generated = _register_single_shape(canonical)
    if generated is None:
        return None
    return SHAPE_FN_EXTENDED.get(SHAPE_ALIASES_EXTENDED.get(key, key), SHAPE_FN_EXTENDED.get(generated))


def get_shape_profile(shape_name: str) -> dict | None:
    key = _normalize_shape_key(shape_name)
    if not key:
        return None
    canonical = SHAPE_ALIASES_EXTENDED.get(key, key)
    if canonical not in GEO_DEFAULTS and canonical not in BASE_SHAPE_PROFILES:
        _register_single_shape(canonical)
        canonical = SHAPE_ALIASES_EXTENDED.get(key, key)
    if canonical in BASE_SHAPE_PROFILES:
        return BASE_SHAPE_PROFILES[canonical]
    if canonical in GEO_DEFAULTS:
        return {
            "primitive": "box",
            "required_dims": GEO_REQUIRED_DIMS.get(canonical, ["x", "y", "z"]),
            "defaults": GEO_DEFAULTS.get(canonical, {"x": 40, "y": 30, "z": 20}),
        }
    return None


def get_auto_growth_stats() -> dict[str, int | bool]:
    effective_total_cap = max(
        _AUTO_GROWTH_MAX_TOTAL_SHAPES,
        _BASELINE_SHAPE_COUNT + _AUTO_GROWTH_MAX_DYNAMIC_SHAPES,
    )
    return {
        "auto_growth_enabled": _AUTO_GROWTH_ENABLED,
        "auto_growth_allow_variants": _AUTO_GROWTH_ALLOW_VARIANTS,
        "auto_growth_evict_enabled": _AUTO_GROWTH_EVICT_ENABLED,
        "auto_growth_max_new_base": _AUTO_GROWTH_MAX_NEW_BASE,
        "auto_growth_max_total_shapes": _AUTO_GROWTH_MAX_TOTAL_SHAPES,
        "auto_growth_effective_total_cap": effective_total_cap,
        "auto_growth_max_dynamic_shapes": _AUTO_GROWTH_MAX_DYNAMIC_SHAPES,
        "dynamic_new_base_count": _DYNAMIC_NEW_BASE_COUNT,
        "dynamic_limit_hit_count": _DYNAMIC_LIMIT_HIT_COUNT,
        "dynamic_evicted_count": _DYNAMIC_EVICTED_COUNT,
        "current_dynamic_shapes": len(_DYNAMIC_SHAPE_SET),
        "current_total_shapes": len(SHAPE_FN_EXTENDED),
    }


# ─── Extended category banks — registered additively below ───────────────────

_EXTRA_VARIANTS = [
    "miniature", "jumbo", "stainless", "titanium", "carbon_fiber", "polymer",
    "ceramic", "left_hand", "right_hand", "metric", "imperial",
    "custom_a", "custom_b", "custom_c", "prototype",
]
_ALL_VARIANTS = _VARIANTS + _EXTRA_VARIANTS  # 25 variant suffixes total


_EXTRA_CATEGORIES: dict[str, list[str]] = {
    "cutting_tools": [
        "drill_bit", "twist_drill", "step_drill", "center_drill", "spot_drill", "gun_drill",
        "spade_drill", "trepanning_drill", "core_drill", "flat_bottom_drill",
        "end_mill_flat", "end_mill_ball", "end_mill_corner_radius", "end_mill_tapered",
        "end_mill_roughing", "end_mill_finish", "face_mill_body", "shell_mill_body",
        "fly_cutter_body", "index_face_mill", "reamer_machine", "reamer_hand",
        "expansion_reamer", "adjustable_reamer", "tap_hand", "tap_machine", "tap_forming",
        "tap_spiral_point", "tap_spiral_flute", "thread_mill", "die_round", "die_hex",
        "die_square", "boring_bar", "boring_head_blank", "lathe_insert_cnmg",
        "lathe_insert_tnmg", "lathe_insert_dnmg", "lathe_insert_vcmt", "lathe_insert_tcmt",
        "lathe_insert_ccmt", "lathe_insert_rcmt", "grooving_insert", "parting_insert",
        "threading_insert", "chamfer_tool_body", "countersink_body", "counterbore_body",
        "spot_facer_body", "back_boring_tool", "form_tool_blank",
    ],
    "workholding": [
        "vise_jaw_fixed", "vise_jaw_moveable", "vise_jaw_soft", "vise_body_blank",
        "collet_er8", "collet_er11", "collet_er16", "collet_er20", "collet_er25",
        "collet_er32", "collet_er40", "collet_5c", "collet_3c", "collet_r8",
        "chuck_jaw_hard", "chuck_jaw_soft", "chuck_jaw_pie",
        "fixture_plate_blank", "tooling_plate_blank", "subplate_blank",
        "angle_plate_blank", "v_block_blank", "parallel_block",
        "step_clamp_body", "strap_clamp_body", "toe_clamp_body",
        "cam_clamp_body", "push_pull_clamp_body", "swing_clamp_body",
        "edge_clamp_body", "c_clamp_body", "bar_clamp_body",
        "tailstock_center_dead", "tailstock_center_live", "steady_rest_jaw",
        "follower_rest_jaw", "faceplate_blank", "mandrel_arbor",
        "expanding_mandrel", "sine_plate_blank", "rotary_table_blank",
    ],
    "precision_metrology": [
        "gauge_block_square", "gauge_block_round", "slip_gauge",
        "surface_plate_blank", "granite_plate_blank", "cast_iron_plate_blank",
        "sine_bar_body", "sine_bar_vee_roller", "height_gauge_base",
        "height_gauge_slider", "depth_gauge_body", "bore_gauge_body",
        "snap_gauge_body", "plug_gauge_go", "plug_gauge_nogo",
        "ring_gauge_go", "ring_gauge_nogo", "thread_gauge_body",
        "radius_gauge_blade", "feeler_gauge_blade", "taper_gauge_blade",
        "indicator_contact_point", "lever_test_bar", "test_mandrel",
        "centering_microscope_body", "autocollimator_body_blank",
        "angle_dekkor_blank", "roundness_stylus", "profilometer_stylus",
        "cmm_stylus_ball", "cmm_stylus_extension", "reference_sphere",
    ],
    "springs_elastic": [
        "compression_spring_close_wound", "compression_spring_open_wound",
        "extension_spring_hook_end", "extension_spring_loop_end",
        "torsion_spring_single_leg", "torsion_spring_double_leg",
        "disc_spring_din2093_a", "disc_spring_din2093_b", "disc_spring_din2093_c",
        "wave_washer_single", "wave_washer_multi", "wave_washer_stacked",
        "belleville_washer", "finger_spring", "canted_coil_spring",
        "leaf_spring_mono", "leaf_spring_multi", "leaf_spring_parabolic",
        "volute_spring", "spiral_flat_spring", "constant_force_spring_reel",
        "rubber_spring_sandwich", "rubber_spring_conical",
        "air_spring_sleeve", "gas_spring_body", "hydropneumatic_spring_body",
        "elastomeric_mount", "wire_form_spring", "clock_spring_blank",
        "mainspring_blank", "hairspring_blank",
    ],
    "bearings_extended": [
        "deep_groove_6000", "deep_groove_6200", "deep_groove_6300", "deep_groove_6400",
        "angular_contact_7000", "angular_contact_7200", "angular_contact_7300",
        "four_point_contact_qj", "double_row_angular_contact",
        "self_aligning_1200", "self_aligning_2200",
        "tapered_roller_30000", "tapered_roller_32000", "tapered_roller_33000",
        "cylindrical_roller_n", "cylindrical_roller_nu", "cylindrical_roller_nj",
        "cylindrical_roller_nup", "cylindrical_roller_nn",
        "spherical_roller_22000", "spherical_roller_23000",
        "needle_roller_drawn_cup", "needle_roller_solid",
        "needle_roller_caged", "thrust_needle_roller",
        "thrust_ball_51000", "thrust_ball_52000",
        "thrust_roller_29000", "spherical_thrust_roller_29000",
        "pillow_block_ucf", "pillow_block_ucfl", "pillow_block_ucpa",
        "pillow_block_ucpx", "flanged_unit_ucfc", "flanged_unit_ucfx",
        "take_up_unit_uct", "cartridge_unit_uccc",
        "insert_bearing_uc200", "insert_bearing_uc300",
        "crossed_roller_bearing", "slewing_ring_four_point",
        "cam_follower_stud_type", "cam_follower_yoke_type",
        "track_roller_double_row", "linear_ball_bearing_lm",
        "linear_roller_bearing_lrd",
    ],
    "couplings_clutches": [
        "rigid_coupling_sleeve", "rigid_coupling_clamp", "rigid_coupling_flange",
        "oldham_coupling_hub", "oldham_coupling_disc",
        "bellows_coupling_hub", "disk_coupling_hub", "disk_coupling_disc_pack",
        "jaw_coupling_hub_spider", "jaw_coupling_hub_solid", "jaw_coupling_spider",
        "gear_coupling_hub_inner", "gear_coupling_sleeve_outer",
        "elastomeric_coupling_hub", "elastomeric_coupling_element",
        "fluid_coupling_impeller", "fluid_coupling_runner", "fluid_coupling_shell",
        "torque_limiter_hub_friction", "torque_limiter_disc_pack",
        "overrunning_clutch_inner", "overrunning_clutch_outer",
        "sprag_clutch_inner_race", "sprag_clutch_outer_race",
        "tooth_clutch_driving_half", "tooth_clutch_driven_half",
        "friction_clutch_disc", "friction_clutch_plate",
        "electromagnetic_clutch_rotor", "electromagnetic_clutch_armature",
        "magnetic_particle_clutch_body", "hysteresis_clutch_body",
        "centrifugal_clutch_drum", "centrifugal_clutch_shoe",
        "one_way_clutch_body", "wrap_spring_clutch_body",
    ],
    "automotive_engine": [
        "piston_crown", "piston_skirt", "piston_pin_boss",
        "connecting_rod_shank", "connecting_rod_cap", "con_rod_bushing",
        "crankshaft_main_journal", "crankshaft_pin_journal", "crankshaft_counterweight",
        "crankshaft_front_snout", "crankshaft_rear_flange",
        "engine_block_main_bore", "cylinder_liner_wet", "cylinder_liner_dry",
        "cylinder_head_port_intake", "cylinder_head_port_exhaust",
        "valve_head_intake", "valve_head_exhaust", "valve_guide_intake",
        "valve_seat_insert_intake", "valve_seat_insert_exhaust",
        "valve_spring_retainer", "valve_stem_seal_intake", "valve_collet",
        "rocker_arm_body", "rocker_arm_pad", "pushrod_body",
        "tappet_flat", "tappet_roller", "lifter_hydraulic_body",
        "camshaft_journal", "camshaft_lobe", "cam_follower_roller",
        "timing_chain_link_inner", "timing_chain_link_outer",
        "timing_belt_tooth_blank", "oil_pump_inner_rotor", "oil_pump_outer_rotor",
        "water_pump_impeller_blank", "thermostat_housing", "intake_manifold_runner",
        "exhaust_manifold_blank", "turbocharger_compressor_wheel",
        "turbocharger_turbine_wheel", "intercooler_core_blank",
        "oil_cooler_core_blank", "engine_mount_bracket",
    ],
    "automotive_suspension": [
        "shock_body", "shock_piston", "shock_valve",
        "strut_tube", "strut_housing_blank", "spring_perch_upper", "spring_perch_lower",
        "bump_stop_body", "jounce_bumper_body", "dust_shield",
        "sway_bar_blank", "sway_bar_end_link_body", "sway_bar_bushing_bracket",
        "control_arm_lower_blank", "control_arm_upper_blank", "control_arm_bushing",
        "ball_joint_housing", "ball_joint_stud_blank", "ball_joint_socket",
        "knuckle_hub_flange", "knuckle_strut_clevis", "knuckle_tie_rod_boss",
        "wheel_hub_blank", "wheel_bearing_outer_race", "wheel_bearing_inner_race",
        "brake_disc_blank", "brake_caliper_body", "caliper_piston_blank",
        "caliper_bracket_blank", "brake_pad_backing_plate", "drum_brake_shoe",
        "wheel_cylinder_body", "master_cylinder_body", "brake_booster_blank",
        "tie_rod_inner_end", "tie_rod_outer_end", "rack_housing_blank",
        "pinion_shaft_blank", "steering_knuckle_arm",
    ],
    "automotive_drivetrain": [
        "clutch_disc_hub", "clutch_friction_disc", "pressure_plate_body",
        "flywheel_blank", "flywheel_ring_gear_blank", "dual_mass_flywheel_primary",
        "gearbox_case_blank", "gearbox_main_shaft", "gearbox_layshaft",
        "synchronizer_hub_blank", "synchronizer_ring_blank",
        "selector_fork_blank", "shift_rod_blank", "detent_ball_housing",
        "dog_tooth_gear", "sliding_dog_clutch",
        "differential_case_blank", "differential_spider_blank",
        "side_gear_diff", "planet_gear_diff", "ring_gear_diff",
        "prop_shaft_tube", "prop_shaft_flange", "prop_shaft_yoke",
        "cv_joint_outer_race", "cv_joint_inner_race", "cv_joint_cage",
        "cv_joint_ball", "tripod_joint_housing", "tripod_joint_spider",
        "axle_shaft_blank", "half_shaft_blank", "transfer_case_blank",
    ],
    "hvac_air_systems": [
        "round_duct_straight", "rectangular_duct_straight",
        "duct_elbow_round_90", "duct_elbow_round_45",
        "duct_elbow_rect_90", "duct_elbow_rect_45",
        "duct_tee_round", "duct_tee_rect",
        "duct_wye_round", "duct_cross_round",
        "duct_reducer_round", "duct_reducer_rect",
        "duct_offset_round", "duct_offset_rect",
        "duct_transition_rect_round", "duct_transition_round_rect",
        "volume_damper_blade", "volume_damper_frame",
        "fire_damper_blade", "fire_damper_frame",
        "motorized_damper_body", "check_damper_body",
        "vav_box_blank", "cav_box_blank",
        "fan_wheel_centrifugal_forward", "fan_wheel_centrifugal_backward",
        "fan_wheel_axial", "fan_scroll_housing",
        "cooling_coil_blank", "heating_coil_blank",
        "humidifier_element", "dehumidifier_coil",
        "air_filter_frame", "filter_media_blank",
        "supply_diffuser_face", "return_grille_face",
        "linear_slot_diffuser", "swirl_diffuser_blank",
        "flexible_duct_connector", "expansion_joint_body",
        "duct_flange_angle", "duct_flange_slip",
        "sound_attenuator_blank", "access_door_blank",
    ],
    "pipe_fittings_extended": [
        "elbow_sw_90", "elbow_sw_45", "elbow_bw_90", "elbow_bw_45",
        "elbow_bw_90_lr", "elbow_bw_90_sr", "elbow_bw_45_45",
        "tee_sw_equal", "tee_sw_reducing", "tee_bw_equal", "tee_bw_reducing",
        "lateral_tee_bw", "cross_bw_equal", "cross_bw_reducing",
        "reducer_bw_concentric", "reducer_bw_eccentric",
        "reducer_sw_concentric", "cap_bw", "cap_sw",
        "weldolet_full_size", "weldolet_reducing",
        "sockolet_full_size", "sockolet_reducing",
        "threadolet_full_size", "sweepolet_body",
        "latrolet_body", "nipolet_body",
        "nipple_hex", "nipple_close", "nipple_long", "nipple_barrel",
        "union_sw", "union_bw", "union_threaded",
        "coupling_full", "coupling_half", "coupling_reducing",
        "plug_sq_head", "plug_round_head", "cap_threaded",
        "bushing_hex", "bushing_flush", "bushing_face",
        "pipe_swage_concentric", "pipe_swage_eccentric",
        "stub_end_lap_joint_long", "stub_end_lap_joint_short",
        "flange_weldneck", "flange_slip_on", "flange_blind",
        "flange_socket_weld", "flange_threaded", "flange_lap_joint",
        "flange_orifice", "flange_reducing",
    ],
    "structural_connectors": [
        "post_base_pb44", "post_base_pb66", "post_cap_lpc4", "post_cap_lpc6",
        "joist_hanger_lus26", "joist_hanger_lus28", "joist_hanger_lus210",
        "joist_hanger_ius", "top_flange_hanger", "skewable_hanger",
        "hurricane_tie_h1", "hurricane_tie_h2_5", "hurricane_tie_h10",
        "hold_down_hd2_5a", "hold_down_hd5a", "hold_down_hd8a",
        "tension_tie_mstc28", "tension_tie_mstc40",
        "angle_clip_a23", "angle_clip_a35", "angle_clip_a66",
        "column_cap_cc64", "column_cap_cc66",
        "beam_seat_bs3", "beam_seat_bs4", "beam_seat_bs6",
        "strap_tie_cs20", "strap_tie_msp", "strap_tie_sthd10",
        "shear_plate_sds", "shear_plate_sdw",
        "split_ring_connector", "shear_plate_connector",
        "toothed_plate_connector",
        "knee_brace_kb", "x_brace_body",
        "moment_plate_body", "continuity_plate_body",
        "stiffener_plate_body", "cope_plate_body",
    ],
    "civil_anchor_systems": [
        "headed_stud_anchor", "headed_bolt_anchor_f1554",
        "j_bolt_anchor", "l_bolt_anchor", "u_bolt_foundation",
        "plate_washer_anchor", "leveling_nut_anchor",
        "epoxy_anchor_threaded_rod", "epoxy_anchor_rebar",
        "expansion_anchor_wedge", "expansion_anchor_sleeve",
        "expansion_anchor_drop_in", "expansion_anchor_self_drill",
        "undercut_anchor_body", "chemical_capsule_anchor",
        "screw_anchor_concrete", "nail_anchor_concrete",
        "cast_in_insert_threaded", "cast_in_channel_b_series",
        "cast_in_channel_t_series", "cast_in_plate_flush",
        "post_installed_rebar_coupler",
        "anchor_plate_square", "anchor_plate_round",
        "column_base_plate_blank", "base_plate_leveling_blank",
    ],
    "rebar_concrete": [
        "rebar_no3", "rebar_no4", "rebar_no5", "rebar_no6",
        "rebar_no7", "rebar_no8", "rebar_no9", "rebar_no10",
        "rebar_no11", "rebar_no14", "rebar_no18",
        "rebar_hook_90", "rebar_hook_135", "rebar_hook_180",
        "rebar_stirrup_rectangular", "rebar_stirrup_circular",
        "rebar_spiral_helix", "rebar_spiral_closed",
        "headed_rebar_forged", "headed_rebar_welded",
        "rebar_coupler_mechanical", "rebar_coupler_lap",
        "wire_mesh_sheet_standard", "wire_mesh_roll_standard",
        "deformed_wire_d_series",
        "prestress_strand_7_wire", "prestress_bar_smooth",
        "post_tension_duct_corrugated", "post_tension_anchor_plate",
        "post_tension_wedge", "post_tension_coupler",
    ],
    "marine_hardware": [
        "deck_cleat_2_hole", "deck_cleat_4_hole", "dock_cleat_body",
        "bow_cleat", "stern_cleat", "midship_cleat",
        "chock_open_body", "chock_closed_body", "fairlead_body",
        "bollard_single", "bollard_double", "bollard_cross",
        "mooring_ring_cast", "mooring_ring_forged", "pad_eye_plate",
        "pad_eye_tube", "padeye_cheek_plate", "backing_plate_marine",
        "chainplate_flat", "chainplate_strap", "toggleplate",
        "shackle_bow_anchor", "shackle_dee_anchor",
        "shackle_bow_safety", "shackle_dee_safety",
        "turnbuckle_body_body", "turnbuckle_eye_jaw", "turnbuckle_jaw_jaw",
        "rigging_screw_body_body", "rigging_screw_eye_fork",
        "clevis_fork_body", "clevis_eye_body",
        "swivel_eye_eye", "swivel_jaw_jaw", "swivel_eye_jaw",
        "snap_hook_body", "pelican_hook_body",
        "thimble_round", "thimble_oval", "thimble_open",
        "wire_rope_clip_u_bolt",
    ],
    "marine_structural": [
        "hull_frame_transverse_blank", "hull_frame_longitudinal_blank",
        "hull_stringer_flat_bar", "hull_stringer_angle",
        "keel_plate_blank", "keel_bar_blank",
        "bilge_keel_blank", "bilge_keel_bracket",
        "deck_plate_blank", "deck_beam_blank", "deck_longitudinal",
        "bulkhead_plate_blank", "bulkhead_stiffener",
        "web_frame_blank", "floor_plate_blank",
        "rudder_stock_blank", "rudder_plate_blank",
        "rudder_horn_blank", "skeg_blank",
        "propeller_hub_blank", "propeller_blade_blank",
        "propeller_cap_blank", "propeller_keyway_blank",
        "shaft_bracket_a_frame", "shaft_bracket_strut",
        "stern_tube_outer", "stern_tube_inner",
        "sea_chest_blank", "kingston_valve_body",
        "sea_strainer_body", "overboard_discharge_body",
    ],
    "mining_ground_engagement": [
        "bucket_tooth_j_series", "bucket_tooth_v_series", "bucket_tooth_k_series",
        "adapter_nose_j250", "adapter_nose_j300", "adapter_nose_j400",
        "adapter_nose_j460", "adapter_nose_j550",
        "lip_shroud_flat", "lip_shroud_strap",
        "cutting_edge_flat", "cutting_edge_bolt_on",
        "side_cutter_left", "side_cutter_right",
        "corner_segment_left", "corner_segment_right",
        "end_bit_flat", "end_bit_carbide",
        "center_bit_blank", "grader_blade_blank",
        "scraper_blade_blank", "wear_liner_blank",
        "bucket_sidebar_blank", "bucket_backwall_blank",
        "bucket_floor_blank", "hinge_pin_bucket",
        "pin_retainer_blank", "nose_pin_blank",
        "hammer_tip_blank", "chisel_tool_blank",
        "moil_point_blank", "pyramidal_point_blank",
        "conical_bit_body", "disc_cutter_ring",
    ],
    "mining_crushing": [
        "jaw_plate_fixed", "jaw_plate_swing",
        "cheek_plate_left", "cheek_plate_right",
        "toggle_plate_blank", "toggle_seat_blank",
        "pitman_arm_blank", "eccentric_shaft_blank",
        "flywheel_crusher_blank", "pulley_crusher_blank",
        "mantle_standard", "mantle_xtreme",
        "concave_upper", "concave_lower", "concave_feed_plate",
        "spider_cap_blank", "spider_bushing_blank",
        "main_shaft_blank", "eccentric_bushing_blank",
        "head_bushing_blank", "socket_liner_blank",
        "screen_deck_panel_wire", "screen_deck_panel_poly",
        "screen_deck_panel_rubber", "screen_frame_blank",
        "vibrator_shaft_blank", "exciter_blank",
        "spring_suspension_crusher", "rubber_mount_crusher",
        "impactor_blow_bar", "impactor_rotor_blank",
        "impactor_anvil_blank", "impactor_apron_blank",
        "hammer_mill_hammer", "hammer_mill_rotor",
        "roll_crusher_roll", "roll_crusher_shell",
    ],
    "conveyor_systems": [
        "drive_pulley_blank", "tail_pulley_blank", "bend_pulley_blank",
        "snub_pulley_blank", "take_up_pulley_blank",
        "wing_pulley_blank", "spiral_pulley_blank",
        "pulley_shell_welded", "pulley_end_disc", "pulley_hub_key",
        "troughing_idler_35deg", "troughing_idler_45deg", "flat_return_idler",
        "impact_idler_roll", "self_cleaning_idler", "disc_idler_blank",
        "training_idler_body", "guide_idler_body",
        "idler_frame_carry", "idler_frame_return",
        "belt_cleaner_primary_blade", "belt_cleaner_secondary_blade",
        "belt_cleaner_tensioner", "belt_cleaner_mainframe",
        "skirt_board_rubber", "skirt_board_clamp",
        "impact_pad_rubber", "trough_liner_rubber",
        "transition_chute_blank", "transfer_chute_blank",
        "conveyor_stringer_blank", "cross_member_blank",
        "catenary_idler_blank", "garland_idler_blank",
        "belt_fastener_plate", "belt_fastener_bolt",
        "belt_repair_patch", "belt_vulcanizer_plate",
    ],
    "medical_ortho_implants": [
        "hip_stem_straight", "hip_stem_anatomic", "hip_stem_revision",
        "hip_stem_cemented", "hip_stem_cementless",
        "femoral_head_28mm", "femoral_head_32mm", "femoral_head_36mm",
        "femoral_head_40mm", "femoral_neck_offset_standard",
        "acetabular_cup_press_fit", "acetabular_cup_cemented",
        "acetabular_liner_pe", "acetabular_liner_ceramic",
        "tibial_tray_primary", "tibial_tray_revision",
        "tibial_insert_pe", "tibial_insert_mobile",
        "femoral_component_posterior_stabilized", "femoral_component_cruciate_retaining",
        "patellar_button_dome", "patellar_button_anatomic",
        "pedicle_screw_monoaxial", "pedicle_screw_polyaxial",
        "pedicle_screw_uniplanar", "pedicle_screw_reduction",
        "spinal_rod_round", "spinal_rod_contoured",
        "spinal_cage_peek", "spinal_cage_titanium",
        "vertebral_body_replacement_blank",
        "bone_plate_lcp_broad", "bone_plate_lcp_narrow",
        "bone_plate_dcp", "bone_plate_lc_dcp",
        "bone_screw_cortical", "bone_screw_cancellous",
        "bone_screw_locking", "bone_screw_cannulated",
        "intramedullary_nail_tibia", "intramedullary_nail_femur",
        "intramedullary_nail_humerus", "intramedullary_nail_cephalomedullary",
        "compression_hip_screw_blade", "trochanteric_nail_body",
    ],
    "medical_instruments": [
        "trocar_tip_sharp", "trocar_tip_bladeless", "trocar_tip_optical",
        "cannula_threaded", "cannula_smooth", "cannula_hasson",
        "retractor_blade_flat", "retractor_blade_angled",
        "retractor_blade_ribbon", "retractor_handle_body",
        "rongeur_jaw_straight", "rongeur_jaw_angled",
        "bone_chisel_flat", "bone_chisel_curved",
        "osteotome_flat", "osteotome_curved",
        "curette_sharp_spoon", "curette_dull_spoon",
        "forceps_tip_smooth", "forceps_tip_serrated",
        "needle_holder_jaw_standard", "needle_holder_jaw_tungsten",
        "scissors_blade_straight", "scissors_blade_curved",
        "hook_probe_body", "probe_ball_end",
        "suture_anchor_screw_in", "suture_anchor_push_in",
        "bone_anchor_rotator_cuff", "interference_screw_body",
        "drill_guide_body", "drill_stop_body",
        "depth_gauge_ortho_body", "torque_wrench_body_medical",
        "awl_pointed_body", "tamp_impactor_body",
    ],
    "consumer_enclosures": [
        "snap_latch_male", "snap_latch_female", "cantilever_snap_hook",
        "annular_snap_ring_feature", "torsion_snap_feature",
        "living_hinge_thin_wall", "integral_hinge_flat",
        "boss_round_screw", "boss_hex_insert", "boss_self_tap",
        "snap_fit_receiver", "snap_fit_clip",
        "locating_pin_tapered", "locating_pin_diamond",
        "locating_pin_round", "locating_pin_straight",
        "rib_straight", "rib_cross_pattern", "rib_web",
        "gusset_corner", "gusset_wall", "draft_rib",
        "drain_hole_feature", "vent_hole_feature", "witness_pad",
        "gate_vestige_pad", "ejector_pin_mark", "parting_line_feature",
        "textured_surface_blank", "embossed_logo_blank",
        "rubber_overmold_grip", "soft_touch_inlay",
        "cable_clip_single", "cable_clip_multiple",
        "strain_relief_body", "grommet_body",
        "push_in_rivet_body", "christmas_tree_clip",
        "quarter_turn_fastener_body", "bayonet_lock_body",
    ],
    "furniture_hardware": [
        "cam_lock_disc", "cam_lock_dowel", "cam_lock_connector",
        "barrel_nut_m6", "barrel_nut_m8", "barrel_nut_m10",
        "euro_screw_5mm", "euro_screw_7mm",
        "shelf_pin_standard", "shelf_pin_spoon", "shelf_pin_keyhole",
        "leveling_foot_adjustable", "leveling_foot_swivel",
        "caster_swivel_plate", "caster_fixed_plate", "caster_wheel_blank",
        "drawer_slide_inner_channel", "drawer_slide_outer_channel",
        "drawer_runner_bottom", "drawer_runner_side",
        "door_hinge_leaf_standard", "door_hinge_leaf_wide",
        "concealed_hinge_cup_35mm", "concealed_hinge_cup_26mm",
        "concealed_hinge_arm_standard", "concealed_hinge_arm_wide",
        "magnetic_catch_body", "magnetic_catch_plate",
        "ball_catch_body", "roller_catch_body",
        "door_stop_floor", "door_stop_wall",
        "cabinet_knob_blank", "cabinet_pull_blank",
        "drawer_handle_blank", "drop_pull_blank",
        "t_nut_furniture", "cross_dowel_furniture",
        "confirmat_screw_blank", "minifix_cap", "minifix_bolt",
    ],
    "optical_photonic": [
        "lens_cell_singlet", "lens_cell_doublet", "lens_cell_triplet",
        "lens_retainer_threaded", "lens_retainer_snap",
        "lens_spacer_ring", "lens_separator_ring",
        "prism_mount_right_angle", "prism_mount_dove",
        "prism_mount_penta", "prism_mount_wedge",
        "mirror_mount_kinematic", "mirror_mount_fixed", "mirror_mount_tip_tilt",
        "beamsplitter_cube_mount_body", "beamsplitter_plate_mount",
        "filter_holder_square", "filter_holder_round",
        "filter_wheel_body", "filter_slide_body",
        "rotation_stage_body", "goniometer_body",
        "translation_stage_x", "translation_stage_xy", "translation_stage_xyz",
        "optical_rail_body", "optical_rail_carrier",
        "post_holder_body", "post_body", "post_base_plate",
        "breadboard_insert_metric", "breadboard_insert_imperial",
        "kinematic_mount_three_point", "kinematic_mount_six_point",
        "v_groove_mount_body", "dovetail_mount_optical",
        "fiber_coupler_body", "fiber_collimator_body",
        "beam_expander_body", "beam_splitter_cube_blank",
        "polarizer_mount_body", "waveplate_mount_body",
    ],
    "mems_microelectronics": [
        "ic_package_dip8", "ic_package_dip14", "ic_package_dip16",
        "ic_package_dip28", "ic_package_dip40",
        "ic_package_soic8", "ic_package_soic14", "ic_package_soic16",
        "ic_package_qfp44", "ic_package_qfp64", "ic_package_qfp100",
        "ic_package_bga84", "ic_package_bga144", "ic_package_bga256",
        "ic_package_bga484", "ic_package_bga676",
        "ic_package_dfn6", "ic_package_dfn8", "ic_package_dfn10",
        "ic_package_sot23_3", "ic_package_sot23_5", "ic_package_sot223",
        "ic_package_dpak", "ic_package_d2pak", "ic_package_to220",
        "ic_package_to247", "ic_package_to3",
        "wire_bond_wedge_pad", "wire_bond_ball_pad",
        "flip_chip_c4_bump", "flip_chip_cu_pillar",
        "through_silicon_via_body", "interposer_blank",
        "mems_membrane_circular", "mems_membrane_square",
        "mems_cantilever_blank", "mems_bridge_blank",
        "mems_comb_drive_blank", "mems_resonator_disc",
        "microfluidic_channel_straight", "microfluidic_channel_curved",
        "microchannel_heat_exchanger_blank", "microlens_array_blank",
    ],
    "textile_machinery": [
        "loom_heddle_wire", "loom_heddle_flat_steel",
        "warp_beam_flange_blank", "warp_beam_tube_blank",
        "weft_bobbin_body", "weft_pirn_body",
        "spindle_whorl_flat", "spindle_whorl_crowned",
        "ring_traveler_c_section", "ring_rail_body",
        "separator_comb_body", "lease_rod_body",
        "drop_wire_body", "heddle_frame_top_rail", "heddle_frame_side_stave",
        "guide_bar_hook_warp_knit", "needle_hook_latch_knit",
        "sinker_plate_weft_knit", "jack_body_knit",
        "cam_track_body_knit", "cylinder_body_knit",
        "dial_body_knit", "take_down_roller",
        "pressing_foot_blank", "feed_roller_blank",
        "winding_traverse_cam", "bobbin_holder_cone",
        "yarn_guide_eyelet", "yarn_tensioner_disc",
        "yarn_cleaner_blade", "splicer_chamber_blank",
        "reed_blade", "reed_frame_blank",
        "beater_sley_blank", "sword_arm_blank",
        "treadle_blank", "lamm_blank",
    ],
    "additive_manufacturing": [
        "fdm_nozzle_body", "fdm_heat_break_body", "fdm_heat_block_body",
        "fdm_heat_sink_body", "fdm_extruder_gear_body", "fdm_extruder_arm",
        "fdm_fan_duct_blank", "fdm_hot_end_assembly_blank",
        "fdm_build_plate_blank", "fdm_clip_blank",
        "sla_vat_blank", "sla_platform_blank", "sla_build_tank_blank",
        "sls_powder_roller_blank", "sls_feed_piston_blank",
        "dmls_build_plate_blank", "dmls_support_structure_blank",
        "binder_jet_print_head_blank", "binder_jet_roller_blank",
        "post_process_support_break_off", "post_process_support_soluble",
        "print_bed_spring_mount", "print_bed_leveling_knob",
        "enclosure_panel_blank", "filament_runout_sensor_body",
        "filament_guide_tube", "bowden_coupler_body",
        "direct_drive_mount_blank", "dual_extruder_mount_blank",
    ],
    "energy_solar": [
        "solar_panel_frame_long", "solar_panel_frame_short",
        "solar_panel_end_clamp", "solar_panel_mid_clamp",
        "solar_rail_blank", "solar_splice_bar",
        "solar_l_foot_blank", "solar_t_foot_blank",
        "solar_hook_tile_blank", "solar_hook_seam_blank",
        "solar_grounding_lug", "solar_bonding_jumper",
        "microinverter_bracket", "optimizer_bracket",
        "junction_box_blank", "conduit_entry_fitting",
        "tracker_drive_shaft_blank", "tracker_torque_tube_blank",
        "tracker_bearing_block_blank", "tracker_motor_mount_blank",
        "wind_turbine_hub_blank", "wind_turbine_nacelle_blank",
        "wind_turbine_yaw_ring_blank", "wind_turbine_pitch_ring_blank",
        "wind_turbine_main_shaft_blank", "wind_turbine_gearbox_blank",
        "wind_turbine_generator_blank",
        "hydro_runner_kaplan_blade", "hydro_runner_francis_blade",
        "hydro_runner_pelton_bucket", "hydro_nozzle_body",
        "tidal_turbine_blade_blank", "wave_energy_float_blank",
    ],
    "energy_nuclear": [
        "fuel_rod_cladding_tube", "fuel_pellet_blank", "fuel_assembly_spacer_grid",
        "fuel_assembly_end_fitting_top", "fuel_assembly_end_fitting_bottom",
        "control_rod_blank", "control_rod_drive_mechanism_blank",
        "reactor_pressure_vessel_blank", "reactor_head_blank",
        "steam_generator_tube_blank", "steam_generator_shell_blank",
        "pressurizer_body_blank", "surge_line_blank",
        "primary_pump_impeller_blank", "primary_pump_casing_blank",
        "reactor_coolant_pipe_blank", "hot_leg_nozzle_blank",
        "cold_leg_nozzle_blank", "nozzle_safe_end_blank",
        "incore_instrument_tube_blank", "thermocouple_well_blank",
        "crdm_nozzle_blank", "crdm_housing_blank",
        "core_support_blank", "baffle_plate_blank", "former_plate_blank",
        "shroud_cylinder_blank", "core_barrel_blank",
    ],
    "oil_gas_upstream": [
        "drill_collar_blank", "drill_pipe_blank",
        "tool_joint_pin", "tool_joint_box",
        "stabilizer_blade_blank", "stabilizer_body_blank",
        "roller_cone_bit_cone", "roller_cone_bit_body",
        "pdc_bit_body", "pdc_cutter_blank",
        "mud_motor_rotor_blank", "mud_motor_stator_blank",
        "mwd_tool_body_blank", "lwd_tool_body_blank",
        "rotary_steerable_bias_unit_blank",
        "wellhead_body_blank", "christmas_tree_body_blank",
        "bop_body_blank", "annular_bop_piston_blank",
        "ram_bop_body_blank", "ram_bop_piston_blank",
        "wellhead_connector_body_blank",
        "production_tubing_blank", "production_casing_blank",
        "liner_hanger_body_blank", "liner_top_packer_blank",
        "production_packer_body_blank", "retrievable_packer_blank",
        "perforating_gun_body_blank", "perforating_charge_blank",
    ],
    "oil_gas_processing": [
        "pressure_vessel_shell_blank", "pressure_vessel_head_hemi",
        "pressure_vessel_head_2_1_ellip", "pressure_vessel_head_flat",
        "pressure_vessel_nozzle_blank",
        "heat_exchanger_shell_blank", "heat_exchanger_channel_blank",
        "heat_exchanger_tube_sheet_blank", "heat_exchanger_baffle_blank",
        "heat_exchanger_tube_bundle_blank",
        "column_shell_blank", "column_tray_blank",
        "column_downcomer_blank", "column_weir_blank",
        "column_distributor_blank", "column_packing_random",
        "column_packing_structured",
        "separator_inlet_device_blank", "separator_vane_pack_blank",
        "separator_mist_eliminator_blank", "separator_sump_blank",
        "fired_heater_tube_blank", "fired_heater_radiant_coil_blank",
        "fired_heater_convection_coil_blank",
        "compressor_impeller_centrifugal_blank",
        "compressor_diffuser_blank", "compressor_volute_blank",
        "compressor_diaphragm_blank", "compressor_labyrinth_seal_blank",
    ],
    "semiconductor_equipment": [
        "wafer_chuck_blank", "wafer_ring_frame_blank",
        "end_effector_fork_ceramic", "end_effector_fork_carbon",
        "edge_grip_finger_blank", "bernoulli_chuck_blank",
        "vacuum_chuck_grooved_blank", "e_chuck_blank",
        "process_chamber_body_blank", "process_chamber_lid_blank",
        "showerhead_blank", "susceptor_blank", "shadow_ring_blank",
        "focus_ring_blank", "edge_ring_blank", "liner_chamber_blank",
        "gas_distribution_ring_blank", "electrode_upper_blank",
        "electrode_lower_blank", "rf_feed_blank",
        "load_lock_body_blank", "transfer_chamber_blank",
        "robot_frog_leg_link", "robot_scara_link_blank",
        "wafer_boat_blank", "wafer_cassette_blank",
        "photomask_blank", "reticle_blank", "reticle_pod_blank",
        "pellicle_frame_blank", "alignment_mark_blank",
        "etch_mask_blank", "cmp_platen_blank", "cmp_head_blank",
    ],
    "food_processing": [
        "mixing_impeller_axial", "mixing_impeller_radial", "mixing_impeller_anchor",
        "mixing_impeller_helical_ribbon", "mixing_impeller_gate",
        "mixing_shaft_blank", "mixing_tank_blank", "baffled_tank_blank",
        "homogenizer_valve_body", "homogenizer_valve_seat",
        "pump_impeller_sanitary", "pump_casing_sanitary",
        "tri_clamp_fitting_blank", "dairy_valve_body",
        "butterfly_valve_sanitary_disc", "ball_valve_sanitary_body",
        "scraped_surface_heat_exchanger_blank",
        "plate_heat_exchanger_sanitary_blank",
        "tubular_heat_exchanger_sanitary_blank",
        "spray_nozzle_full_cone", "spray_nozzle_flat_fan",
        "spray_nozzle_hollow_cone",
        "screw_conveyor_flight_blank", "screw_conveyor_shaft_blank",
        "bucket_elevator_cup_blank", "vibratory_feeder_tray_blank",
        "extruder_screw_food_blank", "extruder_die_food_blank",
        "granulator_screen_blank", "granulator_knife_blank",
        "classifier_wheel_blank", "cyclone_separator_cone_blank",
    ],
    "agricultural_machinery": [
        "planter_disc_opener", "planter_press_wheel", "planter_closing_wheel",
        "planter_seed_tube_guard", "planter_row_unit_frame",
        "planter_seed_disc", "planter_finger_pickup",
        "tine_straight", "tine_curved", "tine_spring_loaded",
        "cultivator_sweep", "cultivator_duck_foot",
        "disc_blade_plain", "disc_blade_notched", "disc_blade_wavy",
        "disc_gang_bearing_box", "disc_gang_axle",
        "furrow_opener_hoe", "furrow_opener_disc_single", "furrow_opener_disc_double",
        "sowing_coulter_disc", "sowing_coulter_hoe",
        "combine_threshing_bar", "combine_rasp_bar",
        "combine_concave_bar", "combine_concave_frame",
        "chopper_blade_combine", "spreader_disc_combine",
        "grain_auger_flight", "grain_auger_tube",
        "header_reel_bat", "header_reel_arm",
        "baler_pickup_tine", "baler_twine_needle",
        "sprayer_nozzle_boom", "sprayer_boom_section",
        "harvester_knife_section", "harvester_guard_finger",
    ],
    "robotics_advanced": [
        "harmonic_flex_spline_advanced", "harmonic_circular_spline",
        "harmonic_wave_generator_advanced",
        "cycloidal_pin_housing", "cycloidal_input_shaft",
        "cycloidal_roller_pin", "cycloidal_disc",
        "joint_link_revolute", "joint_link_prismatic",
        "serial_arm_link_1dof", "serial_arm_link_2dof",
        "parallel_robot_strut_blank",
        "delta_robot_forearm_blank", "delta_robot_upper_arm_blank",
        "stewart_platform_leg_blank", "stewart_platform_top_plate",
        "cable_driven_robot_drum", "cable_driven_robot_guide",
        "flexible_robot_backbone", "continuum_robot_disc",
        "soft_robot_bellow_chamber", "pneumatic_artificial_muscle",
        "hydraulic_exo_cylinder_blank", "exo_joint_frame_blank",
        "force_torque_sensor_body", "tactile_sensor_blank",
        "lidar_mirror_blank", "camera_gimbal_body",
        "drone_arm_blank", "drone_motor_mount_blank",
        "drone_landing_leg_blank", "drone_prop_guard_blank",
        "quadruped_leg_upper", "quadruped_leg_lower",
        "bipedal_foot_blank", "bipedal_ankle_blank",
    ],
    "pneumatic_components": [
        "pneumatic_cylinder_standard_body", "pneumatic_cylinder_compact_body",
        "pneumatic_cylinder_rodless_body", "pneumatic_cylinder_guided_body",
        "pneumatic_cylinder_rotary_body",
        "air_gripper_body_parallel", "air_gripper_body_angular",
        "air_gripper_body_three_jaw",
        "air_bearing_pad_flat", "air_bearing_pad_radial",
        "pneumatic_slide_table_blank", "pneumatic_rotary_table_blank",
        "solenoid_valve_body_2_2", "solenoid_valve_body_3_2",
        "solenoid_valve_body_5_2", "solenoid_valve_body_5_3",
        "pneumatic_frl_filter_body", "pneumatic_frl_regulator_body",
        "pneumatic_frl_lubricator_body",
        "quick_exhaust_valve_body", "flow_control_valve_body",
        "check_valve_pneumatic_body", "shuttle_valve_body",
        "pressure_switch_body", "pressure_regulator_dome",
        "manifold_pneumatic_blank", "sub_base_valve_blank",
        "push_in_fitting_body", "push_in_elbow_body",
        "push_in_tee_body", "push_in_y_body",
        "air_nozzle_amplifying", "air_nozzle_flat",
        "vacuum_generator_venturi_body", "vacuum_cup_flat",
        "vacuum_cup_bellows", "vacuum_cup_oval",
    ],
    "hydraulic_components": [
        "hydraulic_motor_gerotor_body", "hydraulic_motor_axial_piston_body",
        "hydraulic_motor_radial_piston_body",
        "hydraulic_pump_gear_body", "hydraulic_pump_vane_body",
        "hydraulic_pump_axial_piston_body", "hydraulic_pump_bent_axis_body",
        "hydraulic_pump_radial_piston_body",
        "directional_valve_body_4_2", "directional_valve_body_4_3",
        "directional_valve_body_6_2", "directional_valve_body_6_3",
        "proportional_valve_body_4_2", "proportional_valve_body_4_3",
        "servo_valve_body_4_2", "servo_valve_body_4_3",
        "pressure_relief_valve_body", "pressure_reducing_valve_body",
        "sequence_valve_body", "counterbalance_valve_body",
        "flow_control_valve_hydraulic_body", "flow_divider_body",
        "check_valve_hydraulic_body", "pilot_operated_check_body",
        "manifold_hydraulic_blank", "manifold_block_integrated",
        "hydraulic_accumulator_bladder_shell", "hydraulic_accumulator_piston_shell",
        "hydraulic_accumulator_diaphragm_shell",
        "hydraulic_tank_blank", "hydraulic_filter_housing_blank",
        "hydraulic_cooler_blank", "hydraulic_heat_exchanger_blank",
        "hydraulic_cylinder_tie_rod_blank", "hydraulic_cylinder_welded_blank",
    ],
    "electrical_distribution": [
        "busbar_flat_rectangular", "busbar_flat_edgewise",
        "busbar_laminated_blank", "busbar_flexible_blank",
        "current_transformer_core_blank", "current_transformer_housing",
        "potential_transformer_core_blank", "potential_transformer_housing",
        "switchgear_enclosure_blank", "switchgear_busbar_support",
        "circuit_breaker_case_blank", "molded_case_frame_blank",
        "contactor_body_blank", "relay_body_blank",
        "terminal_block_single_level", "terminal_block_two_level",
        "terminal_block_three_level", "terminal_block_fused",
        "din_rail_top_hat", "din_rail_c_section", "din_rail_g_section",
        "cable_duct_body", "cable_duct_lid",
        "conduit_body_ll", "conduit_body_lr", "conduit_body_t",
        "cable_gland_metric", "cable_gland_pg",
        "earthing_bar_blank", "earthing_clamp_body",
        "lightning_arrester_body_blank", "surge_arrester_housing",
        "transformer_core_ei_blank", "transformer_core_uu_blank",
        "transformer_core_toroid_blank",
        "motor_stator_core_blank", "motor_rotor_core_blank",
        "alternator_rotor_salient_pole", "generator_stator_blank",
    ],
    "packaging_machinery": [
        "filling_nozzle_body", "filling_valve_body",
        "capping_head_blank", "sealing_jaw_blank",
        "form_fill_seal_former_blank", "forming_collar_blank",
        "cutting_blade_packaging", "perforation_blade_packaging",
        "crimping_jaw_blank", "embossing_die_blank",
        "label_applicator_pad_blank", "label_applicator_brush_blank",
        "conveyor_side_guide_blank", "star_wheel_blank",
        "timing_screw_blank", "gripper_clamp_packaging",
        "suction_cup_packaging_blank", "pick_place_head_blank",
        "tray_former_plate_blank", "box_former_plate_blank",
        "glue_nozzle_body_packaging", "glue_wheel_blank",
        "shrink_tunnel_body_blank", "heat_gun_body_blank",
        "wrapping_roll_blank", "slitting_knife_packaging",
        "scoring_wheel_blank", "creasing_matrix_blank",
        "vacuum_drum_blank", "suction_drum_blank",
    ],
    "printing_paper": [
        "printing_cylinder_blank", "inking_roller_blank",
        "dampening_roller_blank", "transfer_roller_blank",
        "anilox_roller_blank", "doctor_blade_holder",
        "doctor_blade_packaging", "impression_cylinder_blank",
        "pressure_roller_blank", "nip_roller_blank",
        "guide_roller_blank", "tension_roller_blank",
        "spreader_roller_blank", "decurling_roller_blank",
        "web_guide_roller_blank", "web_guide_sensor_mount",
        "paper_cutter_blade_long", "paper_cutter_blade_short",
        "perforator_blade_rotary", "scoring_wheel_paper",
        "folding_plate_blank", "buckle_folder_plate_blank",
        "saddle_stitcher_jaw_blank", "perfect_binder_nip_blank",
        "laminating_roll_blank", "die_cutter_anvil_blank",
        "embossing_roll_blank", "foil_stamping_die_blank",
        "screen_printing_frame_blank", "squeegee_holder_blank",
    ],
    "glass_ceramics": [
        "glass_mold_body_blank", "glass_mold_neck_ring_blank",
        "glass_mold_bottom_plate_blank", "glass_mold_baffle_blank",
        "glass_press_plunger_blank", "glass_press_ring_blank",
        "glass_former_blank", "glass_take_out_tong_blank",
        "ceramic_die_blank", "ceramic_press_punch_blank",
        "ceramic_press_die_blank", "ceramic_isostatic_mold_blank",
        "kiln_furniture_post", "kiln_furniture_bat",
        "kiln_furniture_ring", "kiln_furniture_setter",
        "extrusion_die_ceramic_blank", "die_plate_ceramic_blank",
        "slip_casting_mold_blank", "jigger_profile_blank",
        "glazing_tong_blank", "stacking_spacer_blank",
        "furnace_tube_blank", "thermocouple_protection_tube",
        "radiant_tube_blank", "muffle_blank",
        "crucible_blank", "saggar_blank", "boat_blank",
    ],
    "rubber_plastics": [
        "injection_mold_core_blank", "injection_mold_cavity_blank",
        "injection_mold_runner_blank", "injection_mold_gate_blank",
        "injection_mold_sprue_bush", "injection_mold_locating_ring",
        "injection_mold_ejector_pin", "injection_mold_return_pin",
        "injection_mold_slide_blank", "injection_mold_lifter_blank",
        "compression_mold_top_half", "compression_mold_bottom_half",
        "transfer_mold_pot_blank", "blow_mold_half_blank",
        "blow_mold_neck_blank", "blow_mold_pinch_off_blank",
        "extrusion_die_plastic_blank", "extrusion_sizing_die_blank",
        "extrusion_calibration_die_blank", "extrusion_strand_die_blank",
        "thermoform_mold_blank", "thermoform_plug_blank",
        "rotomold_mold_blank",
        "rubber_mold_cavity_blank", "rubber_mold_core_blank",
        "rubber_extrusion_die_blank", "rubber_calender_roll_blank",
        "rubber_vulcanization_press_platen",
    ],
}


def _register_extra_shapes(extra_cats: dict, all_variants: list) -> None:
    for _names in extra_cats.values():
        for _n in _names:
            if _n not in BASE_SHAPE_PROFILES:
                BASE_SHAPE_PROFILES[_n] = _infer_profile(_n)

    for _shape_name, _profile in list(BASE_SHAPE_PROFILES.items()):
        if _shape_name in SHAPE_FN_EXTENDED:
            continue
        _primitive = _profile["primitive"]
        _builder = PRIMITIVE_BUILDERS[_primitive]
        _defaults = dict(_profile["defaults"])
        _required = list(_profile["required_dims"])
        SHAPE_FN_EXTENDED[_shape_name] = _make_generator(_builder, _defaults, 1.0)
        GEO_REQUIRED_DIMS[_shape_name] = _required
        GEO_DEFAULTS[_shape_name] = _defaults
        SHAPE_ALIASES_EXTENDED[_shape_name.replace("-", "_")] = _shape_name
        SHAPE_ALIASES_EXTENDED[_shape_name.replace("_", "-")] = _shape_name
        for idx, suffix in enumerate(all_variants, start=1):
            variant_name = f"{_shape_name}_{suffix}"
            if variant_name not in SHAPE_FN_EXTENDED:
                scale = 0.75 + idx * 0.04
                SHAPE_FN_EXTENDED[variant_name] = _make_generator(_builder, _defaults, scale)
                GEO_REQUIRED_DIMS[variant_name] = _required
                GEO_DEFAULTS[variant_name] = dict(_defaults)
                SHAPE_ALIASES_EXTENDED[variant_name.replace("-", "_")] = variant_name
                SHAPE_ALIASES_EXTENDED[variant_name.replace("_", "-")] = variant_name


_register_extra_shapes(_EXTRA_CATEGORIES, _ALL_VARIANTS)


# ─── Extended parametric families (5001–25000) ────────────────────────────────
# Each family gets a primitive hint so dims make physical sense.

_PARAMETRIC_FAMILIES = [
    ("mech_blank",    "box",      {"x": 60,  "y": 40, "z": 30}),
    ("struct_bar",    "cylinder", {"diameter": 20, "length": 200}),
    ("fluid_comp",    "housing",  {"x": 80,  "y": 60, "z": 50, "wall": 4}),
    ("seal_comp",     "ring",     {"inner_diameter": 30, "cross_section": 4}),
    ("trans_gear",    "gear",     {"module": 2.0, "num_teeth": 24, "face_width": 18}),
    ("aero_body",     "blade",    {"length": 120, "max_chord": 28, "thickness": 4}),
    ("elec_body",     "housing",  {"x": 100, "y": 80, "z": 40, "wall": 3}),
    ("robo_link",     "bracket",  {"width": 70, "height": 50, "depth": 40, "thickness": 5}),
    ("thermal_part",  "plate",    {"width": 120, "depth": 90, "thickness": 10}),
    ("pipe_comp",     "tube",     {"outer_diameter": 40, "length": 100, "wall": 3}),
]

for _fam_idx in range(5001, 25001):
    _fam_key, _fam_prim, _fam_defs = _PARAMETRIC_FAMILIES[_fam_idx % len(_PARAMETRIC_FAMILIES)]
    _shape_name = f"{_fam_key}_{_fam_idx:05d}"
    if _shape_name not in BASE_SHAPE_PROFILES:
        BASE_SHAPE_PROFILES[_shape_name] = {
            "primitive": _fam_prim,
            "required_dims": list(_fam_defs.keys()),
            "defaults": dict(_fam_defs),
        }

_register_extra_shapes(
    {v[0]: [f"{v[0]}_{i:05d}" for i in range(5001, 25001) if i % len(_PARAMETRIC_FAMILIES) == idx]
     for idx, v in enumerate(_PARAMETRIC_FAMILIES)},
    _ALL_VARIANTS,
)


# Additional additive pass (25001-50000) to grow the registry further
# without replacing earlier shape banks.
for _fam_idx in range(25001, 50001):
    _fam_key, _fam_prim, _fam_defs = _PARAMETRIC_FAMILIES[_fam_idx % len(_PARAMETRIC_FAMILIES)]
    _shape_name = f"{_fam_key}_{_fam_idx:05d}"
    if _shape_name not in BASE_SHAPE_PROFILES:
        BASE_SHAPE_PROFILES[_shape_name] = {
            "primitive": _fam_prim,
            "required_dims": list(_fam_defs.keys()),
            "defaults": dict(_fam_defs),
        }

_register_extra_shapes(
    {v[0]: [f"{v[0]}_{i:05d}" for i in range(25001, 50001) if i % len(_PARAMETRIC_FAMILIES) == idx]
     for idx, v in enumerate(_PARAMETRIC_FAMILIES)},
    _VARIANTS,
)


# Additional additive pass (50001-75000) for immediate scale-up.
for _fam_idx in range(50001, 75001):
    _fam_key, _fam_prim, _fam_defs = _PARAMETRIC_FAMILIES[_fam_idx % len(_PARAMETRIC_FAMILIES)]
    _shape_name = f"{_fam_key}_{_fam_idx:05d}"
    if _shape_name not in BASE_SHAPE_PROFILES:
        BASE_SHAPE_PROFILES[_shape_name] = {
            "primitive": _fam_prim,
            "required_dims": list(_fam_defs.keys()),
            "defaults": dict(_fam_defs),
        }

_register_extra_shapes(
    {v[0]: [f"{v[0]}_{i:05d}" for i in range(50001, 75001) if i % len(_PARAMETRIC_FAMILIES) == idx]
     for idx, v in enumerate(_PARAMETRIC_FAMILIES)},
    _VARIANTS,
)


# Additional additive pass (75001-100000) for further registry growth.
for _fam_idx in range(75001, 100001):
    _fam_key, _fam_prim, _fam_defs = _PARAMETRIC_FAMILIES[_fam_idx % len(_PARAMETRIC_FAMILIES)]
    _shape_name = f"{_fam_key}_{_fam_idx:05d}"
    if _shape_name not in BASE_SHAPE_PROFILES:
        BASE_SHAPE_PROFILES[_shape_name] = {
            "primitive": _fam_prim,
            "required_dims": list(_fam_defs.keys()),
            "defaults": dict(_fam_defs),
        }

_register_extra_shapes(
    {v[0]: [f"{v[0]}_{i:05d}" for i in range(75001, 100001) if i % len(_PARAMETRIC_FAMILIES) == idx]
     for idx, v in enumerate(_PARAMETRIC_FAMILIES)},
    _VARIANTS,
)


# Additional additive pass (100001-125000) for continued growth.
for _fam_idx in range(100001, 125001):
    _fam_key, _fam_prim, _fam_defs = _PARAMETRIC_FAMILIES[_fam_idx % len(_PARAMETRIC_FAMILIES)]
    _shape_name = f"{_fam_key}_{_fam_idx:05d}"
    if _shape_name not in BASE_SHAPE_PROFILES:
        BASE_SHAPE_PROFILES[_shape_name] = {
            "primitive": _fam_prim,
            "required_dims": list(_fam_defs.keys()),
            "defaults": dict(_fam_defs),
        }

_register_extra_shapes(
    {v[0]: [f"{v[0]}_{i:05d}" for i in range(100001, 125001) if i % len(_PARAMETRIC_FAMILIES) == idx]
     for idx, v in enumerate(_PARAMETRIC_FAMILIES)},
    _VARIANTS,
)


# Additional additive pass (125001-150000) for continued growth.
for _fam_idx in range(125001, 150001):
    _fam_key, _fam_prim, _fam_defs = _PARAMETRIC_FAMILIES[_fam_idx % len(_PARAMETRIC_FAMILIES)]
    _shape_name = f"{_fam_key}_{_fam_idx:05d}"
    if _shape_name not in BASE_SHAPE_PROFILES:
        BASE_SHAPE_PROFILES[_shape_name] = {
            "primitive": _fam_prim,
            "required_dims": list(_fam_defs.keys()),
            "defaults": dict(_fam_defs),
        }

_register_extra_shapes(
    {v[0]: [f"{v[0]}_{i:05d}" for i in range(125001, 150001) if i % len(_PARAMETRIC_FAMILIES) == idx]
     for idx, v in enumerate(_PARAMETRIC_FAMILIES)},
    _VARIANTS,
)


# Additional additive pass (150001-205000) to push total registry beyond 2.5M.
for _fam_idx in range(150001, 205001):
    _fam_key, _fam_prim, _fam_defs = _PARAMETRIC_FAMILIES[_fam_idx % len(_PARAMETRIC_FAMILIES)]
    _shape_name = f"{_fam_key}_{_fam_idx:05d}"
    if _shape_name not in BASE_SHAPE_PROFILES:
        BASE_SHAPE_PROFILES[_shape_name] = {
            "primitive": _fam_prim,
            "required_dims": list(_fam_defs.keys()),
            "defaults": dict(_fam_defs),
        }

_register_extra_shapes(
    {v[0]: [f"{v[0]}_{i:05d}" for i in range(150001, 205001) if i % len(_PARAMETRIC_FAMILIES) == idx]
     for idx, v in enumerate(_PARAMETRIC_FAMILIES)},
    _VARIANTS,
)


# Additional additive pass (205001-255000) to push total registry beyond 3.0M.
for _fam_idx in range(205001, 255001):
    _fam_key, _fam_prim, _fam_defs = _PARAMETRIC_FAMILIES[_fam_idx % len(_PARAMETRIC_FAMILIES)]
    _shape_name = f"{_fam_key}_{_fam_idx:05d}"
    if _shape_name not in BASE_SHAPE_PROFILES:
        BASE_SHAPE_PROFILES[_shape_name] = {
            "primitive": _fam_prim,
            "required_dims": list(_fam_defs.keys()),
            "defaults": dict(_fam_defs),
        }

_register_extra_shapes(
    {v[0]: [f"{v[0]}_{i:05d}" for i in range(205001, 255001) if i % len(_PARAMETRIC_FAMILIES) == idx]
     for idx, v in enumerate(_PARAMETRIC_FAMILIES)},
    _VARIANTS,
)


# Additional additive pass (255001-300000) to move beyond 3.5M total shapes.
for _fam_idx in range(255001, 300001):
    _fam_key, _fam_prim, _fam_defs = _PARAMETRIC_FAMILIES[_fam_idx % len(_PARAMETRIC_FAMILIES)]
    _shape_name = f"{_fam_key}_{_fam_idx:05d}"
    if _shape_name not in BASE_SHAPE_PROFILES:
        BASE_SHAPE_PROFILES[_shape_name] = {
            "primitive": _fam_prim,
            "required_dims": list(_fam_defs.keys()),
            "defaults": dict(_fam_defs),
        }

_register_extra_shapes(
    {v[0]: [f"{v[0]}_{i:05d}" for i in range(255001, 300001) if i % len(_PARAMETRIC_FAMILIES) == idx]
     for idx, v in enumerate(_PARAMETRIC_FAMILIES)},
    _VARIANTS,
)


EXTENDED_SHAPE_COUNT = len(SHAPE_FN_EXTENDED)
_BASELINE_SHAPE_COUNT = EXTENDED_SHAPE_COUNT

