
"""
UARE CAD Runner — CadQuery geometry kernel
Supports 40+ part types matching the enki.js vocabulary.
"""
import json
import math
import sys
from pathlib import Path

# CAD DSL: schema validator + part normaliser
try:
    from cad_dsl import validate_assembly, normalise_part
    _HAS_DSL = True
except ImportError:
    _HAS_DSL = False

try:
    from geo_library import get_geometry_fn, EXTENDED_SHAPE_COUNT
    _HAS_GEO_LIBRARY = True
except ImportError:
    _HAS_GEO_LIBRARY = False
    EXTENDED_SHAPE_COUNT = 0

try:
    from geo_composer import generate_novel_part
    _HAS_GEO_COMPOSER = True
except ImportError:
    _HAS_GEO_COMPOSER = False

try:
    from geo_features import (
        apply_hole_pattern,
        apply_pocket,
        apply_boss,
        apply_rib_array,
        apply_chamfer,
        apply_fillet,
        apply_slot,
    )
    _HAS_GEO_FEATURES = True
except ImportError:
    _HAS_GEO_FEATURES = False


def fail(message: str, code: int = 1):
    print(json.dumps({"ok": False, "error": message}))
    sys.exit(code)


def ensure_assembly_document(plan_path: Path, plan: dict):
    assembly_path = plan_path.parent / "assembly_document.json"
    if assembly_path.exists():
        with open(assembly_path, "r", encoding="utf-8") as f:
            return json.load(f)
    params = ((plan.get("recipe") or {}).get("parameters") or {})
    return {
        "assembly_id": "fallback-assembly",
        "parts": [
            {
                "id": "part-main",
                "name": "Main body",
                "kind": "mechanical",
                "shape": "box",
                "dimensions_mm": {
                    "x": float(params.get("bracket_length_mm", 120)),
                    "y": float(params.get("bracket_width_mm", 40)),
                    "z": float(params.get("bracket_height_mm", 30)),
                },
                "transform_mm": {"x": 0, "y": 0, "z": float(params.get("bracket_height_mm", 30)) / 2.0},
                "material": "aluminum_6061",
            }
        ],
        "wiring": [],
        "netlist": [],
    }


def _to_float(value, fallback):
    try:
        parsed = float(value)
        if math.isfinite(parsed):
            return parsed
    except (TypeError, ValueError):
        pass
    return float(fallback)


def _resolve_precision_profile(plan: dict, assembly_document: dict):
    recipe_params = ((plan.get("recipe") or {}).get("parameters") or {})
    quality = (
        plan.get("precision_profile")
        or recipe_params.get("precision_profile")
        or plan.get("mesh_quality")
        or recipe_params.get("mesh_quality")
        or assembly_document.get("precision_profile")
        or "high"
    )
    profile_key = str(quality).strip().lower()

    profiles = {
        "draft": {
            "label": "draft",
            "linear_deflection_mm": 0.18,
            "angular_tolerance_deg": 0.32,
            "heal_solids": False,
        },
        "balanced": {
            "label": "balanced",
            "linear_deflection_mm": 0.08,
            "angular_tolerance_deg": 0.20,
            "heal_solids": True,
        },
        "high": {
            "label": "high",
            "linear_deflection_mm": 0.04,
            "angular_tolerance_deg": 0.12,
            "heal_solids": True,
        },
        "ultra": {
            "label": "ultra",
            "linear_deflection_mm": 0.02,
            "angular_tolerance_deg": 0.08,
            "heal_solids": True,
        },
    }

    selected = dict(profiles.get(profile_key, profiles["high"]))
    selected["label"] = profile_key if profile_key in profiles else "high"

    selected["linear_deflection_mm"] = _to_float(
        plan.get("stl_linear_deflection_mm") or recipe_params.get("stl_linear_deflection_mm"),
        selected["linear_deflection_mm"],
    )
    selected["angular_tolerance_deg"] = _to_float(
        plan.get("stl_angular_tolerance_deg") or recipe_params.get("stl_angular_tolerance_deg"),
        selected["angular_tolerance_deg"],
    )

    selected["linear_deflection_mm"] = max(0.005, selected["linear_deflection_mm"])
    selected["angular_tolerance_deg"] = max(0.02, selected["angular_tolerance_deg"])
    return selected


def _build_assembly_geometry(cq, solids):
    """Prefer compound export to preserve assembly topology; fallback to union."""
    if not solids:
        return None, "empty"

    try:
        compound = cq.Compound.makeCompound([solid.val() for solid in solids])
        return compound, "compound"
    except Exception:
        pass

    merged = solids[0]
    for solid in solids[1:]:
        merged = merged.union(solid)
    try:
        return merged.val(), "union"
    except Exception:
        return merged, "union"


def _export_kernel_artifacts(exporters, geometry, step_path: Path, stl_path: Path, precision: dict):
    exporters.export(geometry, str(step_path))
    try:
        exporters.export(
            geometry,
            str(stl_path),
            tolerance=float(precision.get("linear_deflection_mm", 0.04)),
            angularTolerance=float(precision.get("angular_tolerance_deg", 0.12)),
        )
    except TypeError:
        # Older CadQuery exporter signatures may not accept tolerance kwargs.
        exporters.export(geometry, str(stl_path))


# ─── Geometry primitives ──────────────────────────────────────────────────────

def _geo_box(cq, d):
    sx = max(float(d.get("x", d.get("w", 10))), 0.5)
    sy = max(float(d.get("y", d.get("depth", d.get("d", 10)))), 0.5)
    sz = max(float(d.get("z", d.get("h", 10))), 0.5)
    return cq.Workplane("XY").box(sx, sy, sz)


def _geo_cylinder(cq, d):
    """Solid cylinder / shaft / rod."""
    r = max(float(d.get("diameter", d.get("outerD", d.get("d", 10)))) / 2.0, 0.25)
    h = max(float(d.get("length", d.get("L", d.get("h", d.get("height", 20))))), 0.5)
    return cq.Workplane("XY").circle(r).extrude(h)


def _geo_tube(cq, d):
    """Hollow tube / pipe."""
    r_out = max(float(d.get("diameter", d.get("outerD", 10))) / 2.0, 0.5)
    wall = max(float(d.get("wall", d.get("wall_t", 1.0))), 0.2)
    r_in = max(r_out - wall, 0.1)
    h = max(float(d.get("length", d.get("h", 20))), 0.5)
    outer = cq.Workplane("XY").circle(r_out).extrude(h)
    inner = cq.Workplane("XY").circle(r_in).extrude(h)
    return outer.cut(inner)


def _geo_shaft(cq, d):
    """Stepped shaft — main body with optional keyway slot."""
    dia = max(float(d.get("diameter", d.get("d", 20))), 0.5)
    length = max(float(d.get("length", d.get("L", 100))), 1.0)
    shaft = cq.Workplane("XY").circle(dia / 2.0).extrude(length)
    kw = float(d.get("keyway_width", 0))
    kd = float(d.get("keyway_depth", kw * 0.5 if kw else 0))
    if kw > 0 and kd > 0:
        slot = (
            cq.Workplane("XY")
            .center(dia / 2.0 - kd / 2.0, 0)
            .rect(kd, kw)
            .extrude(length)
        )
        shaft = shaft.cut(slot)
    return shaft


def _geo_plate(cq, d):
    sx = max(float(d.get("w", d.get("x", d.get("width", 50)))), 0.5)
    sz = max(float(d.get("depth", d.get("d", d.get("y", 30)))), 0.5)
    sy = max(float(d.get("h", d.get("height", d.get("thickness", d.get("z", 5))))), 0.2)
    return cq.Workplane("XY").box(sx, sz, sy)


def _geo_flange(cq, d):
    """Circular flange disc with optional bolt-circle holes."""
    od = max(float(d.get("outer_diameter", d.get("diameter", d.get("outerD", 80)))), 1.0)
    thick = max(float(d.get("thickness", d.get("height", d.get("width", 10)))), 0.5)
    id_ = float(d.get("inner_diameter", d.get("bore", od * 0.3)))
    flange = cq.Workplane("XY").circle(od / 2.0).extrude(thick)
    if id_ > 0:
        bore = cq.Workplane("XY").circle(id_ / 2.0).extrude(thick)
        flange = flange.cut(bore)
    # Bolt circle holes
    pcd = float(d.get("bolt_circle", d.get("bolt_pcd", od * 0.75)))
    n_bolts = int(d.get("num_bolts", d.get("bolts", 0)))
    bolt_dia = float(d.get("bolt_dia", od * 0.04))
    if n_bolts >= 2 and bolt_dia > 0 and pcd > 0:
        for i in range(n_bolts):
            angle = 2 * math.pi * i / n_bolts
            bx = (pcd / 2.0) * math.cos(angle)
            by = (pcd / 2.0) * math.sin(angle)
            hole = (
                cq.Workplane("XY")
                .center(bx, by)
                .circle(bolt_dia / 2.0)
                .extrude(thick)
            )
            flange = flange.cut(hole)
    return flange


def _geo_gear(cq, d):
    """Gear — approximated as thick disc with hub and flat sides."""
    module = max(float(d.get("module", 2.0)), 0.1)
    teeth = max(int(d.get("num_teeth", d.get("teeth", 20))), 3)
    face_w = max(float(d.get("face_width", d.get("faceW", 20))), 0.5)
    pitch_r = module * teeth / 2.0  # pitch circle radius
    addendum = module
    dedendum = 1.25 * module
    od = pitch_r + addendum
    root_r = max(pitch_r - dedendum, 1.0)
    # Profile: toothed disc approximated by hexadecagon-like polygon
    n_pts = max(teeth * 2, 16)
    pts = []
    for i in range(n_pts):
        angle = 2 * math.pi * i / n_pts
        r = od if i % 2 == 0 else root_r
        pts.append((r * math.cos(angle), r * math.sin(angle)))
    gear = cq.Workplane("XY").polyline(pts).close().extrude(face_w)
    # Hub bore
    hub_r = float(d.get("hub_diameter", module * 2)) / 2.0 if d.get("hub_diameter") else root_r * 0.3
    if hub_r > 0.2:
        bore = cq.Workplane("XY").circle(hub_r).extrude(face_w)
        gear = gear.cut(bore)
    return gear


def _geo_bearing(cq, d):
    """Rolling element bearing — outer ring, inner ring, gap for rolling elements."""
    od = max(float(d.get("outerD", d.get("outer_diameter", 52))), 1.0)
    id_ = max(float(d.get("innerD", d.get("inner_diameter", 25))), 0.5)
    width = max(float(d.get("width", d.get("h", 15))), 0.5)
    ring_t = (od - id_) * 0.25
    outer = cq.Workplane("XY").circle(od / 2.0).extrude(width)
    cavity = cq.Workplane("XY").circle(od / 2.0 - ring_t).extrude(width)
    inner = cq.Workplane("XY").circle(id_ / 2.0 + ring_t).extrude(width)
    bore = cq.Workplane("XY").circle(id_ / 2.0).extrude(width)
    bearing = outer.cut(cavity).union(inner).cut(bore)
    return bearing


def _geo_spring(cq, d):
    """Helical compression spring — cylindrical envelope."""
    od = max(float(d.get("outerD", d.get("outer_diameter", d.get("diameter", 20)))), 0.5)
    wire_d = max(float(d.get("wireD", d.get("wire_diameter", 2))), 0.1)
    free_len = max(float(d.get("freeLen", d.get("free_length", d.get("length", 60)))), 1.0)
    coils = max(int(d.get("coils", d.get("num_coils", 8))), 2)
    # Build helix from polyline approximation (CQ 2.x lacks native helix)
    n_pts_per_turn = 24
    pts_3d = []
    for i in range(coils * n_pts_per_turn + 1):
        t = i / (coils * n_pts_per_turn)
        angle = 2 * math.pi * coils * t
        r = od / 2.0 - wire_d / 2.0
        pts_3d.append(
            cq.Vector(r * math.cos(angle), r * math.sin(angle), t * free_len)
        )
    try:
        import cadquery as _cq
        wire = _cq.Wire.makeHelix(
            pitch=free_len / coils,
            height=free_len,
            radius=od / 2.0 - wire_d / 2.0,
        )
        profile = _cq.Wire.makeCircle(wire_d / 2.0, _cq.Vector(od / 2.0 - wire_d / 2.0, 0, 0), _cq.Vector(0, 1, 0))
        spring = _cq.Workplane("XY").add(
            _cq.Solid.makeSweep(profile, wire)  # type: ignore
        )
        return spring
    except Exception:
        # Fallback: solid cylinder approximation
        outer = cq.Workplane("XY").circle(od / 2.0).extrude(free_len)
        inner = cq.Workplane("XY").circle(od / 2.0 - wire_d * 2).extrude(free_len)
        return outer.cut(inner)


def _geo_nozzle(cq, d):
    """Convergent-divergent rocket nozzle (bell profile revolved)."""
    exit_r = max(float(d.get("exit_diameter", d.get("diameter", 60))) / 2.0, 1.0)
    throat_r = max(float(d.get("throat_diameter", exit_r * 0.35)) / 2.0, 0.5)
    height = max(float(d.get("height", d.get("length", exit_r * 2.5))), 1.0)
    wall = max(float(d.get("wall_thickness", 2.0)), 0.3)
    # Profile: converge from entry (exit_r*0.8) to throat, then diverge to exit
    entry_r = exit_r * 0.8
    n = 20
    pts_outer = []
    # Converging section (upper half)
    for i in range(n + 1):
        t = i / n
        z = t * height * 0.35
        r = entry_r + (throat_r - entry_r) * (1 - (1 - t) ** 2)
        pts_outer.append((r, z))
    # Diverging section
    for i in range(1, n + 1):
        t = i / n
        z = height * 0.35 + t * height * 0.65
        r = throat_r + (exit_r - throat_r) * (1 - (1 - t) ** 1.5)
        pts_outer.append((r, z))
    # Inner offset
    pts_inner = [(max(r - wall, 0.1), z) for r, z in reversed(pts_outer)]
    profile = pts_outer + pts_inner + [pts_outer[0]]
    return cq.Workplane("XZ").polyline(profile).close().revolve(360, (0, 0, 0), (0, 1, 0))


