import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8901);

try {
  const response = await fetch(`${server.baseUrl}/copilot/contextual-analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'tester',
      'x-user-role': 'owner',
    },
    body: JSON.stringify({
      prompt: 'Design a gearbox housing 260 mm long, 95 mm wide, 82 mm tall with 7.5 mm walls, H7/g6 fit on output shaft bore, ±0.02 mm tolerance, and 4x M8 holes on 80 mm bolt circle.',
    }),
  });

  const data = await response.json();
  assert(response.ok === true, 'contextual-analysis should succeed');
  assert(data.ok === true, 'contextual-analysis payload should be ok');
  assert(data.cad_execution_id === null, 'contextual-analysis should not auto-execute CAD without opt-in');
  assert(data.assembly_plan, 'contextual-analysis should return an assembly plan for design prompts');
  assert(data.derived_cad_spec, 'contextual-analysis should return a derived CAD spec');
  assert(data.derived_cad_spec.dimensions.length_mm === 260, 'derived spec should extract length from the prompt');
  assert(data.derived_cad_spec.dimensions.width_mm === 95, 'derived spec should extract width from the prompt');
  assert(data.derived_cad_spec.dimensions.height_mm === 82, 'derived spec should extract height from the prompt');
  assert(data.derived_cad_spec.dimensions.wall_thickness_mm === 7.5, 'derived spec should extract wall thickness from the prompt');
  assert(data.derived_cad_spec.fits[0]?.designation === 'H7/g6', 'derived spec should extract fit designations');
  assert(data.derived_cad_spec.tolerances.some((entry) => entry.value_mm === 0.02), 'derived spec should extract plus/minus tolerances');
  assert(data.derived_cad_spec.hole_patterns[0]?.hole_count === 4, 'derived spec should extract hole counts');
  assert(data.derived_cad_spec.hole_patterns[0]?.thread_spec === 'M8', 'derived spec should extract threaded hole specs');
  assert(data.derived_cad_spec.hole_patterns[0]?.bolt_circle_mm === 80, 'derived spec should extract bolt-circle diameter');
  assert(data.derived_cad_spec.hole_patterns.length === 1, 'derived spec should not create a duplicate hole pattern from the thread designation');

  assert(data.response_profile, 'contextual-analysis should return a response profile');
  assert(data.response_profile.theme === 'drivetrain / power transmission component', 'gearbox prompt should classify as drivetrain');
  assert(Array.isArray(data.response_profile.pending_questions), 'response profile should include pending questions');
  assert(data.response_profile.pending_questions.some((entry) => /torque, speed, and ratio/i.test(entry)), 'drivetrain prompts should ask for torque/speed/ratio when missing');
  assert(data.assembly_plan.name.includes('drivetrain / power transmission component'), 'assembly plan name should reflect drivetrain theme');
  assert(data.assembly_plan.parts.some((part) => part.type === 'lip_seal'), 'drivetrain prompt-derived plan should include a seal');
  assert(data.assembly_plan.parts.filter((part) => part.type === 'bolt_hex').length === 4, 'prompt-derived plan should honor detected hole count in fastener generation');

  const pumpResponse = await fetch(`${server.baseUrl}/copilot/contextual-analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'tester',
      'x-user-role': 'owner',
    },
    body: JSON.stringify({
      prompt: 'Build a compact pump assembly with impeller and seal housing.',
    }),
  });
  const pumpData = await pumpResponse.json();
  assert(pumpResponse.ok === true, 'pump contextual-analysis should succeed');
  assert(pumpData.response_profile?.theme === 'fluid control component', 'pump prompt should classify as fluid control');
  assert(pumpData.response_profile?.pending_questions?.some((entry) => /flow, pressure\/head, and operating speed/i.test(entry)), 'pump prompt should ask for flow/pressure/speed');
  assert(pumpData.assembly_plan?.parts?.some((part) => part.type === 'impeller'), 'pump prompt-derived plan should include an impeller');

  const pcbResponse = await fetch(`${server.baseUrl}/copilot/contextual-analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'tester',
      'x-user-role': 'owner',
    },
    body: JSON.stringify({
      prompt: 'Design a controller PCB for a BLDC motor.',
    }),
  });
  const pcbData = await pcbResponse.json();
  assert(pcbResponse.ok === true, 'electronics contextual-analysis should succeed');
  assert(pcbData.response_profile?.theme === 'electronics mounting / sensor assembly', 'controller PCB prompt should classify as electronics');
  assert(pcbData.response_profile?.pending_questions?.some((entry) => /supply voltage, current, and peak power/i.test(entry)), 'electronics prompt should ask for power envelope');
  assert(pcbData.assembly_plan?.parts?.some((part) => part.type === 'pcb'), 'electronics prompt-derived plan should include a PCB');
  console.log('copilotDerivedSpecRoute.test.mjs passed');
} finally {
  await server.stop();
}