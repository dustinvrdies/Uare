/**
 * tests/secretsManager.test.mjs
 *
 * Unit tests for the secrets manager abstraction.
 * Runs without network access.
 */
import assert from 'node:assert/strict';

// ── Helper: import the module under test with a fresh module cache ──────────
// We import it directly since loadSecrets operates via process.env side-effects.
const { loadSecrets } = await import('../src/secrets/secretsManager.mjs');

// ── Test 1: env backend is a no-op ──────────────────────────────────────────
{
  const env = { SECRETS_BACKEND: 'env', EXISTING_KEY: 'hello' };
  await loadSecrets(env);
  assert.equal(env.EXISTING_KEY, 'hello', 'env backend must not mutate existing keys');
  console.log('PASS: env backend no-op');
}

// ── Test 2: unknown backend throws ──────────────────────────────────────────
{
  const env = { SECRETS_BACKEND: 'vault' };
  let threw = false;
  try {
    await loadSecrets(env);
  } catch (err) {
    threw = true;
    assert.ok(err.message.includes('Unknown SECRETS_BACKEND'), 'should mention Unknown SECRETS_BACKEND');
  }
  assert.ok(threw, 'unknown backend must throw');
  console.log('PASS: unknown backend throws');
}

// ── Test 3: aws backend without ARN throws ───────────────────────────────────
{
  const env = { SECRETS_BACKEND: 'aws', AWS_REGION: 'us-east-1' };
  let threw = false;
  try {
    await loadSecrets(env);
  } catch (err) {
    threw = true;
    // Either missing dep error or missing ARN error — both are acceptable
    assert.ok(
      err.message.includes('SECRETS_ARN') || err.message.includes('@aws-sdk'),
      `unexpected error: ${err.message}`
    );
  }
  assert.ok(threw, 'aws backend without ARN (or SDK) must throw');
  console.log('PASS: aws backend without ARN/SDK throws');
}

// ── Test 4: default backend is env ───────────────────────────────────────────
{
  const env = { MY_SECRET: 'value' };
  await loadSecrets(env); // no SECRETS_BACKEND key → defaults to 'env'
  assert.equal(env.MY_SECRET, 'value', 'default backend preserves values');
  console.log('PASS: default backend is env');
}

console.log('\nAll secretsManager tests passed.');