def _geo_dome(cq, d):
    """Hemispherical or ellipsoidal pressure vessel dome."""
    r = max(float(d.get("radius", d.get("diameter", 80)) / (1 if "radius" in d else 2)), 0.5)
    wall = max(float(d.get("wall_thickness", d.get("wall", 3.0))), 0.2)
    height = float(d.get("height", r))
    a_outer = r
    b_outer = height
    a_inner = max(r - wall, 0.1)
    b_inner = max(height - wall, 0.1)
    n = 24
    pts_outer = [(a_outer * math.cos(math.pi / 2 * i / n), b_outer * math.sin(math.pi / 2 * i / n)) for i in range(n + 1)]
    pts_inner = [(a_inner * math.cos(math.pi / 2 * i / n), b_inner * math.sin(math.pi / 2 * i / n)) for i in reversed(range(n + 1))]
    profile = pts_outer + pts_inner + [pts_outer[0]]
    return cq.Workplane("XZ").polyline(profile).close().revolve(360, (0, 0, 0), (0, 1, 0))


def _geo_impeller(cq, d):
    """Centrifugal impeller — disc with radial blade pockets."""
    od = max(float(d.get("outer_diameter", d.get("diameter", 200))), 1.0)
    hub_d = float(d.get("hub_diameter", d.get("inlet_diameter", od * 0.3)))
    width = max(float(d.get("width", d.get("face_width", od * 0.12))), 0.5)
    n_blades = max(int(d.get("num_blades", d.get("blades", 6))), 2)
    disc = cq.Workplane("XY").circle(od / 2.0).extrude(width)
    bore = cq.Workplane("XY").circle(hub_d / 2.0).extrude(width)
    disc = disc.cut(bore)
    # Blade slots as rectangular cuts
    blade_w = od * 0.06
    blade_l = (od - hub_d) / 2.0 * 0.8
    for i in range(n_blades):
        angle = 2 * math.pi * i / n_blades + math.pi / n_blades
        cx = ((hub_d / 2.0 + blade_l / 2.0) * math.cos(angle))
        cy = ((hub_d / 2.0 + blade_l / 2.0) * math.sin(angle))
        slot = (
            cq.Workplane("XY")
            .center(cx, cy)
            .rect(blade_l, blade_w)
            .extrude(width)
        )
        # Rotate slot to blade angle via transform on the workplane is tricky;
        # approximate with axis-aligned slot — good enough for STEP envelope.
        disc = disc.union(slot)
    return disc


def _geo_ibeam(cq, d):
    """I-beam / H-beam cross-section extruded to length."""
    h = max(float(d.get("H", d.get("depth", d.get("height", 200)))), 1.0)
    w = max(float(d.get("W", d.get("flange_width", d.get("width", 100)))), 0.5)
    tw = max(float(d.get("tw", d.get("web_t", 6))), 0.2)
    tf = max(float(d.get("tf", d.get("flange_t", 10))), 0.2)
    length = max(float(d.get("L", d.get("length", 1000))), 1.0)
    web = cq.Workplane("XY").box(tw, h - 2 * tf, length)
    top_flange = cq.Workplane("XY").box(w, tf, length).translate((0, (h - tf) / 2.0, 0))
    bot_flange = cq.Workplane("XY").box(w, tf, length).translate((0, -(h - tf) / 2.0, 0))
    return web.union(top_flange).union(bot_flange)


def _geo_bracket(cq, d):
    """L-bracket with gusset."""
    w = max(float(d.get("w", d.get("width", 80))), 0.5)
    h = max(float(d.get("h", d.get("height", 60))), 0.5)
    dp = max(float(d.get("d", d.get("depth", 40))), 0.5)
    t = max(float(d.get("thickness", d.get("t", 5))), 0.3)
    base = cq.Workplane("XY").box(w, dp, t)
    vert = cq.Workplane("XY").box(w, t, h).translate((0, -dp / 2.0 + t / 2.0, h / 2.0))
    gusset_pts = [(0, 0), (dp * 0.7, 0), (0, h * 0.6)]
    gusset = (
        cq.Workplane("YZ")
        .polyline(gusset_pts).close().extrude(t)
        .translate((w / 2.0 - t / 2.0, -dp / 2.0, t))
    )
    return base.union(vert).union(gusset)


def _geo_pcb(cq, d):
    """PCB board — thin rectangle with corner mount holes."""
    sx = max(float(d.get("w", d.get("x", d.get("width", 100)))), 0.5)
    sy = max(float(d.get("d", d.get("depth", d.get("y", 80)))), 0.5)
    sz = max(float(d.get("h", d.get("height", d.get("thickness", 1.6)))), 0.2)
    board = cq.Workplane("XY").box(sx, sy, sz)
    # Corner mounting holes 3.2 mm dia at 5 mm inset
    inset = 5.0
    hole_r = 1.6
    for xs, ys in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        hx = xs * (sx / 2.0 - inset)
        hy = ys * (sy / 2.0 - inset)
        hole = cq.Workplane("XY").center(hx, hy).circle(hole_r).extrude(sz)
        board = board.cut(hole)
    return board


def _geo_housing(cq, d):
    """Generic housing — box with wall thickness cavity."""
    sx = max(float(d.get("w", d.get("x", d.get("width", d.get("diameter", 60))))), 0.5)
    sy = max(float(d.get("d", d.get("depth", d.get("y", sx)))), 0.5)
    sz = max(float(d.get("h", d.get("height", d.get("length", sx * 0.8)))), 0.5)
    wall = max(float(d.get("wall", d.get("wall_t", min(sx, sy, sz) * 0.1))), 0.3)
    outer = cq.Workplane("XY").box(sx, sy, sz)
    ix = max(sx - 2 * wall, 0.1)
    iy = max(sy - 2 * wall, 0.1)
    iz = max(sz - wall, 0.1)
    inner = cq.Workplane("XY").box(ix, iy, iz).translate((0, 0, wall / 2.0))
    return outer.cut(inner)


def _geo_o_ring(cq, d):
    """O-ring torus."""
    mean_r = max(float(d.get("inner_diameter", d.get("innerD", 20))) / 2.0 +
                 float(d.get("cross_section", d.get("cs", 3))) / 2.0, 0.5)
    cs_r = max(float(d.get("cross_section", d.get("cs", 3))) / 2.0, 0.1)
    return cq.Workplane("XZ").center(mean_r, 0).circle(cs_r).revolve(360, (0, 0, 0), (0, 1, 0))


def _geo_bolt(cq, d):
    """Hex cap screw — hex head + shank."""
    shank_d = max(float(d.get("diameter", d.get("d", 8))), 0.5)
    length = max(float(d.get("length", d.get("L", 30))), 1.0)
    head_h = shank_d * 0.7
    head_af = shank_d * 1.7  # across-flats
    shank = cq.Workplane("XY").circle(shank_d / 2.0).extrude(length)
    head = cq.Workplane("XY").polygon(6, head_af).extrude(head_h).translate((0, 0, -head_h))
    return shank.union(head)


def _geo_nut_hex(cq, d):
    """Hex nut with through bore."""
    af = max(float(d.get("across_flats", d.get("af", 13))), 1.0)
    thick = max(float(d.get("thickness", d.get("height", 8))), 0.5)
    thread_d = max(float(d.get("thread_diameter", d.get("diameter", 8))), 0.2)
    nut = cq.Workplane("XY").polygon(6, af).extrude(thick)
    bore = cq.Workplane("XY").circle(thread_d / 2.0).extrude(thick)
    return nut.cut(bore)


def _geo_washer(cq, d):
    """Flat washer ring."""
    od = max(float(d.get("outer_diameter", d.get("diameter", 16))), 0.5)
    id_ = max(float(d.get("inner_diameter", d.get("bore", 8.4))), 0.2)
    thick = max(float(d.get("thickness", d.get("height", 1.6))), 0.1)
    washer = cq.Workplane("XY").circle(od / 2.0).extrude(thick)
    bore = cq.Workplane("XY").circle(id_ / 2.0).extrude(thick)
    return washer.cut(bore)


def _geo_dowel_pin(cq, d):
    """Precision dowel pin with slight center land."""
    dia = max(float(d.get("diameter", 8)), 0.5)
    length = max(float(d.get("length", d.get("L", 20))), 0.5)
    land_d = max(dia * 0.98, 0.2)
    body = cq.Workplane("XY").circle(dia / 2.0).extrude(length)
    land = cq.Workplane("XY").circle(land_d / 2.0).extrude(length * 0.55).translate((0, 0, length * 0.225))
    return body.union(land)


def _geo_lip_seal(cq, d):
    """Radial shaft seal — toroidal ring."""
    od = max(float(d.get("outerD", d.get("outer_diameter", d.get("diameter", 62)))), 1.0)
    id_ = max(float(d.get("innerD", d.get("inner_diameter", 40))), 0.5)
    h = max(float(d.get("width", d.get("h", 8))), 0.3)
    outer = cq.Workplane("XY").circle(od / 2.0).extrude(h)
    bore = cq.Workplane("XY").circle(id_ / 2.0).extrude(h)
    return outer.cut(bore)


def _geo_gasket(cq, d):
    """Flat gasket sheet with central bore."""
    od = max(float(d.get("outer_diameter", d.get("outerD", d.get("w", d.get("diameter", 100))))), 0.5)
    thick = max(float(d.get("thickness", d.get("h", d.get("t", 2.0)))), 0.1)
    id_ = float(d.get("inner_diameter", d.get("innerD", od * 0.5)))
    outer = cq.Workplane("XY").circle(od / 2.0).extrude(thick)
    if id_ > 0:
        inner = cq.Workplane("XY").circle(id_ / 2.0).extrude(thick)
        outer = outer.cut(inner)
    return outer


def _geo_coil_over(cq, d):
    """Coilover — damper body + spring."""
    od = max(float(d.get("bore", d.get("diameter", 50))), 1.0)
    length = max(float(d.get("extended_length", d.get("length", 350))), 10.0)
    spring_id = float(d.get("spring_id", d.get("spring_diameter", od * 1.8)))
    wire_d = spring_id * 0.08
    # Damper body
    damper = cq.Workplane("XY").circle(od / 2.0).extrude(length * 0.65)
    rod = cq.Workplane("XY").circle(od * 0.2).extrude(length).translate((0, 0, 0))
    # Spring as hollow cylinder
    s_free_len = length * 0.8
    spring_outer = cq.Workplane("XY").circle(spring_id / 2.0 + wire_d).extrude(s_free_len)
    spring_inner = cq.Workplane("XY").circle(spring_id / 2.0).extrude(s_free_len)
    spring = spring_outer.cut(spring_inner)
    return damper.union(rod).union(spring)


def _geo_rotor_blade(cq, d):
    """Turbine / wind turbine blade or propeller — NACA-like loft approximation."""
    length = max(float(d.get("length", d.get("diameter", 127))), 1.0)
    chord = max(float(d.get("max_chord", d.get("width", d.get("chord", length * 0.15)))), 0.5)
    thickness = max(float(d.get("thickness", chord * 0.12)), 0.2)
    # NACA 4-digit profile approximation as polyline
    n = 12
    pts_upper = []
    pts_lower = []
    for i in range(n + 1):
        xc = i / n
        # NACA 0012-like thickness distribution
        yt = 5 * thickness * (0.2969 * xc**0.5 - 0.126 * xc - 0.3516 * xc**2 + 0.2843 * xc**3 - 0.1015 * xc**4)
        yt = max(yt, 0.001)
        pts_upper.append((xc * chord - chord / 2.0, yt))
        pts_lower.append((xc * chord - chord / 2.0, -yt))
    profile_pts = pts_upper + list(reversed(pts_lower)) + [pts_upper[0]]
    blade = cq.Workplane("XZ").polyline(profile_pts).close().extrude(length)
    return blade


def _geo_coupling(cq, d):
    """Flexible jaw coupling — two hubs + spider."""
    od = max(float(d.get("diameter", d.get("od", 80))), 1.0)
    length = max(float(d.get("length", od * 1.2)), 1.0)
    bore = float(d.get("bore", od * 0.35))
    hub = cq.Workplane("XY").circle(od / 2.0).extrude(length)
    if bore > 0:
        hub = hub.cut(cq.Workplane("XY").circle(bore / 2.0).extrude(length))
    return hub


def _geo_worm_drive(cq, d):
    """Worm / harmonic drive — thick ring (flexspline approximation)."""
    od = max(float(d.get("outer_diameter", d.get("diameter", 100))), 1.0)
    length = max(float(d.get("length", d.get("width", 45))), 0.5)
    wall_frac = 0.2
    inner = od * (1 - 2 * wall_frac)
    outer = cq.Workplane("XY").circle(od / 2.0).extrude(length)
    if inner > 0:
        outer = outer.cut(cq.Workplane("XY").circle(inner / 2.0).extrude(length))
    return outer


