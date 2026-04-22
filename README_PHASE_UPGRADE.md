
# UARE phase upgrade

This build adds:

- Assembly-document CAD truth model
- CadQuery assembly kernel runner
- OCC runner hook (`CAD_KERNEL_ENGINE=occ`) when an OCC runtime is available
- Electrical subsystem generation (PCB, wiring, modules, nets)
- KiCad / EasyEDA export artifacts
- SPICE netlist generation with heuristic validation and optional `ngspice`
- Gerber/drill artifact generation
- BOM, dimensions, features, and assembly instructions artifacts

## Notes

- `CAD_KERNEL_ENABLED=true` and a working Python CAD environment are still required for exact solid output.
- `CAD_KERNEL_ENGINE=occ` requires an OCC / pythonOCC or OCP-capable Python environment.
- SPICE uses heuristic validation by default and upgrades to `ngspice` execution when installed and accessible via `NGSPICE_BIN`.
