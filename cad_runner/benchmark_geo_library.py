from __future__ import annotations

import argparse
import importlib
import os
import sys
import time


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark geo_library import and dynamic shape registration")
    parser.add_argument("--dynamic", type=int, default=0, help="Number of dynamic shape names to request after import")
    parser.add_argument("--prefix", default="bench_dyn_shape", help="Prefix for generated dynamic shape names")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()

    start = time.perf_counter()
    geo_library = importlib.import_module("geo_library")
    import_seconds = time.perf_counter() - start

    print(f"module={getattr(geo_library, '__file__', 'unknown')}")
    print(f"import_seconds={import_seconds:.6f}")
    print(f"extended_shape_count={geo_library.EXTENDED_SHAPE_COUNT}")
    print(f"base_shape_profiles={len(geo_library.BASE_SHAPE_PROFILES)}")

    stats_before = geo_library.get_auto_growth_stats()
    print(f"dynamic_before={stats_before.get('current_dynamic_shapes', 0)}")
    print(f"limit_hits_before={stats_before.get('dynamic_limit_hit_count', 0)}")

    if args.dynamic > 0:
        t0 = time.perf_counter()
        for i in range(1, args.dynamic + 1):
            name = f"{args.prefix}_{i:06d}"
            geo_library.get_geometry_fn(name)
        dynamic_seconds = time.perf_counter() - t0
        stats_after = geo_library.get_auto_growth_stats()
        print(f"dynamic_requests={args.dynamic}")
        print(f"dynamic_seconds={dynamic_seconds:.6f}")
        print(f"dynamic_after={stats_after.get('current_dynamic_shapes', 0)}")
        print(f"evicted_after={stats_after.get('dynamic_evicted_count', 0)}")
        print(f"limit_hits_after={stats_after.get('dynamic_limit_hit_count', 0)}")
        print(f"extended_shape_count_after={geo_library.EXTENDED_SHAPE_COUNT}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