def _geo_brake_rotor(cq, d):
    """Vented disc brake rotor — two friction rings with vane pillars."""
    od = max(float(d.get("outer_diameter", d.get("diameter", 330))), 1.0)
    hat_d = float(d.get("inner_diameter", d.get("hat_diameter", od * 0.4)))
    overall_h = max(float(d.get("height", d.get("thickness", 28))), 1.0)
    vane_h = max(float(d.get("vane_height", overall_h * 0.43)), 0.5)
    ring_t = max((overall_h - vane_h) / 2.0, 0.5)
    top_ring = cq.Workplane("XY").circle(od / 2.0).circle(hat_d / 2.0).extrude(ring_t).translate((0, 0, overall_h - ring_t))
    bot_ring = cq.Workplane("XY").circle(od / 2.0).circle(hat_d / 2.0).extrude(ring_t)
    # Vane pillars
    n_vanes = int(d.get("num_vanes", 36))
    vane_w = (od - hat_d) * 0.08
    rotor = top_ring.union(bot_ring)
    for i in range(n_vanes):
        angle = 2 * math.pi * i / n_vanes
        r_mid = (od + hat_d) / 4.0
        vx = r_mid * math.cos(angle)
        vy = r_mid * math.sin(angle)
        vane = (
            cq.Workplane("XY")
            .center(vx, vy)
            .rect(vane_w, vane_w)
            .extrude(vane_h)
            .translate((0, 0, ring_t))
        )
        rotor = rotor.union(vane)
    return rotor


def _geo_ball_joint(cq, d):
    """Ball joint — spherical head + shank."""
    ball_d = max(float(d.get("body_diameter", d.get("ball_diameter", 30))), 0.5)
    shank_d = max(float(d.get("shank_diameter", ball_d * 0.5)), 0.3)
    shank_l = max(float(d.get("shank_length", d.get("length", ball_d * 1.5))), 0.5)
    ball = cq.Workplane("XY").sphere(ball_d / 2.0)
    shank = cq.Workplane("XY").circle(shank_d / 2.0).extrude(shank_l).translate((0, 0, -shank_l))
    return ball.union(shank)


def _geo_wire(cq, d):
    """Cable / wire harness — thin cylinder bundle."""
    dia = max(float(d.get("diameter", d.get("od", 10))), 0.3)
    length = max(float(d.get("length", 500)), 1.0)
    return cq.Workplane("XY").circle(dia / 2.0).extrude(length)


def _geo_piston(cq, d):
    """Engine piston with skirt, crown land, pin bore, and ring grooves."""
    dia = max(float(d.get("diameter", d.get("d", d.get("outerD", 86)))), 1.0)
    height = max(float(d.get("height", d.get("h", d.get("length", 70)))), 1.0)
    pin_d = max(float(d.get("pin_diameter", d.get("wrist_pin_d", dia * 0.26))), 0.5)
    crown_h = max(height * 0.16, 1.0)
    land_d = dia * 0.96
    skirt_d = dia * 0.985

    crown = cq.Workplane("XY").circle(land_d / 2.0).extrude(crown_h)
    skirt = cq.Workplane("XY").circle(skirt_d / 2.0).extrude(height - crown_h).translate((0, 0, crown_h))
    piston = crown.union(skirt)

    ring_count = max(int(d.get("ring_count", 3)), 0)
    groove_w = max(float(d.get("ring_width", 1.4)), 0.4)
    groove_depth = max(float(d.get("ring_depth", 0.9)), 0.2)
    for i in range(ring_count):
        z0 = crown_h + 4.0 + i * (groove_w + 1.6)
        if z0 + groove_w >= height * 0.6:
            break
        groove_outer = cq.Workplane("XY").circle((dia / 2.0) + 0.5).extrude(groove_w).translate((0, 0, z0))
        groove_inner = cq.Workplane("XY").circle(max((dia / 2.0) - groove_depth, 0.1)).extrude(groove_w).translate((0, 0, z0))
        piston = piston.cut(groove_outer.cut(groove_inner))

    pin_z = height * 0.55
    pin_cut = cq.Workplane("YZ").center(0, pin_z).circle(pin_d / 2.0).extrude(dia * 1.2)
    piston = piston.cut(pin_cut)
    return piston


def _geo_flywheel(cq, d):
    """Flywheel with rim, web, hub, bore, and bolt circle."""
    od = max(float(d.get("outer_diameter", d.get("diameter", d.get("outerD", 280)))), 1.0)
    thick = max(float(d.get("thickness", d.get("h", d.get("width", 32)))), 0.5)
    id_ = max(float(d.get("inner_diameter", d.get("innerD", 80))), 0.1)
    hub_d = max(float(d.get("hub_diameter", od * 0.32)), id_ + 6)
    rim_id = max(float(d.get("rim_inner_diameter", od * 0.72)), hub_d + 6)

    rim = cq.Workplane("XY").circle(od / 2.0).circle(rim_id / 2.0).extrude(thick)
    web = cq.Workplane("XY").circle(rim_id / 2.0).circle(hub_d / 2.0).extrude(thick * 0.55).translate((0, 0, thick * 0.225))
    hub = cq.Workplane("XY").circle(hub_d / 2.0).extrude(thick)
    flywheel = rim.union(web).union(hub)
    flywheel = flywheel.cut(cq.Workplane("XY").circle(id_ / 2.0).extrude(thick))

    bolt_count = max(int(d.get("num_bolts", d.get("bolts", 6))), 0)
    bolt_pcd = max(float(d.get("bolt_circle", od * 0.22)), id_ + 8)
    bolt_d = max(float(d.get("bolt_dia", 10)), 0.5)
    for i in range(bolt_count):
        ang = 2 * math.pi * i / max(bolt_count, 1)
        bx = (bolt_pcd / 2.0) * math.cos(ang)
        by = (bolt_pcd / 2.0) * math.sin(ang)
        flywheel = flywheel.cut(cq.Workplane("XY").center(bx, by).circle(bolt_d / 2.0).extrude(thick))
    return flywheel


def _geo_pulley(cq, d):
    """Pulley with hub, bore, and a simple V-belt groove approximation."""
    od = max(float(d.get("outer_diameter", d.get("diameter", d.get("outerD", 120)))), 1.0)
    thick = max(float(d.get("thickness", d.get("h", d.get("width", 28)))), 0.5)
    id_ = max(float(d.get("inner_diameter", d.get("innerD", 20))), 0.1)
    hub_d = max(float(d.get("hub_diameter", od * 0.35)), id_ + 4)
    hub_l = max(float(d.get("hub_length", thick * 1.4)), thick)
    groove_depth = max(float(d.get("groove_depth", od * 0.05)), 0.5)
    groove_w = max(float(d.get("groove_width", thick * 0.35)), 0.5)

    rim = cq.Workplane("XY").circle(od / 2.0).extrude(thick)
    hub = cq.Workplane("XY").circle(hub_d / 2.0).extrude(hub_l).translate((0, 0, (thick - hub_l) / 2.0))
    pulley = rim.union(hub)
    pulley = pulley.cut(cq.Workplane("XY").circle(id_ / 2.0).extrude(max(thick, hub_l)))

    groove = (
        cq.Workplane("XZ")
        .polyline([
            (od / 2.0 - groove_depth, thick / 2.0 - groove_w / 2.0),
            (od / 2.0, thick / 2.0),
            (od / 2.0 - groove_depth, thick / 2.0 + groove_w / 2.0),
            (od / 2.0 - groove_depth * 1.6, thick / 2.0),
        ])
        .close()
        .revolve(360, (0, 0, 0), (0, 1, 0))
    )
    return pulley.cut(groove)


def _geo_crankshaft(cq, d):
    """Crankshaft approximation with main journals, webs, and offset rod journals."""
    main_d = max(float(d.get("diameter", d.get("d", 55))), 1.0)
    rod_d = max(float(d.get("rodD", d.get("rod_diameter", main_d * 0.88))), 0.5)
    length = max(float(d.get("length", d.get("L", 420))), 1.0)
    stroke = max(float(d.get("stroke", 86)), 1.0)
    throws = max(int(d.get("throws", d.get("cylinders", 4))), 1)
    throw_r = stroke / 2.0
    journal_len = length / (throws * 2.4 + 1.2)
    web_t = max(main_d * 0.22, 3.0)

    crank = cq.Workplane("XY").circle(main_d / 2.0).extrude(journal_len)
    z_cursor = journal_len
    for i in range(throws):
        phase = -1 if i % 2 else 1
        web1 = cq.Workplane("XY").box(main_d * 0.9, main_d * 0.35, web_t).translate((0, phase * throw_r * 0.5, z_cursor + web_t / 2.0))
        rod = cq.Workplane("XY").circle(rod_d / 2.0).extrude(journal_len).translate((0, phase * throw_r, z_cursor + web_t))
        web2 = cq.Workplane("XY").box(main_d * 0.9, main_d * 0.35, web_t).translate((0, phase * throw_r * 0.5, z_cursor + web_t + journal_len + web_t / 2.0))
        main = cq.Workplane("XY").circle(main_d / 2.0).extrude(journal_len).translate((0, 0, z_cursor + web_t * 2 + journal_len))
        crank = crank.union(web1).union(rod).union(web2).union(main)
        z_cursor += journal_len * 2 + web_t * 2
    return crank


def _geo_camshaft(cq, d):
    """Camshaft approximation with repeated eccentric lobes along shaft."""
    shaft_d = max(float(d.get("diameter", d.get("d", 26))), 0.5)
    length = max(float(d.get("length", d.get("L", 360))), 1.0)
    lobes = max(int(d.get("lobes", 8)), 1)
    lift = max(float(d.get("lobe_lift", d.get("lift", 10))), 0.5)
    lobe_w = max(float(d.get("lobe_width", length / (lobes * 2.6))), 1.0)

    cam = cq.Workplane("XY").circle(shaft_d / 2.0).extrude(length)
    pitch = length / (lobes + 1)
    for i in range(lobes):
        z0 = pitch * (i + 1) - lobe_w / 2.0
        offset = (shaft_d * 0.12) * (1 if i % 2 == 0 else -1)
        lobe = cq.Workplane("XY").ellipse((shaft_d + lift) / 2.0, shaft_d * 0.42).extrude(lobe_w).translate((offset, 0, z0))
        cam = cam.union(lobe)
    return cam


def _geo_connector(cq, d):
    """Electrical/mechanical connector housing with pin cavities."""
    sx = max(float(d.get("width", d.get("w", d.get("x", 20)))), 0.5)
    sy = max(float(d.get("depth", d.get("d", d.get("y", 10)))), 0.5)
    sz = max(float(d.get("height", d.get("h", d.get("z", 12)))), 0.5)
    pins = max(int(d.get("pins", d.get("pin_count", 8))), 1)
    wall = max(float(d.get("wall", 1.2)), 0.3)

    body = cq.Workplane("XY").box(sx, sy, sz)
    cavity = cq.Workplane("XY").box(max(sx - 2 * wall, 0.1), max(sy - wall, 0.1), max(sz - 2 * wall, 0.1)).translate((0, wall * 0.5, 0))
    body = body.cut(cavity)
    pitch = sx / (pins + 1)
    hole_d = min(sx / max(pins * 2.2, 2.2), sy * 0.35)
    for i in range(pins):
        x = -sx / 2.0 + pitch * (i + 1)
        body = body.cut(cq.Workplane("XZ").center(x, 0).circle(max(hole_d / 2.0, 0.2)).extrude(sy * 1.2))
    return body


def _geo_con_rod(cq, d):
    """Connecting rod with big end, small end, and blended beam section."""
    ctc = max(float(d.get("ctc", d.get("length", 155))), 5.0)
    big_d = max(float(d.get("bigEndD", d.get("big_end_diameter", 52))), 1.0)
    small_d = max(float(d.get("smallEndD", d.get("small_end_diameter", 24))), 0.5)
    thick = max(float(d.get("thickness", d.get("w", 22))), 0.8)
    beam_w = max(float(d.get("beam_width", min(big_d, small_d) * 0.45)), 0.5)

    big = cq.Workplane("XZ").center(0, 0).circle(big_d / 2.0).extrude(thick)
    small = cq.Workplane("XZ").center(0, ctc).circle(small_d / 2.0).extrude(thick)
    beam = (
        cq.Workplane("XZ")
        .polyline([
            (-beam_w / 2.0, big_d * 0.28),
            (beam_w / 2.0, big_d * 0.28),
            (beam_w * 0.38, ctc - small_d * 0.28),
            (-beam_w * 0.38, ctc - small_d * 0.28),
        ])
        .close()
        .extrude(thick)
    )
    rod = big.union(small).union(beam)
    rod = rod.cut(cq.Workplane("XZ").center(0, 0).circle(big_d * 0.42 / 2.0).extrude(thick * 1.2))
    rod = rod.cut(cq.Workplane("XZ").center(0, ctc).circle(small_d * 0.58 / 2.0).extrude(thick * 1.2))
    return rod


def _geo_cylinder_liner(cq, d):
    """Cylinder liner / sleeve with hollow bore and seating flange."""
    od = max(float(d.get("outer_diameter", d.get("outerD", d.get("diameter", 86)))), 1.0)
    id_ = max(float(d.get("inner_diameter", d.get("innerD", 78))), 0.5)
    length = max(float(d.get("length", d.get("L", 150))), 1.0)
    flange_od = max(float(d.get("flange_outer_diameter", od * 1.08)), od)
    flange_h = max(float(d.get("flange_height", length * 0.06)), 0.5)

    body = cq.Workplane("XY").circle(od / 2.0).extrude(length)
    bore = cq.Workplane("XY").circle(id_ / 2.0).extrude(length)
    flange = cq.Workplane("XY").circle(flange_od / 2.0).extrude(flange_h)
    return body.cut(bore).union(flange)


