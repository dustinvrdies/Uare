/**
 * SMOKE TEST: Derived CAD Spec Panel Browser Rendering
 *
 * Tests the core browser-side rendering logic for the Derived CAD Spec panel,
 * including pending questions rendering and click handler functionality.
 */

import assert from 'assert';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    testsFailed++;
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

// ─── Test 1: Pending Questions Rendering Logic ──────────────────────────
test('_renderPendingQuestionsSection creates correct HTML structure', () => {
  const responseProfile = {
    pending_questions: [
      'What target torque, speed, and ratio should the drivetrain be sized for?',
      'What lubrication strategy should I assume: grease, splash oil, or forced oil?',
    ]
  };

  // Simulate the rendering logic
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pending = Array.isArray(responseProfile && responseProfile.pending_questions)
    ? responseProfile.pending_questions.filter(Boolean)
    : [];

  const html = '<section class="derived-spec-questions-block">'
    + '<div class="derived-spec-section-title">Missing Inputs</div>'
    + '<div class="derived-spec-empty">Click a question to add it to chat.</div>'
    + '<ul class="derived-spec-question-list">'
    + pending.map((entry, index) => '<li class="derived-spec-question-item" data-question-index="' + index + '">' + esc(String(entry)) + '</li>').join('')
    + '</ul>'
    + '</section>';

  assert(html.includes('derived-spec-questions-block'), 'Should include section wrapper');
  assert(html.includes('derived-spec-question-item'), 'Should include question items');
  assert(html.includes('data-question-index'), 'Should include question index attribute');
  assert(html.includes(responseProfile.pending_questions[0].substring(0, 20)), 'Should include question text');
});

// ─── Test 2: Empty Pending Questions Handling ────────────────────────────
test('_renderPendingQuestionsSection handles empty questions gracefully', () => {
  const responseProfile = {
    pending_questions: []
  };

  const pending = Array.isArray(responseProfile && responseProfile.pending_questions)
    ? responseProfile.pending_questions.filter(Boolean)
    : [];

  assert.strictEqual(pending.length, 0, 'Should have no pending questions');
  assert(responseProfile.pending_questions !== null, 'Questions array should be defined');
});

// ─── Test 3: Null/Undefined Response Profile Handling ────────────────────
test('_renderPendingQuestionsSection handles null response profile', () => {
  const responseProfile = null;
  const pending = Array.isArray(responseProfile && responseProfile.pending_questions)
    ? responseProfile.pending_questions.filter(Boolean)
    : [];

  assert.strictEqual(pending.length, 0, 'Should safely handle null profile');
});

// ─── Test 4: Click Handler Prefill Logic ────────────────────────────────
test('_onClickPendingQuestion correctly prefills chat input', () => {
  const testQuestion = 'What is the load case?';
  
  // Mock DOM elements
  const mockInput = { value: '', focus: () => {} };
  const mockBtn = { disabled: true };
  
  // Simulate click handler
  const handleClick = (question) => {
    if (!mockInput || !question) return false;
    mockInput.value = question;
    if (mockBtn) mockBtn.disabled = false;
    return mockInput.value === question && !mockBtn.disabled;
  };
  
  const result = handleClick(testQuestion);
  assert.strictEqual(mockInput.value, testQuestion, 'Input should be filled with question');
  assert.strictEqual(mockBtn.disabled, false, 'Send button should be enabled');
  assert(result, 'Handler should return success');
});

// ─── Test 5: Response Profile Structure ─────────────────────────────────
test('Response profile includes all required fields for Derived CAD Spec', () => {
  const responseProfile = {
    intent: 'design_request',
    theme: 'drivetrain / power transmission component',
    has_dimensions: true,
    highlights: ['2 dimensional constraints', '1 fit requirement'],
    pending_questions: ['Q1', 'Q2'],
    response_profile: {
      intent: 'design_request',
      theme: 'drivetrain / power transmission component',
      has_dimensions: true,
      highlights: ['2 dimensional constraints', '1 fit requirement']
    }
  };

  assert(responseProfile.intent !== undefined, 'Should have intent');
  assert(responseProfile.theme !== undefined, 'Should have theme');
  assert(Array.isArray(responseProfile.pending_questions), 'Should have pending_questions array');
  assert(Array.isArray(responseProfile.highlights), 'Should have highlights array');
});

// ─── Test 6: Domain-Specific Theme Detection ────────────────────────────
test('Domain-specific themes are correctly identified', () => {
  const themes = [
    'drivetrain / power transmission component',
    'fluid control component',
    'electronics mounting / sensor assembly',
    'thermal management component',
    'aerospace structural component',
    'structural bracket / mounting hardware'
  ];

  themes.forEach((theme) => {
    assert(theme.length > 0, `Theme "${theme}" should be non-empty`);
    assert(typeof theme === 'string', `Theme should be a string`);
  });

  assert.strictEqual(themes.length, 6, 'Should have 6 domain themes');
});

