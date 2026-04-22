
function gerberHeader(name = 'UARE') {
  return [`G04 ${name}*`, '%FSLAX24Y24*%', '%MOMM*%', '%LPD*%'].join('\n');
}

export function buildGerberBundle(assemblyDocument = {}) {
  const pcb = (assemblyDocument.parts || []).find((part) => part.kind === 'electrical_pcb');
  const boardX = Number(pcb?.dimensions_mm?.x || 80);
  const boardY = Number(pcb?.dimensions_mm?.y || 50);
  const topCopper = [
    gerberHeader('TOP_COPPER'),
    'G01 X000000Y000000D02*',
    `X${String(Math.round(boardX * 100)).padStart(6, '0')}Y000000D01*`,
    `X${String(Math.round(boardX * 100)).padStart(6, '0')}Y${String(Math.round(boardY * 100)).padStart(6, '0')}D01*`,
    `X000000Y${String(Math.round(boardY * 100)).padStart(6, '0')}D01*`,
    'M02*',
  ].join('\n');
  const outline = [
    gerberHeader('BOARD_OUTLINE'),
    'G01 X000000Y000000D02*',
    `X${String(Math.round(boardX * 100)).padStart(6, '0')}Y000000D01*`,
    `X${String(Math.round(boardX * 100)).padStart(6, '0')}Y${String(Math.round(boardY * 100)).padStart(6, '0')}D01*`,
    `X000000Y${String(Math.round(boardY * 100)).padStart(6, '0')}D01*`,
    'X000000Y000000D01*',
    'M02*',
  ].join('\n');
  const drill = [
    'M48',
    'METRIC,TZ',
    'T01C3.200',
    '%',
    'T01',
    'X004000Y004000',
    `X${String(Math.round(boardX * 100 - 400)).padStart(6, '0')}Y004000`,
    `X004000Y${String(Math.round(boardY * 100 - 400)).padStart(6, '0')}`,
    `X${String(Math.round(boardX * 100 - 400)).padStart(6, '0')}Y${String(Math.round(boardY * 100 - 400)).padStart(6, '0')}`,
    'M30',
  ].join('\n');
  return {
    'board_top_copper.gbr': `${topCopper}\n`,
    'board_outline.gbr': `${outline}\n`,
    'board_drill.drl': `${drill}\n`,
  };
}

export function buildAssemblyInstructions(assemblyDocument = {}) {
  const electricalParts = (assemblyDocument.parts || []).filter((part) => String(part.kind || '').startsWith('electrical'));
  const mechanicalParts = (assemblyDocument.parts || []).filter((part) => part.kind === 'mechanical');
  const lines = [
    '# UARE assembly instructions',
    '',
    '1. Fabricate the PCB using the supplied Gerber bundle.',
    '2. Place and solder electrical components in the order listed below.',
    '3. Mount the PCB to the mechanical frame using the specified hole pattern.',
    '4. Route wiring harnesses and verify net continuity.',
    '5. Run final electrical and mechanical validation before enclosure closeout.',
    '',
    '## Electrical placement order',
    ...electricalParts.map((part, index) => `${index + 1}. ${part.name} (${part.footprint || 'GENERIC'})`),
    '',
    '## Mechanical assembly order',
    ...mechanicalParts.map((part, index) => `${index + 1}. ${part.name}`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}