def _geo_valve(cq, d):
    """Poppet valve with head, stem, fillet cone, and keeper grooves."""
    head_d = max(float(d.get("head_diameter", d.get("diameter", 34))), 1.0)
    stem_d = max(float(d.get("stem_diameter", d.get("d", 6))), 0.3)
    length = max(float(d.get("length", d.get("L", 105))), 2.0)
    head_t = max(float(d.get("head_thickness", head_d * 0.12)), 0.5)
    tulip_h = max(float(d.get("tulip_height", head_d * 0.18)), 0.5)

    head = cq.Workplane("XY").circle(head_d / 2.0).extrude(head_t)
    tulip = cq.Workplane("XY").cone(tulip_h, head_d / 2.0, stem_d / 2.0).translate((0, 0, head_t))
    stem = cq.Workplane("XY").circle(stem_d / 2.0).extrude(max(length - head_t - tulip_h, 0.5)).translate((0, 0, head_t + tulip_h))
    valve = head.union(tulip).union(stem)

    groove_w = max(float(d.get("keeper_groove_width", 1.2)), 0.2)
    groove_d = max(float(d.get("keeper_groove_depth", 0.4)), 0.1)
    top_z = length - groove_w * 3.0
    for i in range(2):
        z0 = top_z + i * groove_w * 1.4
        groove_outer = cq.Workplane("XY").circle((stem_d / 2.0) + 0.2).extrude(groove_w).translate((0, 0, z0))
        groove_inner = cq.Workplane("XY").circle(max((stem_d / 2.0) - groove_d, 0.05)).extrude(groove_w).translate((0, 0, z0))
        valve = valve.cut(groove_outer.cut(groove_inner))
    return valve


def _geo_spark_plug(cq, d):
    """Spark plug with ceramic insulator, hex body, threaded shell, and electrode tip."""
    thread_d = max(float(d.get("thread_diameter", d.get("diameter", 14))), 1.0)
    hex_d = max(float(d.get("hex_diameter", 21)), thread_d * 1.2)
    length = max(float(d.get("length", d.get("L", 52))), 4.0)
    thread_l = max(float(d.get("thread_length", 19)), 1.0)
    ins_d = max(float(d.get("insulator_diameter", hex_d * 0.62)), 1.0)

    shell = cq.Workplane("XY").circle(thread_d / 2.0).extrude(thread_l)
    hex_body = cq.Workplane("XY").polygon(6, hex_d).extrude(length * 0.18).translate((0, 0, thread_l))
    insulator = cq.Workplane("XY").circle(ins_d / 2.0).extrude(max(length - thread_l, 1.0)).translate((0, 0, thread_l))
    electrode = cq.Workplane("XY").circle(max(thread_d * 0.08, 0.25)).extrude(length * 0.16).translate((0, 0, -length * 0.08))
    return shell.union(hex_body).union(insulator).union(electrode)


def _geo_fuel_injector(cq, d):
    """Fuel injector with body, nozzle, collar, and electrical connector."""
    body_d = max(float(d.get("body_diameter", d.get("diameter", 16))), 1.0)
    length = max(float(d.get("length", d.get("L", 68))), 3.0)
    nozzle_d = max(float(d.get("nozzle_diameter", body_d * 0.38)), 0.3)
    collar_d = max(float(d.get("collar_diameter", body_d * 1.25)), body_d)
    conn_w = max(float(d.get("connector_width", body_d * 0.9)), 0.5)
    conn_d = max(float(d.get("connector_depth", body_d * 0.75)), 0.5)
    conn_h = max(float(d.get("connector_height", body_d * 0.7)), 0.5)

    body = cq.Workplane("XY").circle(body_d / 2.0).extrude(length * 0.72)
    collar = cq.Workplane("XY").circle(collar_d / 2.0).extrude(length * 0.12).translate((0, 0, length * 0.26))
    nozzle = cq.Workplane("XY").cone(length * 0.18, body_d * 0.33, nozzle_d / 2.0).translate((0, 0, -length * 0.18))
    tip = cq.Workplane("XY").circle(nozzle_d / 2.0).extrude(length * 0.16).translate((0, 0, length * 0.72))
    connector = cq.Workplane("XY").box(conn_w, conn_d, conn_h).translate((0, body_d * 0.52, length * 0.52))
    return body.union(collar).union(nozzle).union(tip).union(connector)


def _geo_engine_block(cq, d):
        """Inline engine block with deck rails, water jacket, main saddles, and side bays."""
        w = max(float(d.get("width", d.get("w", d.get("x", 465)))), 1.0)
        h = max(float(d.get("height", d.get("h", d.get("z", 340)))), 1.0)
        dep = max(float(d.get("depth", d.get("d", d.get("y", 220)))), 1.0)
        bore = max(float(d.get("bore", d.get("diameter", 86))), 1.0)
        cylinders = max(int(d.get("cylinders", 4)), 1)

        upper = cq.Workplane("XY").box(w, dep * 0.90, h * 0.60).translate((0, 0, h * 0.12))
        lower = cq.Workplane("XY").box(w * 0.88, dep * 0.76, h * 0.50).translate((0, 0, -h * 0.20))
        deck_left = cq.Workplane("XY").box(w * 0.96, dep * 0.16, h * 0.18).translate((0, -dep * 0.28, h * 0.30))
        deck_right = cq.Workplane("XY").box(w * 0.96, dep * 0.16, h * 0.18).translate((0, dep * 0.28, h * 0.30))
        front_bulk = cq.Workplane("XY").box(w * 0.10, dep * 0.72, h * 0.56).translate((-w * 0.39, 0, -h * 0.06))
        rear_bulk = cq.Workplane("XY").box(w * 0.10, dep * 0.72, h * 0.56).translate((w * 0.39, 0, -h * 0.06))
        block = upper.union(lower).union(deck_left).union(deck_right).union(front_bulk).union(rear_bulk)

        skirt_cut = cq.Workplane("XY").box(w * 0.72, dep * 0.52, h * 0.30).translate((0, 0, -h * 0.18))
        valley_cut = cq.Workplane("XY").box(w * 0.84, dep * 0.18, h * 0.26).translate((0, 0, h * 0.26))
        side_relief_a = cq.Workplane("XY").box(w * 0.78, dep * 0.14, h * 0.34).translate((0, -dep * 0.37, -h * 0.02))
        side_relief_b = cq.Workplane("XY").box(w * 0.78, dep * 0.14, h * 0.34).translate((0, dep * 0.37, -h * 0.02))
        block = block.cut(skirt_cut).cut(valley_cut).cut(side_relief_a).cut(side_relief_b)

        crank_tunnel = cq.Workplane("YZ").center(0, -h * 0.23).circle(dep * 0.18).extrude(w * 0.84).translate((-w * 0.42, 0, 0))
        block = block.cut(crank_tunnel)

        pitch = w / max(cylinders + 0.65, 1.0)
        start_x = -w / 2.0 + pitch * 0.78
        bore_depth = h * 0.84
        for i in range(cylinders):
            cx = start_x + i * pitch
            liner_pad = cq.Workplane("XY").center(cx, 0).circle(bore * 0.68).extrude(h * 0.10).translate((0, 0, h * 0.18))
            bore_cut = cq.Workplane("XY").center(cx, 0).circle(bore / 2.0).extrude(bore_depth).translate((0, 0, h * 0.30 - bore_depth))
            water_jacket = cq.Workplane("XY").center(cx, 0).circle(bore * 0.62).circle(bore * 0.54).extrude(h * 0.26).translate((0, 0, h * 0.14))
            deck_boss_a = cq.Workplane("XY").center(cx, -dep * 0.24).circle(bore * 0.12).extrude(h * 0.12).translate((0, 0, h * 0.22))
            deck_boss_b = cq.Workplane("XY").center(cx, dep * 0.24).circle(bore * 0.12).extrude(h * 0.12).translate((0, 0, h * 0.22))
            block = block.union(liner_pad).union(deck_boss_a).union(deck_boss_b).cut(bore_cut).cut(water_jacket)

        main_count = cylinders + 1
        main_pitch = w / max(main_count + 0.5, 1.0)
        main_start = -w / 2.0 + main_pitch * 0.75
        saddle_w = pitch * 0.40
        for i in range(main_count):
            mx = main_start + i * main_pitch
            saddle = cq.Workplane("XY").box(saddle_w, dep * 0.52, h * 0.20).translate((mx, 0, -h * 0.28))
            cap_relief = cq.Workplane("YZ").center(0, -h * 0.28).circle(dep * 0.11).extrude(saddle_w * 1.1).translate((mx - saddle_w * 0.55, 0, 0))
            block = block.union(saddle).cut(cap_relief)

        # Main oil gallery and coolant crossover rails for engine-grade internals.
        oil_gallery = cq.Workplane("YZ").center(0, -h * 0.22).circle(max(dep * 0.040, 2.0)).extrude(w * 0.86).translate((-w * 0.43, 0, 0))
        cool_left = cq.Workplane("YZ").center(-dep * 0.24, h * 0.17).circle(max(dep * 0.036, 2.0)).extrude(w * 0.84).translate((-w * 0.42, 0, 0))
        cool_right = cq.Workplane("YZ").center(dep * 0.24, h * 0.17).circle(max(dep * 0.036, 2.0)).extrude(w * 0.84).translate((-w * 0.42, 0, 0))
        block = block.cut(oil_gallery).cut(cool_left).cut(cool_right)

        for i in range(main_count):
            mx = main_start + i * main_pitch
            drill = cq.Workplane("XZ").center(mx, -h * 0.22).circle(max(dep * 0.022, 1.2)).extrude(dep * 0.68).translate((0, -dep * 0.34, 0))
            block = block.cut(drill)

        freeze_a = cq.Workplane("XZ").center(-w * 0.20, -h * 0.04).circle(max(dep * 0.055, 2.5)).extrude(dep * 0.16).translate((0, -dep * 0.52, 0))
        freeze_b = cq.Workplane("XZ").center(w * 0.20, -h * 0.04).circle(max(dep * 0.055, 2.5)).extrude(dep * 0.16).translate((0, dep * 0.36, 0))
        block = block.cut(freeze_a).cut(freeze_b)

        mount_pad_a = cq.Workplane("XY").box(w * 0.16, dep * 0.12, h * 0.18).translate((-w * 0.24, -dep * 0.44, -h * 0.02))
        mount_pad_b = cq.Workplane("XY").box(w * 0.16, dep * 0.12, h * 0.18).translate((w * 0.24, dep * 0.44, -h * 0.02))
        return block.union(mount_pad_a).union(mount_pad_b)


def _geo_cylinder_head(cq, d):
        """Cylinder head with dual cam towers, chambers, port rails, and plug wells."""
        w = max(float(d.get("width", d.get("w", d.get("x", 380)))), 1.0)
        h = max(float(d.get("height", d.get("h", d.get("z", 78)))), 1.0)
        dep = max(float(d.get("depth", d.get("d", d.get("y", 220)))), 1.0)
        cylinders = max(int(d.get("cylinders", 4)), 1)
        chamber_d = max(float(d.get("chamber_diameter", d.get("bore", 86))) * 0.92, 1.0)

        base = cq.Workplane("XY").box(w, dep * 0.86, h * 0.62).translate((0, 0, -h * 0.06))
        deck = cq.Workplane("XY").box(w * 0.98, dep * 0.92, h * 0.16).translate((0, 0, -h * 0.28))
        cam_a = cq.Workplane("XY").box(w * 0.92, dep * 0.18, h * 0.30).translate((0, -dep * 0.23, h * 0.24))
        cam_b = cq.Workplane("XY").box(w * 0.92, dep * 0.18, h * 0.30).translate((0, dep * 0.23, h * 0.24))
        side_rail_a = cq.Workplane("XY").box(w * 0.94, dep * 0.10, h * 0.20).translate((0, -dep * 0.38, -h * 0.02))
        side_rail_b = cq.Workplane("XY").box(w * 0.94, dep * 0.10, h * 0.20).translate((0, dep * 0.38, -h * 0.02))
        head = base.union(deck).union(cam_a).union(cam_b).union(side_rail_a).union(side_rail_b)

        pitch = w / max(cylinders + 0.4, 1.0)
        start_x = -w / 2.0 + pitch * 0.7
        tower_w = pitch * 0.18
        for i in range(cylinders):
            cx = start_x + i * pitch
            chamber = cq.Workplane("XY").center(cx, 0).circle(chamber_d / 2.0).extrude(h * 0.22).translate((0, 0, -h * 0.39))
            spark_well = cq.Workplane("XY").center(cx, 0).circle(chamber_d * 0.09).extrude(h * 0.78).translate((0, 0, -h * 0.02))
            intake_boss = cq.Workplane("XY").center(cx - chamber_d * 0.16, -dep * 0.17).circle(chamber_d * 0.10).extrude(h * 0.28).translate((0, 0, -h * 0.10))
            exhaust_boss = cq.Workplane("XY").center(cx + chamber_d * 0.16, dep * 0.17).circle(chamber_d * 0.09).extrude(h * 0.24).translate((0, 0, -h * 0.12))
            intake_stub = cq.Workplane("XZ").center(cx - chamber_d * 0.18, -h * 0.02).circle(chamber_d * 0.11).extrude(dep * 0.22).translate((0, -dep * 0.46, 0))
            exhaust_stub = cq.Workplane("XZ").center(cx + chamber_d * 0.18, -h * 0.03).circle(chamber_d * 0.10).extrude(dep * 0.20).translate((0, dep * 0.26, 0))
            intake_port_core = cq.Workplane("XZ").center(cx - chamber_d * 0.18, -h * 0.02).circle(chamber_d * 0.060).extrude(dep * 0.74).translate((0, -dep * 0.44, 0))
            exhaust_port_core = cq.Workplane("XZ").center(cx + chamber_d * 0.18, -h * 0.03).circle(chamber_d * 0.055).extrude(dep * 0.70).translate((0, -dep * 0.26, 0))
            valve_seat_in = cq.Workplane("XY").center(cx - chamber_d * 0.14, -dep * 0.07).circle(chamber_d * 0.055).extrude(h * 0.12).translate((0, 0, -h * 0.30))
            valve_seat_ex = cq.Workplane("XY").center(cx + chamber_d * 0.14, dep * 0.07).circle(chamber_d * 0.052).extrude(h * 0.12).translate((0, 0, -h * 0.30))
            cam_cap_a = cq.Workplane("XY").box(tower_w, dep * 0.10, h * 0.16).translate((cx, -dep * 0.23, h * 0.42))
            cam_cap_b = cq.Workplane("XY").box(tower_w, dep * 0.10, h * 0.16).translate((cx, dep * 0.23, h * 0.42))
            head = head.cut(chamber).cut(spark_well).cut(intake_port_core).cut(exhaust_port_core).cut(valve_seat_in).cut(valve_seat_ex).union(intake_boss).union(exhaust_boss).union(intake_stub).union(exhaust_stub).union(cam_cap_a).union(cam_cap_b)

        cam_tunnel_a = cq.Workplane("YZ").center(-dep * 0.23, h * 0.24).circle(max(dep * 0.030, 2.0)).extrude(w * 0.90).translate((-w * 0.45, 0, 0))
        cam_tunnel_b = cq.Workplane("YZ").center(dep * 0.23, h * 0.24).circle(max(dep * 0.030, 2.0)).extrude(w * 0.90).translate((-w * 0.45, 0, 0))
        oil_feed = cq.Workplane("YZ").center(0, h * 0.08).circle(max(dep * 0.018, 1.2)).extrude(w * 0.94).translate((-w * 0.47, 0, 0))
        cool_rail_a = cq.Workplane("YZ").center(-dep * 0.30, -h * 0.12).circle(max(dep * 0.020, 1.2)).extrude(w * 0.94).translate((-w * 0.47, 0, 0))
        cool_rail_b = cq.Workplane("YZ").center(dep * 0.30, -h * 0.12).circle(max(dep * 0.020, 1.2)).extrude(w * 0.94).translate((-w * 0.47, 0, 0))
        return head.cut(cam_tunnel_a).cut(cam_tunnel_b).cut(oil_feed).cut(cool_rail_a).cut(cool_rail_b)