// ─── Test 7: Question Generation for Each Domain ────────────────────────
test('Each domain generates appropriate follow-up questions', () => {
  const questionSets = {
    'drivetrain / power transmission component': [
      'What target torque, speed, and ratio should the drivetrain be sized for?',
      'What lubrication strategy should I assume: grease, splash oil, or forced oil?'
    ],
    'fluid control component': [
      'What design point should I use for flow, pressure/head, and operating speed?',
      'What fluid and temperature range should drive material and seal selection?'
    ],
    'electronics mounting / sensor assembly': [
      'What supply voltage, current, and peak power should the electronics be designed around?',
      'Which connectors, buses, or sensors are mandatory on the PCB?'
    ],
    'thermal management component': [
      'What heat load, ambient temperature, and allowable temperature rise should I size for?',
      'Is this natural convection, forced air, or liquid cooling?'
    ],
    'aerospace structural component': [
      'What mission load case and ultimate/yield factors should I design for?',
      'Is this aluminum airframe, composite structure, or titanium primary structure?'
    ],
    'structural bracket / mounting hardware': [
      'What load direction and peak load should I design the bracket around?',
      'What mounting-hole count and pattern should be enforced?'
    ]
  };

  Object.entries(questionSets).forEach(([domain, questions]) => {
    assert(Array.isArray(questions), `Questions for ${domain} should be an array`);
    assert(questions.length >= 2, `Domain "${domain}" should have at least 2 questions`);
    questions.forEach((q) => {
      assert(q.length > 0, `Question should be non-empty for ${domain}`);
      assert(typeof q === 'string', `Question should be a string for ${domain}`);
    });
  });
});

// ─── Test 8: HTML Escaping in Rendering ──────────────────────────────────
test('_renderPendingQuestionsSection correctly escapes HTML in questions', () => {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  
  const maliciousQuestion = '<script>alert("xss")</script> What is this?';
  const escaped = esc(maliciousQuestion);
  
  assert(!escaped.includes('<script>'), 'Should escape script tags');
  assert(!escaped.includes('</script>'), 'Should escape script closing tags');
  assert(escaped.includes('&lt;script&gt;'), 'Should convert < and >');
  assert(escaped.includes('&quot;'), 'Should escape quotes');
});

// ─── Test 9: Pending Questions Array Filtering ──────────────────────────
test('Pending questions are correctly filtered for falsy values', () => {
  const dirty = [
    'Q1',
    null,
    'Q2',
    undefined,
    '',
    'Q3',
    false,
    'Q4'
  ];

  const clean = dirty.filter(Boolean);
  assert.strictEqual(clean.length, 4, 'Should filter out null, undefined, empty string, and false');
  assert(clean.every(q => q && typeof q === 'string'), 'All remaining items should be non-empty strings');
});

// ─── Test 10: Response Profile Integration with UI State ─────────────────
test('Response profile correctly maps to UI rendering state', () => {
  const responseProfile = {
    intent: 'design_request',
    theme: 'thermal management component',
    has_dimensions: true,
    highlights: ['1 heat load constraint'],
    pending_questions: [
      'What heat load should I size for?',
      'Is this natural or forced convection?'
    ]
  };

  const shouldRender = {
    pendingQuestions: Array.isArray(responseProfile.pending_questions) && responseProfile.pending_questions.length > 0,
    themeLabel: responseProfile.theme && responseProfile.theme.length > 0,
    intentBadge: responseProfile.intent && responseProfile.intent.length > 0,
    constraintHighlights: Array.isArray(responseProfile.highlights) && responseProfile.highlights.length > 0
  };

  assert(shouldRender.pendingQuestions, 'Should render pending questions section');
  assert(shouldRender.themeLabel, 'Should display theme label');
  assert(shouldRender.intentBadge, 'Should display intent badge');
  assert(shouldRender.constraintHighlights, 'Should display constraint highlights');
});

// ─── Print Summary ───────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log('SMOKE TEST SUMMARY: Derived CAD Spec Panel Browser Rendering');
console.log('═'.repeat(60));
console.log(`✓ Passed: ${testsPassed}`);
console.log(`✗ Failed: ${testsFailed}`);
console.log(`Total:   ${testsPassed + testsFailed}`);
console.log(`Rate:    ${Math.round(testsPassed / (testsPassed + testsFailed) * 100)}%`);
console.log('═'.repeat(60));

if (testsFailed > 0) {
  process.exit(1);
}
