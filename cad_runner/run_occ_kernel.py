import json
import sys
from pathlib import Path


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
        "assembly_id": "fallback-occ-assembly",
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
                "transform_mm": {"x": 0, "y": 0, "z": 0},
            }
        ],
    }


def _fd(d: dict, keys: tuple[str, ...], default: float) -> float:
    for k in keys:
        if k in d:
            try:
                return float(d.get(k))
            except Exception:
                return default
    return default


def _translate(shape, x: float, y: float, z: float, gp_Trsf, gp_Vec, BRepBuilderAPI_Transform):
    trsf = gp_Trsf()
    trsf.SetTranslation(gp_Vec(float(x), float(y), float(z)))
    return BRepBuilderAPI_Transform(shape, trsf, True).Shape()


def _shape_for_part(part: dict, occ):
    (
        BRepPrimAPI_MakeBox,
        BRepPrimAPI_MakeCylinder,
        BRepPrimAPI_MakeCone,
        BRepPrimAPI_MakeSphere,
        BRepPrimAPI_MakeTorus,
        BRepAlgoAPI_Cut,
    ) = occ

    dims = part.get("dimensions_mm") or {}
    shape_name = str(part.get("shape", "box")).lower()

    # Primitive family mapping for wide shape coverage.
    if any(x in shape_name for x in ("gear", "pulley", "disk", "hub", "flange")):
        od = max(_fd(dims, ("outer_diameter", "diameter"), 80.0), 1.0)
        h = max(_fd(dims, ("thickness", "height", "length"), 12.0), 0.5)
        shape = BRepPrimAPI_MakeCylinder(od / 2.0, h).Shape()
    elif any(x in shape_name for x in ("seal", "ring", "gasket", "o_ring")):
        mean_d = max(_fd(dims, ("mean_diameter", "inner_diameter", "diameter"), 40.0), 1.0)
        cs = max(_fd(dims, ("cross_section", "section", "thickness"), 4.0), 0.2)
        shape = BRepPrimAPI_MakeTorus(mean_d / 2.0, cs / 2.0).Shape()
    elif any(x in shape_name for x in ("tube", "pipe", "liner")):
        od = max(_fd(dims, ("outer_diameter", "diameter", "outerD"), 30.0), 1.0)
        wall = max(_fd(dims, ("wall", "wall_thickness", "wall_t"), 2.0), 0.2)
        h = max(_fd(dims, ("length", "height", "h"), 80.0), 0.5)
        outer = BRepPrimAPI_MakeCylinder(od / 2.0, h).Shape()
        inner = BRepPrimAPI_MakeCylinder(max(od / 2.0 - wall, 0.1), h).Shape()
        shape = BRepAlgoAPI_Cut(outer, inner).Shape()
    elif any(x in shape_name for x in ("cone", "nozzle", "nose")):
        r1 = max(_fd(dims, ("exit_diameter", "diameter"), 60.0) / 2.0, 1.0)
        r2 = max(_fd(dims, ("throat_diameter",), r1 * 0.3) / 2.0, 0.2)
        h = max(_fd(dims, ("height", "length"), 100.0), 1.0)
        shape = BRepPrimAPI_MakeCone(r1, r2, h).Shape()
    elif any(x in shape_name for x in ("sphere", "ball_joint", "dome")):
        dia = max(_fd(dims, ("body_diameter", "diameter", "radius"), 30.0), 1.0)
        radius = dia if "radius" in dims else dia / 2.0
        shape = BRepPrimAPI_MakeSphere(radius).Shape()
    elif any(x in shape_name for x in ("shaft", "rod", "bolt", "pin", "cylinder", "screw")):
        dia = max(_fd(dims, ("diameter", "d"), 20.0), 0.5)
        h = max(_fd(dims, ("length", "height", "h"), 80.0), 0.5)
        shape = BRepPrimAPI_MakeCylinder(dia / 2.0, h).Shape()
    else:
        x = max(_fd(dims, ("x", "width", "w"), 80.0), 0.5)
        y = max(_fd(dims, ("y", "depth", "d"), 60.0), 0.5)
        z = max(_fd(dims, ("z", "height", "h"), 40.0), 0.5)
        shape = BRepPrimAPI_MakeBox(x, y, z).Shape()

    t = part.get("transform_mm") or {}
    if isinstance(t, list):
        tx = float(t[0] if len(t) > 0 else 0)
        ty = float(t[1] if len(t) > 1 else 0)
        tz = float(t[2] if len(t) > 2 else 0)
    else:
        tx = float(t.get("x", 0))
        ty = float(t.get("y", 0))
        tz = float(t.get("z", 0))
    return shape, tx, ty, tz


def main():
    if len(sys.argv) < 2:
        fail("Plan path required")
    plan_path = Path(sys.argv[1]).resolve()
    if not plan_path.exists():
        fail("Plan path not found")

    try:
        from OCP.BRepPrimAPI import (
            BRepPrimAPI_MakeBox,
            BRepPrimAPI_MakeCylinder,
            BRepPrimAPI_MakeCone,
            BRepPrimAPI_MakeSphere,
            BRepPrimAPI_MakeTorus,
        )
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
        from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
        from OCP.Interface import Interface_Static
        from OCP.BRepMesh import BRepMesh_IncrementalMesh
        from OCP.StlAPI import StlAPI_Writer
        from OCP.gp import gp_Trsf, gp_Vec
        from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
    except Exception as exc:
        fail(f"OCC runtime unavailable: {exc}")

    with open(plan_path, "r", encoding="utf-8") as f:
        plan = json.load(f)

    out_dir = plan_path.parent
    assembly_document = ensure_assembly_document(plan_path, plan)
    parts = assembly_document.get("parts") or []
    if not parts:
        fail("No parts available in assembly document")

    occ = (
        BRepPrimAPI_MakeBox,
        BRepPrimAPI_MakeCylinder,
        BRepPrimAPI_MakeCone,
        BRepPrimAPI_MakeSphere,
        BRepPrimAPI_MakeTorus,
        BRepAlgoAPI_Cut,
    )

    fused = None
    for part in parts:
        shape, tx, ty, tz = _shape_for_part(part, occ)
        shape = _translate(shape, tx, ty, tz, gp_Trsf, gp_Vec, BRepBuilderAPI_Transform)
        fused = shape if fused is None else BRepAlgoAPI_Fuse(fused, shape).Shape()

    step_writer = STEPControl_Writer()
    Interface_Static.SetCVal_s("write.step.schema", "AP214")
    step_writer.Transfer(fused, STEPControl_AsIs)
    step_writer.Write(str(out_dir / "assembly.step"))

    mesh = BRepMesh_IncrementalMesh(fused, 0.6)
    mesh.Perform()
    stl_writer = StlAPI_Writer()
    stl_writer.Write(fused, str(out_dir / "assembly_kernel.stl"))

    print(json.dumps({
        "ok": True,
        "engine": "occ",
        "artifacts": [
            {"type": "step", "filename": "assembly.step"},
            {"type": "stl_kernel", "filename": "assembly_kernel.stl"}
        ]
    }))


if __name__ == "__main__":
    main()
