"""Feature operations for generated parametric solids."""

from __future__ import annotations

import math


def _safe_depth(value: object, default: float = 2.0) -> float:
    try:
        return max(float(value), 0.1)
    except Exception:
        return default


def apply_hole_pattern(solid, cq, pattern_type: str = "circular", count: int = 4, diameter: float = 4.0, depth: float = 10.0, pcd: float = 20.0):
    count = max(int(count), 1)
    diameter = _safe_depth(diameter, 4.0)
    depth = _safe_depth(depth, 10.0)
    pcd = _safe_depth(pcd, 20.0)
    out = solid

    if pattern_type == "linear":
        spacing = pcd / max(count - 1, 1)
        start = -pcd / 2.0
        for i in range(count):
            x = start + i * spacing
            hole = cq.Workplane("XY").center(x, 0).circle(diameter / 2.0).extrude(depth)
            out = out.cut(hole)
        return out

    for i in range(count):
        a = 2.0 * math.pi * i / count
        x = (pcd / 2.0) * math.cos(a)
        y = (pcd / 2.0) * math.sin(a)
        hole = cq.Workplane("XY").center(x, y).circle(diameter / 2.0).extrude(depth)
        out = out.cut(hole)
    return out


def apply_pocket(solid, cq, x: float, y: float, w: float, h: float, depth: float):
    w = _safe_depth(w, 10.0)
    h = _safe_depth(h, 10.0)
    depth = _safe_depth(depth, 4.0)
    pocket = cq.Workplane("XY").center(float(x), float(y)).rect(w, h).extrude(depth)
    return solid.cut(pocket)


def apply_boss(solid, cq, x: float, y: float, diameter: float, height: float):
    diameter = _safe_depth(diameter, 8.0)
    height = _safe_depth(height, 8.0)
    boss = cq.Workplane("XY").center(float(x), float(y)).circle(diameter / 2.0).extrude(height)
    return solid.union(boss)


def apply_rib_array(solid, cq, count: int, thickness: float, height: float, direction: str = "x"):
    count = max(int(count), 1)
    thickness = _safe_depth(thickness, 2.0)
    height = _safe_depth(height, 12.0)
    out = solid
    spacing = 12.0
    for i in range(count):
        offset = (i - (count - 1) / 2.0) * spacing
        if direction == "y":
            rib = cq.Workplane("XY").center(0, offset).rect(40, thickness).extrude(height)
        else:
            rib = cq.Workplane("XY").center(offset, 0).rect(thickness, 40).extrude(height)
        out = out.union(rib)
    return out


def apply_chamfer(solid, edges_selector: str = "|Z", size: float = 0.8):
    try:
        return solid.edges(edges_selector).chamfer(_safe_depth(size, 0.8))
    except Exception:
        return solid


def apply_fillet(solid, edges_selector: str = "|Z", radius: float = 1.0):
    try:
        return solid.edges(edges_selector).fillet(_safe_depth(radius, 1.0))
    except Exception:
        return solid


def apply_slot(solid, cq, x: float, y: float, angle: float, w: float, l: float, depth: float):
    w = _safe_depth(w, 4.0)
    l = _safe_depth(l, 14.0)
    depth = _safe_depth(depth, 4.0)
    slot = cq.Workplane("XY").center(float(x), float(y)).slot2D(l, w, float(angle)).extrude(depth)
    return solid.cut(slot)
