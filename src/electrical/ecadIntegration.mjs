
function safeName(value = 'component') {
  return String(value).trim().replace(/[^a-z0-9_\-]+/gi, '_').slice(0, 80) || 'component';
}

export function buildFootprintLibrary() {
  return {
    QFP_64: { pads: 64, body_mm: { x: 14, y: 14 }, pitch_mm: 0.5 },
    SOT_223: { pads: 4, body_mm: { x: 6.5, y: 7 }, pitch_mm: 2.3 },
    LGA_16: { pads: 16, body_mm: { x: 6, y: 6 }, pitch_mm: 0.8 },
    HEADER_8: { pads: 8, body_mm: { x: 20, y: 5 }, pitch_mm: 2.54 },
    GENERIC: { pads: 4, body_mm: { x: 10, y: 10 }, pitch_mm: 2.54 },
  };
}

export function exportKiCadProject(assemblyDocument = {}) {
  const library = buildFootprintLibrary();
  const parts = Array.isArray(assemblyDocument.parts) ? assemblyDocument.parts.filter((item) => String(item.kind || '').startsWith('electrical')) : [];
  const pcbLines = [
    '(kicad_pcb (version 20240108) (generator UARE))',
    '  (general (thickness 1.6))',
  ];
  const schematicLines = ['(kicad_sch (version 20240108) (generator UARE))'];
  parts.forEach((part, index) => {
    const fpKey = String(part.footprint || 'GENERIC').replace(/-/g, '_').toUpperCase();
    const fp = library[fpKey] || library.GENERIC;
    pcbLines.push(`  (footprint "UARE:${fpKey}" (layer "F.Cu") (at ${Number(part.transform_mm?.x || index * 5).toFixed(2)} ${Number(part.transform_mm?.y || 0).toFixed(2)})`);
    pcbLines.push(`    (property "Reference" "U${index + 1}")`);
    pcbLines.push(`    (property "Value" "${safeName(part.name)}")`);
    pcbLines.push('  )');
    schematicLines.push(`  (symbol (lib_id "UARE:${fpKey}") (property "Reference" "U${index + 1}") (property "Value" "${safeName(part.name)}"))`);
  });
  pcbLines.push(')');
  schematicLines.push(')');
  return {
    projectName: safeName(assemblyDocument.assembly_id || 'uare_project'),
    pcb: `${pcbLines.join('\n')}\n`,
    schematic: `${schematicLines.join('\n')}\n`,
    footprints: parts.map((part) => ({
      part_id: part.id,
      footprint: String(part.footprint || 'GENERIC'),
      details: library[String(part.footprint || 'GENERIC').replace(/-/g, '_').toUpperCase()] || library.GENERIC,
    })),
  };
}

export function exportEasyEdaProject(assemblyDocument = {}) {
  const parts = Array.isArray(assemblyDocument.parts) ? assemblyDocument.parts.filter((item) => String(item.kind || '').startsWith('electrical')) : [];
  return {
    head: { docType: 'EasyEDA', editorVersion: 'UARE-1.0' },
    components: parts.map((part, index) => ({
      id: part.id,
      designator: `U${index + 1}`,
      title: part.name,
      package: part.footprint || 'GENERIC',
      x: Number(part.transform_mm?.x || 0),
      y: Number(part.transform_mm?.y || 0),
      rotation: 0,
    })),
    nets: assemblyDocument.netlist || [],
  };
}

export function importEcadPayload(payload = {}) {
  const components = Array.isArray(payload.components) ? payload.components : [];
  return components.map((component, index) => ({
    name: component.title || component.name || `Imported Component ${index + 1}`,
    footprint: component.package || component.footprint || 'GENERIC',
    x_mm: Number(component.x || component.pos_x_mm || 0),
    y_mm: Number(component.y || component.pos_y_mm || 0),
    z_mm: Number(component.z || 2),
    pins: Number(component.pins || 4),
    voltage_v: Number(component.voltage_v || 5),
  }));
}