def _geo_intake_manifold(cq, d):
        """Plenum-style intake manifold with flange rail, tapered runners, and throttle body."""
        w = max(float(d.get("width", d.get("w", d.get("x", 360)))), 1.0)
        h = max(float(d.get("height", d.get("h", d.get("z", 120)))), 1.0)
        dep = max(float(d.get("depth", d.get("d", d.get("y", 140)))), 1.0)
        runners = max(int(d.get("runners", d.get("cylinders", 4))), 1)

        plenum_core = cq.Workplane("XY").box(w * 0.50, dep * 0.36, h * 0.34).translate((0, 0, h * 0.24))
        plenum_end_a = cq.Workplane("YZ").circle(dep * 0.18).extrude(w * 0.08).translate((-w * 0.29, 0, h * 0.24))
        plenum_end_b = cq.Workplane("YZ").circle(dep * 0.18).extrude(w * 0.08).translate((w * 0.21, 0, h * 0.24))
        flange = cq.Workplane("XY").box(w * 0.94, dep * 0.10, h * 0.14).translate((0, dep * 0.36, -h * 0.14))
        manifold = plenum_core.union(plenum_end_a).union(plenum_end_b).union(flange)

        plenum_core_cut = cq.Workplane("XY").box(w * 0.42, dep * 0.24, h * 0.22).translate((0, 0, h * 0.24))
        manifold = manifold.cut(plenum_core_cut)

        pitch = w / max(runners + 0.6, 1.0)
        start_x = -w / 2.0 + pitch * 0.8
        runner_od = dep * 0.11
        runner_len = dep * 0.44
        for i in range(runners):
            rx = start_x + i * pitch
            entry = cq.Workplane("XY").center(rx, dep * 0.10).circle(runner_od * 0.62).extrude(h * 0.16).translate((0, 0, h * 0.02))
            runner = cq.Workplane("XZ").center(rx, h * 0.02).circle(runner_od / 2.0).extrude(runner_len).translate((0, -dep * 0.02, 0))
            trumpet = cq.Workplane("XZ").center(rx, h * 0.04).circle(runner_od * 0.58).extrude(dep * 0.16).translate((0, dep * 0.10, 0))
            runner_core = cq.Workplane("XZ").center(rx, h * 0.02).circle(max(runner_od * 0.32, 0.8)).extrude(runner_len + dep * 0.10).translate((0, -dep * 0.08, 0))
            manifold = manifold.union(entry).union(runner).union(trumpet).cut(runner_core)

        throttle_neck = cq.Workplane("XY").box(w * 0.12, dep * 0.18, h * 0.18).translate((-w * 0.32, 0, h * 0.24))
        throttle_body = cq.Workplane("YZ").circle(dep * 0.15).extrude(w * 0.12).translate((-w * 0.38, 0, h * 0.24))
        return manifold.union(throttle_neck).union(throttle_body)


def _geo_exhaust_manifold(cq, d):
        """Header-style exhaust manifold with flange rail, primaries, merge body, and outlet."""
        w = max(float(d.get("width", d.get("w", d.get("x", 340)))), 1.0)
        h = max(float(d.get("height", d.get("h", d.get("z", 110)))), 1.0)
        dep = max(float(d.get("depth", d.get("d", d.get("y", 120)))), 1.0)
        runners = max(int(d.get("runners", d.get("cylinders", 4))), 1)
        runner_od = max(float(d.get("runner_diameter", 32)), 1.0)

        flange = cq.Workplane("XY").box(w * 0.90, dep * 0.08, h * 0.16).translate((0, -dep * 0.34, 0))
        merge = cq.Workplane("XY").box(w * 0.26, dep * 0.16, h * 0.18).translate((w * 0.22, dep * 0.02, -h * 0.02))
        collector = cq.Workplane("YZ").circle(dep * 0.12).extrude(w * 0.18).translate((w * 0.28, dep * 0.04, -h * 0.02))
        outlet = cq.Workplane("YZ").circle(dep * 0.10).extrude(w * 0.18).translate((w * 0.38, dep * 0.06, -h * 0.02))
        manifold = flange.union(merge).union(collector).union(outlet)

        merge_core = cq.Workplane("XY").box(w * 0.18, dep * 0.09, h * 0.10).translate((w * 0.22, dep * 0.02, -h * 0.02))
        collector_core = cq.Workplane("YZ").circle(max(dep * 0.07, 1.0)).extrude(w * 0.16).translate((w * 0.27, dep * 0.04, -h * 0.02))
        outlet_core = cq.Workplane("YZ").circle(max(dep * 0.055, 1.0)).extrude(w * 0.16).translate((w * 0.38, dep * 0.06, -h * 0.02))
        manifold = manifold.cut(merge_core).cut(collector_core).cut(outlet_core)

        pitch = w / max(runners + 0.5, 1.0)
        start_x = -w / 2.0 + pitch * 0.72
        primary_len = dep * 0.46
        for i in range(runners):
            rx = start_x + i * pitch
            rz = -h * 0.08 + (i - (runners - 1) / 2.0) * (h * 0.10)
            port_stub = cq.Workplane("XZ").center(rx, rz).circle(runner_od * 0.52).extrude(dep * 0.14).translate((0, -dep * 0.40, 0))
            primary = cq.Workplane("XZ").center(rx, rz).circle(runner_od / 2.0).extrude(primary_len).translate((0, -dep * 0.26, 0))
            primary_core = cq.Workplane("XZ").center(rx, rz).circle(max(runner_od * 0.30, 0.8)).extrude(primary_len + dep * 0.10).translate((0, -dep * 0.34, 0))
            brace = cq.Workplane("XY").box(pitch * 0.20, dep * 0.08, h * 0.10).translate((rx, -dep * 0.10, rz))
            manifold = manifold.union(port_stub).union(primary).union(brace).cut(primary_core)
        return manifold


def _geo_turbocharger(cq, d):
        """Turbocharger with compressor and turbine housings, center cartridge, and flanges."""
        comp_d = max(float(d.get("compressor_diameter", d.get("diameter", 96))), 1.0)
        turb_d = max(float(d.get("turbine_diameter", d.get("turbine_d", 88))), 1.0)
        length = max(float(d.get("length", d.get("L", 170))), 1.0)
        shaft_d = max(float(d.get("shaft_diameter", 14)), 0.5)

        comp = cq.Workplane("YZ").circle(comp_d / 2.0).extrude(length * 0.30).translate((-length * 0.30, 0, 0))
        turb = cq.Workplane("YZ").circle(turb_d / 2.0).extrude(length * 0.30).translate((length * 0.00, 0, 0))
        chra = cq.Workplane("YZ").circle(max(comp_d, turb_d) * 0.24).extrude(length * 0.34).translate((-length * 0.02, 0, 0))
        shaft = cq.Workplane("YZ").circle(shaft_d / 2.0).extrude(length * 0.62).translate((-length * 0.16, 0, 0))
        inlet = cq.Workplane("XY").box(length * 0.10, comp_d * 0.30, comp_d * 0.24).translate((-length * 0.42, 0, 0))
        outlet = cq.Workplane("XY").box(length * 0.10, turb_d * 0.26, turb_d * 0.20).translate((length * 0.26, 0, 0))
        mount = cq.Workplane("XY").box(length * 0.18, max(comp_d, turb_d) * 0.26, max(comp_d, turb_d) * 0.12).translate((-length * 0.02, 0, -max(comp_d, turb_d) * 0.30))
        turbo = comp.union(turb).union(chra).union(shaft).union(inlet).union(outlet).union(mount)

        comp_volute_core = cq.Workplane("YZ").center(0, 0).circle(max(comp_d * 0.24, 1.0)).extrude(length * 0.24).translate((-length * 0.28, 0, 0))
        turb_volute_core = cq.Workplane("YZ").center(0, 0).circle(max(turb_d * 0.22, 1.0)).extrude(length * 0.24).translate((length * 0.02, 0, 0))
        center_bearing_bore = cq.Workplane("YZ").circle(max(shaft_d * 0.58, 0.8)).extrude(length * 0.40).translate((-length * 0.08, 0, 0))
        wastegate_port = cq.Workplane("XY").center(length * 0.08, turb_d * 0.20).circle(max(turb_d * 0.045, 0.8)).extrude(turb_d * 0.45).translate((0, 0, -turb_d * 0.22))
        oil_feed = cq.Workplane("XY").center(-length * 0.02, 0).circle(max(shaft_d * 0.22, 0.6)).extrude(max(comp_d, turb_d) * 0.30).translate((0, 0, max(comp_d, turb_d) * 0.05))
        return turbo.cut(comp_volute_core).cut(turb_volute_core).cut(center_bearing_bore).cut(wastegate_port).cut(oil_feed)


def _geo_oil_pump(cq, d):
        """Gerotor-style oil pump body with inner and outer rotor pockets and outlet boss."""
        od = max(float(d.get("outer_diameter", d.get("diameter", 110))), 1.0)
        thick = max(float(d.get("thickness", d.get("height", 36))), 0.5)
        inner_rotor = max(float(d.get("inner_rotor_diameter", 46)), 0.5)
        outer_rotor = max(float(d.get("outer_rotor_diameter", 72)), inner_rotor + 1.0)

        body = cq.Workplane("XY").circle(od / 2.0).extrude(thick)
        pocket_outer = cq.Workplane("XY").center(od * 0.05, 0).circle(outer_rotor / 2.0).extrude(thick * 0.70).translate((0, 0, thick * 0.15))
        pocket_inner = cq.Workplane("XY").center(-od * 0.05, 0).circle(inner_rotor / 2.0).extrude(thick * 0.70).translate((0, 0, thick * 0.15))
        inlet = cq.Workplane("XY").box(od * 0.22, od * 0.10, thick * 0.32).translate((-od * 0.28, 0, thick * 0.50))
        outlet = cq.Workplane("XY").box(od * 0.22, od * 0.10, thick * 0.32).translate((od * 0.28, 0, thick * 0.50))
        center_bore = cq.Workplane("XY").circle(inner_rotor * 0.24).extrude(thick)
        flow_bridge = cq.Workplane("XY").box(od * 0.22, od * 0.08, thick * 0.22).translate((0, 0, thick * 0.56))
        pressure_relief = cq.Workplane("YZ").center(0, thick * 0.20).circle(max(od * 0.020, 0.8)).extrude(od * 0.26).translate((-od * 0.13, 0, 0))
        bolt_a = cq.Workplane("XY").center(od * 0.30, od * 0.30).circle(od * 0.03).extrude(thick)
        bolt_b = cq.Workplane("XY").center(-od * 0.30, od * 0.30).circle(od * 0.03).extrude(thick)
        bolt_c = cq.Workplane("XY").center(od * 0.30, -od * 0.30).circle(od * 0.03).extrude(thick)
        bolt_d = cq.Workplane("XY").center(-od * 0.30, -od * 0.30).circle(od * 0.03).extrude(thick)
        return body.cut(pocket_outer).cut(pocket_inner).cut(center_bore).cut(flow_bridge).cut(pressure_relief).cut(bolt_a).cut(bolt_b).cut(bolt_c).cut(bolt_d).union(inlet).union(outlet)


