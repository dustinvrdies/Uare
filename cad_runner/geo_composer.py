"""Composable and grammar-driven geometry generation."""

from __future__ import annotations

import random

from geo_features import (
    apply_boss,
    apply_chamfer,
    apply_fillet,
    apply_hole_pattern,
    apply_pocket,
    apply_rib_array,
    apply_slot,
)
from geo_library import get_geometry_fn


class PartComposer:
    def __init__(self, cq, base_solid):
        self.cq = cq
        self.solid = base_solid

    def add_holes(self, pattern: str = "circular", count: int = 4, diameter: float = 4.0, depth: float = 8.0, pcd: float = 20.0):
        self.solid = apply_hole_pattern(self.solid, self.cq, pattern, count, diameter, depth, pcd)
        return self

    def add_pocket(self, x: float, y: float, w: float, h: float, depth: float):
        self.solid = apply_pocket(self.solid, self.cq, x, y, w, h, depth)
        return self

    def add_boss(self, x: float, y: float, diameter: float, height: float):
        self.solid = apply_boss(self.solid, self.cq, x, y, diameter, height)
        return self

    def add_ribs(self, count: int, thickness: float, height: float, direction: str = "x"):
        self.solid = apply_rib_array(self.solid, self.cq, count, thickness, height, direction)
        return self

    def add_slot(self, x: float, y: float, angle: float, w: float, l: float, depth: float):
        self.solid = apply_slot(self.solid, self.cq, x, y, angle, w, l, depth)
        return self

    def add_chamfer(self, edges: str = "|Z", size: float = 0.8):
        self.solid = apply_chamfer(self.solid, edges, size)
        return self

    def add_fillet(self, edges: str = "|Z", radius: float = 1.0):
        self.solid = apply_fillet(self.solid, edges, radius)
        return self

    def build(self):
        return self.solid


class ShapeGrammar:
    RULES = {
        "bracket": ["holes", "gusset_pocket", "fillet"],
        "housing": ["bosses", "cover_holes", "ribs"],
        "shaft_assembly": ["slot", "end_holes", "chamfer"],
        "thermal_plate": ["fin_ribs", "mount_holes"],
    }

    def __init__(self, cq):
        self.cq = cq

    def generate(self, part_type: str, params: dict, seed: int | None = None):
        rnd = random.Random(seed)
        base_shape = params.get("base_shape", part_type)
        base_fn = get_geometry_fn(base_shape) or get_geometry_fn("parametric_part_001")
        if base_fn is None:
            raise ValueError("No geometry generator available")

        base = base_fn(self.cq, params.get("dimensions_mm") or {})
        composer = PartComposer(self.cq, base)
        for op in self.RULES.get(part_type, []):
            if op == "holes":
                composer.add_holes("circular", 4, rnd.uniform(3.0, 6.0), 10.0, rnd.uniform(25.0, 50.0))
            elif op == "gusset_pocket":
                composer.add_pocket(0, 0, rnd.uniform(12.0, 25.0), rnd.uniform(12.0, 25.0), rnd.uniform(2.0, 5.0))
            elif op == "fillet":
                composer.add_fillet("|Z", rnd.uniform(0.5, 2.5))
            elif op == "bosses":
                composer.add_boss(-12, -12, rnd.uniform(6.0, 12.0), rnd.uniform(4.0, 10.0))
                composer.add_boss(12, -12, rnd.uniform(6.0, 12.0), rnd.uniform(4.0, 10.0))
            elif op == "cover_holes":
                composer.add_holes("linear", 3, rnd.uniform(3.0, 5.0), 8.0, 40.0)
            elif op == "ribs":
                composer.add_ribs(3, rnd.uniform(1.5, 3.0), rnd.uniform(8.0, 20.0), "x")
            elif op == "slot":
                composer.add_slot(0, 0, 0, rnd.uniform(4.0, 6.0), rnd.uniform(10.0, 18.0), 6.0)
            elif op == "end_holes":
                composer.add_holes("linear", 2, rnd.uniform(3.0, 5.0), 8.0, 30.0)
            elif op == "chamfer":
                composer.add_chamfer("|Z", rnd.uniform(0.4, 1.2))
            elif op == "fin_ribs":
                composer.add_ribs(6, rnd.uniform(1.0, 2.0), rnd.uniform(8.0, 14.0), "y")
            elif op == "mount_holes":
                composer.add_holes("circular", 4, rnd.uniform(2.8, 4.0), 8.0, 35.0)
        return composer.build()

    def mutate(self, solid, mutation_ops: list[dict]):
        composer = PartComposer(self.cq, solid)
        for op in mutation_ops or []:
            kind = op.get("op")
            if kind == "fillet":
                composer.add_fillet(op.get("edges", "|Z"), float(op.get("radius", 1.0)))
            elif kind == "chamfer":
                composer.add_chamfer(op.get("edges", "|Z"), float(op.get("size", 0.8)))
            elif kind == "holes":
                composer.add_holes(op.get("pattern", "circular"), int(op.get("count", 4)), float(op.get("diameter", 4.0)), float(op.get("depth", 8.0)), float(op.get("pcd", 20.0)))
        return composer.build()


def generate_novel_part(cq, base_type: str, feature_list: list[dict] | None = None, params: dict | None = None, seed: int | None = None):
    params = params or {}
    grammar = ShapeGrammar(cq)
    solid = grammar.generate(base_type, params, seed=seed)
    return grammar.mutate(solid, feature_list or [])
