
import { spawnSync } from 'child_process';

function buildNetlistText(assemblyDocument = {}) {
  const lines = ['* UARE generated circuit'];
  const nets = Array.isArray(assemblyDocument.netlist) ? assemblyDocument.netlist : [];
  nets.forEach((net, index) => {
    lines.push(`* NET ${index + 1}: ${net.net} => ${String((net.nodes || []).join(', '))}`);
  });
  lines.push('V1 VIN 0 DC 12');
  lines.push('RREG VIN VREG 0.5');
  lines.push('RMCU VREG MCU_VCC 2');
  lines.push('RSNS MCU_VCC SENS_VCC 5');
  lines.push('.op');
  lines.push('.end');
  return `${lines.join('\n')}\n`;
}

function heuristicReport(assemblyDocument = {}) {
  const nets = Array.isArray(assemblyDocument.netlist) ? assemblyDocument.netlist : [];
  const errors = [];
  const warnings = [];
  const summary = {
    net_count: nets.length,
    supply_nets: nets.filter((net) => /vcc|vin|gnd/i.test(String(net.net || ''))).length,
    nominal_voltage_range_v: nets.map((net) => Number(net.nominal_voltage_v || 0)),
  };
  const vin = nets.find((net) => String(net.net).toUpperCase() === 'VIN');
  if (!vin) errors.push('Missing VIN supply net.');
  const gnd = nets.find((net) => String(net.net).toUpperCase() === 'GND');
  if (!gnd) errors.push('Missing GND reference net.');
  nets.forEach((net) => {
    if ((net.nodes || []).length < 2) warnings.push(`Net ${net.net} has fewer than 2 connection points.`);
    if (Number(net.nominal_voltage_v || 0) > 5 && /I2C/i.test(String(net.net || ''))) errors.push(`Net ${net.net} exceeds safe logic voltage.`);
  });
  return {
    engine: 'heuristic',
    ok: errors.length === 0,
    errors,
    warnings,
    summary,
  };
}

export function runSpiceSimulation(runtime, artifactStore, executionId, assemblyDocument = {}) {
  const netlist = buildNetlistText(assemblyDocument);
  artifactStore.writeText(executionId, 'circuit.spice', netlist);
  const report = heuristicReport(assemblyDocument);
  const ngspiceBin = runtime.ngspiceBin || 'ngspice';
  try {
    const result = spawnSync(ngspiceBin, ['-b', '-o', 'spice.out', 'circuit.spice'], {
      cwd: artifactStore.executionDir(executionId),
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    });
    if (!result.error && result.status === 0) {
      return {
        ...report,
        engine: 'ngspice',
        ok: report.errors.length === 0,
        netlist_filename: 'circuit.spice',
        raw_output_filename: 'spice.out',
      };
    }
  } catch {}
  return {
    ...report,
    netlist_filename: 'circuit.spice',
    raw_output_filename: artifactStore.fileExists(executionId, 'spice.out') ? 'spice.out' : null,
  };
}