def _geo_water_pump(cq, d):
        """Water pump housing with impeller cavity, hub, and hose neck."""
        imp_d = max(float(d.get("impeller_diameter", d.get("diameter", 72))), 1.0)
        body_d = max(float(d.get("body_diameter", 90)), imp_d)
        length = max(float(d.get("length", d.get("L", 120))), 1.0)
        hub_d = max(float(d.get("hub_diameter", 24)), 0.5)

        volute = cq.Workplane("YZ").circle(body_d / 2.0).extrude(length * 0.42).translate((-length * 0.20, 0, 0))
        nose = cq.Workplane("YZ").circle(body_d * 0.36).extrude(length * 0.30).translate((length * 0.04, 0, 0))
        neck = cq.Workplane("XY").box(length * 0.18, body_d * 0.34, body_d * 0.22).translate((-length * 0.04, body_d * 0.34, 0))
        hub = cq.Workplane("YZ").circle(hub_d / 2.0).extrude(length * 0.62).translate((-length * 0.22, 0, 0))
        cavity = cq.Workplane("YZ").circle(imp_d / 2.0).extrude(length * 0.24).translate((-length * 0.22, 0, 0))
        inlet_throat = cq.Workplane("YZ").circle(max(imp_d * 0.34, 1.0)).extrude(length * 0.22).translate((-length * 0.30, 0, 0))
        volute_core = cq.Workplane("YZ").center(0, 0).circle(max(imp_d * 0.36, 1.0)).extrude(length * 0.28).translate((-length * 0.18, 0, 0))
        shaft_bore = cq.Workplane("YZ").circle(max(hub_d * 0.28, 0.8)).extrude(length * 0.66).translate((-length * 0.24, 0, 0))
        bolt_a = cq.Workplane("YZ").center(0, body_d * 0.30).circle(body_d * 0.035).extrude(length * 0.14).translate((-length * 0.26, 0, 0))
        bolt_b = cq.Workplane("YZ").center(0, -body_d * 0.30).circle(body_d * 0.035).extrude(length * 0.14).translate((-length * 0.26, 0, 0))
        return volute.union(nose).union(neck).union(hub).cut(cavity).cut(inlet_throat).cut(volute_core).cut(shaft_bore).cut(bolt_a).cut(bolt_b)


def _geo_clutch_disc(cq, d):
        """Clutch disc with friction ring, spring hub, and drive windows."""
        od = max(float(d.get("outer_diameter", d.get("diameter", 240))), 1.0)
        id_ = max(float(d.get("inner_diameter", 130)), 0.5)
        thick = max(float(d.get("thickness", 8)), 0.5)
        hub_d = max(float(d.get("hub_diameter", 26)), 0.5)

        disc = cq.Workplane("XY").circle(od / 2.0).circle(id_ / 2.0).extrude(thick)
        hub = cq.Workplane("XY").circle(hub_d / 2.0).extrude(thick * 1.9).translate((0, 0, -thick * 0.45))
        spring_ring = cq.Workplane("XY").circle(id_ * 0.34).circle(id_ * 0.24).extrude(thick * 1.4).translate((0, 0, -thick * 0.20))
        disc = disc.union(hub).union(spring_ring)

        for i in range(6):
            ang = (2.0 * math.pi * i) / 6.0
            rx = math.cos(ang) * (id_ * 0.30)
            ry = math.sin(ang) * (id_ * 0.30)
            win = cq.Workplane("XY").center(rx, ry).circle(id_ * 0.06).extrude(thick * 1.6).translate((0, 0, -thick * 0.25))
            disc = disc.cut(win)
        return disc


def _geo_timing_chain(cq, d):
        """Approximate closed-loop timing chain with repeated link segments."""
        pitch = max(float(d.get("pitch", 9.525)), 0.5)
        links = max(int(d.get("link_count", 96)), 8)
        width = max(float(d.get("width", 18)), 1.0)
        roller_d = max(float(d.get("roller_diameter", 6.2)), 0.5)

        loop_r = max((links * pitch) / (2.0 * math.pi), pitch * 2.0)
        link_w = pitch * 0.72
        link_t = max(width * 0.14, 0.8)
        chain = None
        for i in range(links):
            a = (2.0 * math.pi * i) / links
            x = math.cos(a) * loop_r
            y = math.sin(a) * loop_r
            link = cq.Workplane("XY").box(link_w, width, link_t).translate((x, y, 0))
            roller = cq.Workplane("XY").center(x, y).circle(roller_d / 2.0).extrude(width * 0.80).translate((0, 0, -width * 0.40))
            seg = link.union(roller)
            chain = seg if chain is None else chain.union(seg)
        return chain if chain is not None else cq.Workplane("XY").box(pitch, width, link_t)


def _geo_oil_pan(cq, d):
        """Cast-aluminium oil sump with flat bottom, side baffles, and drain-boss."""
        w   = max(float(d.get("width",  d.get("x", 420))), 1.0)
        dep = max(float(d.get("depth",  d.get("y", 200))), 1.0)
        h   = max(float(d.get("height", d.get("z",  85))), 1.0)
        wall = max(float(d.get("wall_thickness", 4.0)), 1.0)

        outer = cq.Workplane("XY").box(w, dep, h)
        inner = cq.Workplane("XY").box(w - wall*2, dep - wall*2, h - wall).translate((0, 0, wall*0.5))
        pan = outer.cut(inner)

        # Flange rail along the top perimeter
        flange = cq.Workplane("XY").box(w, dep, wall * 1.5).translate((0, 0, h/2.0 - wall*0.25))
        pan = pan.union(flange)

        # Internal baffles (2 cross-walls)
        baffle_a = cq.Workplane("XY").box(wall * 1.5, dep - wall*4, h * 0.55).translate((-w*0.20, 0, -h*0.18))
        baffle_b = cq.Workplane("XY").box(wall * 1.5, dep - wall*4, h * 0.55).translate(( w*0.20, 0, -h*0.18))
        pan = pan.union(baffle_a).union(baffle_b)

        # Drain boss on bottom
        boss = cq.Workplane("XY").circle(wall*2.8).extrude(wall*2).translate((0, dep*0.35, -h/2.0 - wall*1.0))
        drain = cq.Workplane("XY").circle(wall*1.1).extrude(wall*3).translate((0, dep*0.35, -h/2.0 - wall*1.2))
        pan = pan.union(boss).cut(drain)

        # Mounting bosses at corners
        for sx, sy in [(-0.44, -0.42), (0.44, -0.42), (-0.44, 0.42), (0.44, 0.42)]:
            mb = cq.Workplane("XY").circle(wall*2.2).extrude(wall*1.8).translate((w*sx, dep*sy, h/2.0 - wall*0.5))
            mbh = cq.Workplane("XY").circle(wall*0.9).extrude(wall*3.0).translate((w*sx, dep*sy, h/2.0 - wall*0.5))
            pan = pan.union(mb).cut(mbh)
        return pan


def _geo_valve_cover(cq, d):
        """Valve / cam cover with raised fins, oil-fill boss, and breather port."""
        w    = max(float(d.get("width",  d.get("x", 440))), 1.0)
        dep  = max(float(d.get("depth",  d.get("y", 195))), 1.0)
        h    = max(float(d.get("height", d.get("z",  62))), 1.0)
        wall = max(float(d.get("wall_thickness", 3.5)), 1.0)

        # Shell
        outer = cq.Workplane("XY").box(w, dep, h)
        inner = cq.Workplane("XY").box(w - wall*2, dep - wall*2, h - wall).translate((0, 0, -wall*0.5))
        cover = outer.cut(inner)

        # Longitudinal stiffening ribs on top
        rib_h = h * 0.32
        rib_t = wall * 1.2
        for i in range(5):
            rx = -w*0.38 + i*(w*0.19)
            rib = cq.Workplane("XY").box(rib_t, dep*0.82, rib_h).translate((rx, 0, h*0.5 - rib_h*0.5 + wall*0.5))
            cover = cover.union(rib)

        # Oil-fill cap boss (offset to one end)
        fill_boss = cq.Workplane("XY").circle(wall*4.5).extrude(wall*3.0).translate((w*0.32, dep*0.08, h/2.0 + wall*0.5))
        fill_hole = cq.Workplane("XY").circle(wall*2.8).extrude(wall*4.0).translate((w*0.32, dep*0.08, h/2.0 - wall*0.5))
        cover = cover.union(fill_boss).cut(fill_hole)

        # Breather / PCV nipple
        breather = cq.Workplane("XY").circle(wall*2.0).extrude(wall*2.8).translate((-w*0.36, 0, h/2.0 + wall*0.3))
        breather_hole = cq.Workplane("XY").circle(wall*1.1).extrude(wall*4.0).translate((-w*0.36, 0, h/2.0 - wall*0.5))
        cover = cover.union(breather).cut(breather_hole)

        # Flange lip at bottom perimeter
        flange = cq.Workplane("XY").box(w, dep, wall*1.4).translate((0, 0, -h/2.0 + wall*0.35))
        cover = cover.union(flange)
        return cover


def _geo_throttle_body(cq, d):
        """Circular throttle body bore with flanged face and TPS boss."""
        bore_d = max(float(d.get("bore_diameter", d.get("diameter", 70))), 1.0)
        length = max(float(d.get("length",  d.get("z",  80))), 1.0)
        flange = max(float(d.get("flange_thickness", 12)), 1.0)
        wall   = max(float(d.get("wall_thickness",  6.0)), 1.0)

        body = cq.Workplane("XY").circle((bore_d/2.0) + wall).extrude(length)
        bore  = cq.Workplane("XY").circle(bore_d/2.0).extrude(length)
        body  = body.cut(bore)

        # Inlet flange
        fl = cq.Workplane("XY").rect((bore_d + wall*4)*1.05, (bore_d + wall*4)*1.05).extrude(flange).translate((0, 0, -flange*0.5))
        body = body.union(fl)

        # Outlet flange
        fl2 = cq.Workplane("XY").rect((bore_d + wall*4)*1.05, (bore_d + wall*4)*1.05).extrude(flange).translate((0, 0, length - flange*0.5))
        body = body.union(fl2)

        # TPS (throttle position sensor) boss on side
        tps_boss = cq.Workplane("XZ").center(0, length*0.5).circle(wall*2.2).extrude(wall*2.4).translate((0, -(bore_d/2.0 + wall*2.0), 0))
        tps_hole = cq.Workplane("XZ").center(0, length*0.5).circle(wall*0.9).extrude(wall*2.6).translate((0, -(bore_d/2.0 + wall*2.2), 0))
        body = body.union(tps_boss).cut(tps_hole)

        # Butterfly shaft hole (cross-bore)
        shaft = cq.Workplane("YZ").center(0, length*0.5).circle(wall*0.55).extrude((bore_d + wall*2)*1.1).translate((-(bore_d/2.0 + wall)*1.05, 0, 0))
        return body.cut(shaft)


def _geo_intercooler(cq, d):
        """Charge-air intercooler: aluminium core matrix with end tanks and inlet/outlet nozzles."""
        w    = max(float(d.get("width",  d.get("x", 550))), 1.0)
        h    = max(float(d.get("height", d.get("z", 200))), 1.0)
        dep  = max(float(d.get("depth",  d.get("y",  80))), 1.0)
        wall = max(float(d.get("wall_thickness", 3.0)), 1.0)
        tank_w = max(w * 0.10, wall * 4)

        # Core matrix
        core = cq.Workplane("XY").box(w - tank_w*2, h, dep)

        # Internal air passages (fin-channel approximation: 12 rectangular channels)
        ch_h = (h - wall*2) / 13.0
        for i in range(12):
            cy = -h/2.0 + wall + ch_h*(i + 0.5) + ch_h*0.1
            ch = cq.Workplane("XZ").center(0, cy).box(w - tank_w*2 - wall*2, dep - wall*2, ch_h*0.72)
            core = core.cut(ch)

        # End tanks
        tank_l = cq.Workplane("XY").box(tank_w, h, dep).translate((-w/2.0 + tank_w/2.0, 0, 0))
        tank_r = cq.Workplane("XY").box(tank_w, h, dep).translate(( w/2.0 - tank_w/2.0, 0, 0))
        tank_cavity_l = cq.Workplane("XY").box(tank_w - wall*2, h - wall*2, dep - wall*2).translate((-w/2.0 + tank_w/2.0, 0, 0))
        tank_cavity_r = cq.Workplane("XY").box(tank_w - wall*2, h - wall*2, dep - wall*2).translate(( w/2.0 - tank_w/2.0, 0, 0))

        ic = core.union(tank_l).union(tank_r).cut(tank_cavity_l).cut(tank_cavity_r)

        # Inlet and outlet nozzles on the end tanks
        noz_r = max(dep * 0.22, wall*3)
        for xsign, ysign in [(-1, -1), (1, 1)]:
            noz = cq.Workplane("XY").circle(noz_r).extrude(wall*4).translate((xsign*(w/2.0 + wall*1.5), ysign*(h*0.18), 0))
            noz_hole = cq.Workplane("XY").circle(noz_r - wall).extrude(wall*6).translate((xsign*(w/2.0 + wall*0.5), ysign*(h*0.18), 0))
            ic = ic.union(noz).cut(noz_hole)
        return ic


def _geo_radiator(cq, d):
        """Coolant radiator with aluminium core, plastic end tanks, and hose necks."""
        w    = max(float(d.get("width",  d.get("x", 640))), 1.0)
        h    = max(float(d.get("height", d.get("z", 480))), 1.0)
        dep  = max(float(d.get("depth",  d.get("y",  36))), 1.0)
        wall = max(float(d.get("wall_thickness", 2.0)), 1.0)
        tank_h = max(h * 0.12, wall * 6)

        # Aluminium core
        core = cq.Workplane("XY").box(w, h - tank_h*2, dep)

        # Cooling tube channels (16 horizontal passes)
        ch_h = (h - tank_h*2 - wall*2) / 17.0
        for i in range(16):
            cy = -(h - tank_h*2)/2.0 + wall + ch_h*(i + 0.5)
            ch = cq.Workplane("XZ").center(0, cy).box(w - wall*2, dep - wall*2, ch_h*0.65)
            core = core.cut(ch)

        # Top/bottom plastic tanks
        tank_top = cq.Workplane("XY").box(w, tank_h, dep).translate((0,  (h - tank_h*2)/2.0 + tank_h/2.0, 0))
        tank_bot = cq.Workplane("XY").box(w, tank_h, dep).translate((0, -(h - tank_h*2)/2.0 - tank_h/2.0, 0))
        t_cav_top = cq.Workplane("XY").box(w - wall*2, tank_h - wall*2, dep - wall*2).translate((0,  (h - tank_h*2)/2.0 + tank_h/2.0, 0))
        t_cav_bot = cq.Workplane("XY").box(w - wall*2, tank_h - wall*2, dep - wall*2).translate((0, -(h - tank_h*2)/2.0 - tank_h/2.0, 0))

        rad = core.union(tank_top).union(tank_bot).cut(t_cav_top).cut(t_cav_bot)

        # Hose necks: inlet top-left, outlet bottom-right
        neck_r = max(dep * 0.38, wall*4)
        neck_in  = cq.Workplane("XZ").center(-w*0.35, (h - tank_h*2)/2.0 + tank_h*0.5).circle(neck_r).extrude(dep*0.7).translate((0, dep/2.0, 0))
        neck_in_hole = cq.Workplane("XZ").center(-w*0.35, (h - tank_h*2)/2.0 + tank_h*0.5).circle(neck_r - wall).extrude(dep).translate((0, dep/2.0 - wall, 0))
        neck_out = cq.Workplane("XZ").center( w*0.35, -(h - tank_h*2)/2.0 - tank_h*0.5).circle(neck_r).extrude(dep*0.7).translate((0, dep/2.0, 0))
        neck_out_hole = cq.Workplane("XZ").center( w*0.35, -(h - tank_h*2)/2.0 - tank_h*0.5).circle(neck_r - wall).extrude(dep).translate((0, dep/2.0 - wall, 0))
        rad = rad.union(neck_in).cut(neck_in_hole).union(neck_out).cut(neck_out_hole)

        # Overflow tank nipple
        ov = cq.Workplane("XZ").center(w*0.42, (h - tank_h*2)/2.0 + tank_h*0.5).circle(wall*2.2).extrude(dep).translate((0, dep/2.0, 0))
        ov_h = cq.Workplane("XZ").center(w*0.42, (h - tank_h*2)/2.0 + tank_h*0.5).circle(wall*0.9).extrude(dep*1.2).translate((0, dep/2.0 - wall*0.5, 0))
        return rad.union(ov).cut(ov_h)


def _geo_oil_filter(cq, d):
        """Spin-on cylindrical oil filter with sealing end-cap and anti-drain valve boss."""
        od   = max(float(d.get("outer_diameter", d.get("diameter", 78))), 1.0)
        h    = max(float(d.get("height", d.get("z", 102))), 1.0)
        wall = max(float(d.get("wall_thickness", 2.5)), 1.0)
        thread_d = max(float(d.get("thread_diameter", 22)), 1.0)

        # Canister body
        canister = cq.Workplane("XY").circle(od/2.0).extrude(h * 0.90)
        # Rounded dome on top
        dome_cut = cq.Workplane("XY").circle(od/2.0 - wall).extrude(h*0.88).translate((0,0,wall))
        canister = canister.cut(dome_cut)

        # Base end-cap (flat, slightly thicker)
        base = cq.Workplane("XY").circle(od/2.0).extrude(h * 0.10).translate((0, 0, h*0.90))
        canister = canister.union(base)

        # Center threaded port
        thread_boss = cq.Workplane("XY").circle(thread_d*0.65).extrude(h*0.12).translate((0, 0, h*0.90 - h*0.01))
        thread_hole = cq.Workplane("XY").circle(thread_d/2.0).extrude(h*0.16).translate((0, 0, h*0.87))
        canister = canister.union(thread_boss).cut(thread_hole)

        # Ring of inlet ports around center (8×)
        port_r = thread_d * 1.05
        for i in range(8):
            ang = (2*math.pi * i)/8.0
            px, py = math.cos(ang)*port_r, math.sin(ang)*port_r
            port = cq.Workplane("XY").center(px, py).circle(thread_d*0.18).extrude(h*0.16).translate((0,0,h*0.87))
            canister = canister.cut(port)

        # Hex flats on body for grip (6 longitudinal grooves)
        hex_od = od * 0.98
        for i in range(6):
            ang = (math.pi * i) / 6.0
            hx = math.cos(ang) * (hex_od / 2.0 + wall * 0.3)
            hy = math.sin(ang) * (hex_od / 2.0 + wall * 0.3)
            flat_cut = cq.Workplane("XY").center(hx, hy).box(wall * 1.4, od, h * 0.80).translate((0, 0, h * 0.45))
            canister = canister.cut(flat_cut)
        return canister


# ─── Dispatch table ───────────────────────────────────────────────────────────

_SHAPE_FN = {
    "box":          _geo_box,
    "plate":        _geo_plate,
    "cylinder":     _geo_cylinder,
    "tube":         _geo_tube,
    "shaft":        _geo_shaft,
    "axle":         _geo_shaft,
    "flange":       _geo_flange,
    "gear":         _geo_gear,
    "worm_gear":    _geo_gear,
    "bevel_gear":   _geo_gear,
    "bearing":      _geo_bearing,
    "ball_bearing": _geo_bearing,
    "spring":       _geo_spring,
    "nozzle":       _geo_nozzle,
    "dome":         _geo_dome,
    "impeller":     _geo_impeller,
    "ibeam":        _geo_ibeam,
    "bracket":      _geo_bracket,
    "housing":      _geo_housing,
    "pcb":          _geo_pcb,
    "o_ring":       _geo_o_ring,
    "bolt":         _geo_bolt,
    "bolt_hex":     _geo_bolt,
    "lip_seal":     _geo_lip_seal,
    "gasket":       _geo_gasket,
    "coil_over":    _geo_coil_over,
    "rotor_blade":  _geo_rotor_blade,
    "turbine_blade":_geo_rotor_blade,
    "coupling":     _geo_coupling,
    "worm_drive":   _geo_worm_drive,
    "brake_rotor":  _geo_brake_rotor,
    "ball_joint":   _geo_ball_joint,
    "wire":         _geo_wire,
    "beam":         _geo_ibeam,
    "rod":          _geo_cylinder,
    "piston":       _geo_piston,
    "crankshaft":   _geo_crankshaft,
    "camshaft":     _geo_camshaft,
    "flywheel":     _geo_flywheel,
    "pulley":       _geo_pulley,
    "connector":    _geo_connector,
    "con_rod":      _geo_con_rod,
    "connecting_rod": _geo_con_rod,
    "cylinder_liner": _geo_cylinder_liner,
    "cylinder_sleeve": _geo_cylinder_liner,
    "valve":        _geo_valve,
    "valve_intake": _geo_valve,
    "valve_exhaust": _geo_valve,
    "spark_plug":   _geo_spark_plug,
    "fuel_injector": _geo_fuel_injector,
    "engine_block": _geo_engine_block,
    "block":        _geo_engine_block,
    "short_block":  _geo_engine_block,
    "cylinder_head": _geo_cylinder_head,
    "head":         _geo_cylinder_head,
    "dohc_head":    _geo_cylinder_head,
    "sohc_head":    _geo_cylinder_head,
    "intake_manifold": _geo_intake_manifold,
    "inlet_manifold": _geo_intake_manifold,
    "exhaust_manifold": _geo_exhaust_manifold,
    "header":       _geo_exhaust_manifold,
    "turbocharger": _geo_turbocharger,
    "turbo":        _geo_turbocharger,
    "oil_pump":     _geo_oil_pump,
    "water_pump":   _geo_water_pump,
    "clutch_disc":  _geo_clutch_disc,
    "timing_chain": _geo_timing_chain,
    "timing_belt":  _geo_timing_chain,
    "oil_pan":      _geo_oil_pan,
    "sump":         _geo_oil_pan,
    "oil_sump":     _geo_oil_pan,
    "valve_cover":  _geo_valve_cover,
    "cam_cover":    _geo_valve_cover,
    "rocker_cover": _geo_valve_cover,
    "throttle_body":_geo_throttle_body,
    "throttle":     _geo_throttle_body,
    "intercooler":  _geo_intercooler,
    "charge_cooler":_geo_intercooler,
    "radiator":     _geo_radiator,
    "coolant_radiator": _geo_radiator,
    "oil_filter":   _geo_oil_filter,
    "nut_hex":      _geo_nut_hex,
    "washer":       _geo_washer,
    "dowel_pin":    _geo_dowel_pin,
    "custom":       _geo_housing,
}


def _normalise_feature_entry(entry):
    if isinstance(entry, str):
        return {"type": entry}
    if isinstance(entry, dict):
        return dict(entry)
    return None


def _extract_feature_timeline(part):
    timeline = []
    for key in ("feature_timeline", "features"):
        values = part.get(key)
        if isinstance(values, list):
            timeline.extend(values)
    dims = part.get("dimensions_mm") or {}
    if isinstance(dims.get("feature_timeline"), list):
        timeline.extend(dims.get("feature_timeline"))

    normalised = []
    for idx, item in enumerate(timeline):
        feature = _normalise_feature_entry(item)
        if not feature:
            continue
        feature.setdefault("order", idx)
        normalised.append(feature)

    return sorted(normalised, key=lambda item: int(item.get("order", 0)))


def _apply_feature_timeline(solid, cq, part):
    report = {
        "requested": 0,
        "applied": [],
        "failed": [],
    }
    if not _HAS_GEO_FEATURES:
        report["failed"].append({"type": "feature_engine", "reason": "geo_features unavailable"})
        return solid, report

    timeline = _extract_feature_timeline(part)
    report["requested"] = len(timeline)
    out = solid

    for feature in timeline:
        ftype = str(feature.get("type", "")).strip().lower()
        try:
            if ftype in {"hole_pattern", "holes"}:
                out = apply_hole_pattern(
                    out,
                    cq,
                    pattern_type=str(feature.get("pattern", feature.get("pattern_type", "circular"))),
                    count=int(feature.get("count", 4)),
                    diameter=float(feature.get("diameter", 4.0)),
                    depth=float(feature.get("depth", 10.0)),
                    pcd=float(feature.get("pcd", feature.get("pitch_circle", 20.0))),
                )
                report["applied"].append({"type": ftype})
                continue

            if ftype == "pocket":
                out = apply_pocket(
                    out,
                    cq,
                    x=float(feature.get("x", 0.0)),
                    y=float(feature.get("y", 0.0)),
                    w=float(feature.get("w", feature.get("width", 10.0))),
                    h=float(feature.get("h", feature.get("height", 10.0))),
                    depth=float(feature.get("depth", 4.0)),
                )
                report["applied"].append({"type": ftype})
                continue

            if ftype == "boss":
                out = apply_boss(
                    out,
                    cq,
                    x=float(feature.get("x", 0.0)),
                    y=float(feature.get("y", 0.0)),
                    diameter=float(feature.get("diameter", 8.0)),
                    height=float(feature.get("height", 8.0)),
                )
                report["applied"].append({"type": ftype})
                continue

            if ftype in {"rib_array", "ribs"}:
                out = apply_rib_array(
                    out,
                    cq,
                    count=int(feature.get("count", 3)),
                    thickness=float(feature.get("thickness", 2.0)),
                    height=float(feature.get("height", 12.0)),
                    direction=str(feature.get("direction", "x")),
                )
                report["applied"].append({"type": ftype})
                continue

            if ftype == "chamfer":
                out = apply_chamfer(
                    out,
                    edges_selector=str(feature.get("edges", "|Z")),
                    size=float(feature.get("size", feature.get("distance", 0.8))),
                )
                report["applied"].append({"type": ftype})
                continue

            if ftype == "fillet":
                out = apply_fillet(
                    out,
                    edges_selector=str(feature.get("edges", "|Z")),
                    radius=float(feature.get("radius", 1.0)),
                )
                report["applied"].append({"type": ftype})
                continue

            if ftype == "slot":
                out = apply_slot(
                    out,
                    cq,
                    x=float(feature.get("x", 0.0)),
                    y=float(feature.get("y", 0.0)),
                    angle=float(feature.get("angle", 0.0)),
                    w=float(feature.get("w", feature.get("width", 4.0))),
                    l=float(feature.get("l", feature.get("length", 14.0))),
                    depth=float(feature.get("depth", 4.0)),
                )
                report["applied"].append({"type": ftype})
                continue

            report["failed"].append({"type": ftype or "unknown", "reason": "unsupported feature type"})
        except Exception as exc:
            report["failed"].append({"type": ftype or "unknown", "reason": str(exc)})

    return out, report


def shape_for_part(cq, part):
    """Dispatch to the correct geometry function based on part type/shape/kind."""
    dims = part.get("dimensions_mm") or part.get("dims") or {}

    # Normalize dims from enki.js format (uses 'dims' with mm implicit)
    # enki.js dims are already in mm if they come from assembly_document;
    # but from the plan they may be in the raw enki format (w/h/d/module/etc)
    # Pass them through as-is — each fn handles its own keys.

    part_type = str(part.get("type", part.get("shape", part.get("kind", "box")))).lower()
    # Strip suffixes like _smd, _header
    base_type = part_type.split("_smd")[0].split("_header")[0]

    fn = _SHAPE_FN.get(base_type) or _SHAPE_FN.get(part_type)
    if fn is None and _HAS_GEO_LIBRARY:
        fn = get_geometry_fn(base_type) or get_geometry_fn(part_type)
    if fn is None and _HAS_GEO_COMPOSER and str(part.get("kind", "")).lower() == "novel":
        features = part.get("features") or []
        params = {
            "base_shape": part.get("base_shape", base_type),
            "dimensions_mm": dims,
        }
        seed = part.get("seed")
        try:
            solid = generate_novel_part(cq, part.get("grammar", "housing"), features, params, seed=seed)
            fn = None
        except Exception:
            fn = _geo_box
    if fn is None:
        fn = _geo_box

    try:
        if "solid" not in locals():
            solid = fn(cq, dims)
    except Exception:
        # Fallback: box with bounding dims
        bx = max(float(dims.get("x", dims.get("w", dims.get("width", dims.get("diameter", 10))))), 0.5)
        by = max(float(dims.get("y", dims.get("d", dims.get("depth", bx)))), 0.5)
        bz = max(float(dims.get("z", dims.get("h", dims.get("height", bx * 0.5)))), 0.2)
        solid = cq.Workplane("XY").box(bx, by, bz)

    solid, feature_report = _apply_feature_timeline(solid, cq, part)
    part["_kernel_feature_report"] = feature_report

    try:
        solid = solid.clean()
    except Exception:
        pass

    tx = float((part.get("transform_mm") or part.get("position") or [0, 0, 0])[0] if isinstance(
        part.get("transform_mm") or part.get("position"), list
    ) else (part.get("transform_mm") or {}).get("x", 0))
    ty = float((part.get("transform_mm") or part.get("position") or [0, 0, 0])[1] if isinstance(
        part.get("transform_mm") or part.get("position"), list
    ) else (part.get("transform_mm") or {}).get("y", 0))
    tz = float((part.get("transform_mm") or part.get("position") or [0, 0, 0])[2] if isinstance(
        part.get("transform_mm") or part.get("position"), list
    ) else (part.get("transform_mm") or {}).get("z", 0))

    try:
        return solid.translate((tx, ty, tz))
    except Exception:
        return solid


def _bbox_from_part(part: dict):
    """Return conservative axis-aligned bbox dimensions (mm) from mixed part keys."""
    dims = part.get("dimensions_mm") or part.get("dims") or {}
    part_type = str(part.get("type", part.get("shape", ""))).lower()

    def n(v, fallback=0.0):
        try:
            f = float(v)
            if math.isfinite(f):
                return f
        except (TypeError, ValueError):
            pass
        return fallback

    if part_type in {"con_rod", "connecting_rod"}:
        big_d = n(dims.get("bigEndD", dims.get("big_end_diameter", 52)))
        small_d = n(dims.get("smallEndD", dims.get("small_end_diameter", 24)))
        thick = n(dims.get("thickness", dims.get("w", 22)))
        ctc = n(dims.get("ctc", dims.get("length", 155)))
        return {
            "x": max(big_d, small_d, thick),
            "y": max(thick, 0.0),
            "z": max(ctc + big_d * 0.5 + small_d * 0.5, 0.0),
        }

    if part_type in {"cylinder_liner", "cylinder_sleeve"}:
        od = n(dims.get("outer_diameter", dims.get("outerD", dims.get("diameter", 86))))
        length = n(dims.get("length", dims.get("L", 150)))
        flange_od = n(dims.get("flange_outer_diameter", od))
        dia = max(od, flange_od)
        return {"x": dia, "y": dia, "z": max(length, 0.0)}

    if part_type in {"valve", "valve_intake", "valve_exhaust"}:
        head_d = n(dims.get("head_diameter", dims.get("diameter", 34)))
        length = n(dims.get("length", dims.get("L", 105)))
        return {"x": head_d, "y": head_d, "z": max(length, 0.0)}

    if part_type == "spark_plug":
        hex_d = n(dims.get("hex_diameter", dims.get("diameter", 21)))
        length = n(dims.get("length", dims.get("L", 52)))
        return {"x": hex_d, "y": hex_d, "z": max(length, 0.0)}

    if part_type == "fuel_injector":
        body_d = n(dims.get("body_diameter", dims.get("diameter", 16)))
        conn_w = n(dims.get("connector_width", body_d))
        conn_d = n(dims.get("connector_depth", body_d))
        length = n(dims.get("length", dims.get("L", 68)))
        return {"x": max(conn_w, body_d), "y": max(conn_d, body_d), "z": max(length, 0.0)}

    x = n(dims.get("x", dims.get("w", dims.get("width", dims.get("diameter", dims.get("outer_diameter", dims.get("outerD", 0)))))))
    y = n(dims.get("y", dims.get("d", dims.get("depth", dims.get("diameter", dims.get("outer_diameter", dims.get("outerD", x)))))))
    z = n(dims.get("z", dims.get("h", dims.get("height", dims.get("thickness", dims.get("length", dims.get("L", 0)))))))
    return {"x": max(x, 0.0), "y": max(y, 0.0), "z": max(z, 0.0)}


def _bbox_from_solid_or_part(solid, part: dict):
    """Prefer exact kernel bbox from solid; fallback to conservative part-derived bbox."""
    try:
        bb = solid.val().BoundingBox()
        dx = float(bb.xmax - bb.xmin)
        dy = float(bb.ymax - bb.ymin)
        dz = float(bb.zmax - bb.zmin)
        if math.isfinite(dx) and math.isfinite(dy) and math.isfinite(dz):
            return {"x": max(dx, 0.0), "y": max(dy, 0.0), "z": max(dz, 0.0)}
    except Exception:
        pass
    return _bbox_from_part(part)


def _infer_density_kg_m3(material_name: str) -> float:
    """Rough engineering densities for mass proxy reporting."""
    name = str(material_name or "").lower()
    if "steel" in name:
        return 7850.0
    if "aluminum" in name or "aluminium" in name:
        return 2700.0
    if "titanium" in name:
        return 4500.0
    if "brass" in name:
        return 8500.0
    if "plastic" in name or "poly" in name:
        return 1200.0
    return 2700.0


def _kernel_metrics_from_solid(solid, part: dict, bbox_mm: dict):
    """Extract simulation-useful per-part metrics from kernel solid with fallbacks."""
    volume_mm3 = None
    area_mm2 = None
    center_mm = {"x": 0.0, "y": 0.0, "z": 0.0}
    try:
        shape = solid.val()
        volume_mm3 = float(shape.Volume())
        area_mm2 = float(shape.Area())
        bb = shape.BoundingBox()
        center_mm = {
            "x": float((bb.xmin + bb.xmax) * 0.5),
            "y": float((bb.ymin + bb.ymax) * 0.5),
            "z": float((bb.zmin + bb.zmax) * 0.5),
        }
    except Exception:
        pass

    if volume_mm3 is None:
        bx = float((bbox_mm or {}).get("x", 0.0) or 0.0)
        by = float((bbox_mm or {}).get("y", 0.0) or 0.0)
        bz = float((bbox_mm or {}).get("z", 0.0) or 0.0)
        volume_mm3 = max(bx * by * bz * 0.35, 0.0)

    material = part.get("material") or part.get("material_name") or "aluminum_6061"
    density = _infer_density_kg_m3(str(material))
    mass_kg = max(volume_mm3, 0.0) * 1e-9 * density

    bx = max(float((bbox_mm or {}).get("x", 0.0) or 0.0), 0.0)
    by = max(float((bbox_mm or {}).get("y", 0.0) or 0.0), 0.0)
    bz = max(float((bbox_mm or {}).get("z", 0.0) or 0.0), 0.0)
    bbox_vol_mm3 = max(bx * by * bz, 1e-9)
    fill_ratio = max(min(max(volume_mm3, 0.0) / bbox_vol_mm3, 1.0), 0.0)

    # Box-based inertia proxy around centroid for fast rigid-body initialization.
    ix = mass_kg * ((by * 1e-3) ** 2 + (bz * 1e-3) ** 2) / 12.0
    iy = mass_kg * ((bx * 1e-3) ** 2 + (bz * 1e-3) ** 2) / 12.0
    iz = mass_kg * ((bx * 1e-3) ** 2 + (by * 1e-3) ** 2) / 12.0

    thin_wall_proxy_mm = None
    if area_mm2 is not None and area_mm2 > 1e-6:
        thin_wall_proxy_mm = max((2.0 * max(volume_mm3, 0.0)) / area_mm2, 0.0)

    return {
        "material": str(material),
        "density_kg_m3": density,
        "volume_mm3": max(volume_mm3, 0.0),
        "surface_area_mm2": max(area_mm2, 0.0) if area_mm2 is not None else None,
        "mass_proxy_kg": max(mass_kg, 0.0),
        "bbox_fill_ratio": fill_ratio,
        "thin_wall_proxy_mm": thin_wall_proxy_mm,
        "inertia_proxy_kg_m2": {"ix": max(ix, 0.0), "iy": max(iy, 0.0), "iz": max(iz, 0.0)},
        "center_mm": center_mm,
    }


def _import_cadquery_with_optional_ivtk_shim():
    """Import CadQuery while tolerating missing optional OCP IVtk symbols."""
    import importlib

    class _IVtkStub:
        def __init__(self, *args, **kwargs):
            pass

    max_retries = 16
    last_exc = None
    for _ in range(max_retries):
        try:
            import cadquery as cq
            from cadquery import exporters
            return cq, exporters
        except Exception as exc:
            message = str(exc)
            prefix = "cannot import name '"
            marker = "' from 'OCP.IVtkOCC'"
            start = message.find(prefix)
            end = message.find(marker, start + len(prefix)) if start >= 0 else -1
            if start < 0 or end < 0:
                raise
            missing_symbol = message[start + len(prefix):end].strip()
            if not missing_symbol:
                raise
            ivtk_mod = importlib.import_module("OCP.IVtkOCC")
            module_vars = vars(ivtk_mod)
            if missing_symbol not in module_vars:
                setattr(ivtk_mod, missing_symbol, _IVtkStub)
            if "__getattr__" not in module_vars:
                setattr(ivtk_mod, "__getattr__", lambda _name: _IVtkStub)
            last_exc = exc

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("CadQuery runtime unavailable")

def main():
    if len(sys.argv) < 2:
        fail("Plan path required")

    plan_path = Path(sys.argv[1]).resolve()
    if not plan_path.exists():
        fail("Plan path not found")

    with open(plan_path, "r", encoding="utf-8") as f:
        plan = json.load(f)

    out_dir = plan_path.parent
    script = plan.get("script", "")
    script_path = out_dir / "cadquery_script.py"
    if script and not script_path.exists():
        with open(script_path, "w", encoding="utf-8") as sf:
            sf.write(script)

    try:
        cq, exporters = _import_cadquery_with_optional_ivtk_shim()
    except Exception as exc:
        fail(f"CadQuery runtime unavailable: {exc}")

    assembly_document = ensure_assembly_document(plan_path, plan)
    precision = _resolve_precision_profile(plan, assembly_document)

    # ── Validate + normalise via CAD DSL ─────────────────────────────────────
    if _HAS_DSL:
        report = validate_assembly(assembly_document)
        if not report.valid:
            import sys as _sys
            # Log warnings but still proceed — kernel tries its best
            print(json.dumps({"dsl_validation": report.to_dict()}), file=_sys.stderr)
        # Normalise each part (fills defaults, resolves shape aliases)
        assembly_document["parts"] = [normalise_part(p) for p in (assembly_document.get("parts") or [])]
    # ─────────────────────────────────────────────────────────────────────────

    parts = assembly_document.get("parts") or []
    solids = []
    part_manifest = []
    healed_count = 0
    for part in parts:
        solid = shape_for_part(cq, part)
        if precision.get("heal_solids"):
            try:
                repaired = solid.clean()
                solid = repaired
                healed_count += 1
            except Exception:
                pass
        solids.append(solid)
        dims = part.get("dimensions_mm") or {}
        bbox_mm = _bbox_from_solid_or_part(solid, part)
        part_manifest.append({
            "id": part.get("id"),
            "name": part.get("name"),
            "kind": part.get("kind"),
            "dimensions_mm": dims,
            "transform_mm": part.get("transform_mm") or {},
            "bbox_mm": bbox_mm,
            "kernel_metrics": _kernel_metrics_from_solid(solid, part, bbox_mm),
            "feature_report": part.get("_kernel_feature_report") or {"requested": 0, "applied": [], "failed": []},
        })

    if not solids:
        fail("No parts available in assembly document")

    assembly, assembly_mode = _build_assembly_geometry(cq, solids)
    if assembly is None:
        fail("Failed to build assembly geometry")

    step_path = out_dir / "assembly.step"
    stl_path = out_dir / "assembly_kernel.stl"
    quality_report_path = out_dir / "kernel_quality_report.json"

    _export_kernel_artifacts(exporters, assembly, step_path, stl_path, precision)

    with open(out_dir / "kernel_part_manifest.json", "w", encoding="utf-8") as f:
        json.dump({"parts": part_manifest}, f, indent=2)

    with open(quality_report_path, "w", encoding="utf-8") as f:
        json.dump({
            "precision_profile": precision.get("label"),
            "linear_deflection_mm": precision.get("linear_deflection_mm"),
            "angular_tolerance_deg": precision.get("angular_tolerance_deg"),
            "heal_solids": bool(precision.get("heal_solids")),
            "healed_part_count": healed_count,
            "assembly_mode": assembly_mode,
            "part_count": len(solids),
        }, f, indent=2)

    print(json.dumps({
        "ok": True,
        "engine": "cadquery",
        "extended_shape_count": EXTENDED_SHAPE_COUNT,
        "artifacts": [
            {"type": "step", "filename": "assembly.step"},
            {"type": "stl_kernel", "filename": "assembly_kernel.stl"},
            {"type": "kernel_part_manifest", "filename": "kernel_part_manifest.json"},
            {"type": "kernel_quality_report", "filename": "kernel_quality_report.json"}
        ]
    }))

if __name__ == "__main__":
    main()
