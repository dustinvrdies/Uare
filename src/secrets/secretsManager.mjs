/**
 * custom_backend/src/secrets/secretsManager.mjs
 *
 * Thin abstraction for loading secrets at startup.
 * Supported backends:
 *   - "env"  (default) — reads process.env directly, no external calls
 *   - "aws"            — AWS Secrets Manager (requires @aws-sdk/client-secrets-manager)
 *
 * Usage in runtime.mjs / server.mjs:
 *   import { loadSecrets } from './src/secrets/secretsManager.mjs';
 *   await loadSecrets(process.env);   // mutates process.env in-place
 *
 * AWS secret format: one JSON object per secret ARN, keys are env var names.
 * Set SECRETS_ARN (or SECRETS_ARN_1, SECRETS_ARN_2, ...) to the ARN(s) to load.
 * Set SECRETS_BACKEND=aws to enable.
 *
 * Security notes:
 *   - Secret values are never logged.
 *   - Loaded values are written to process.env once at startup only.
 *   - No secret is returned to the caller; mutation is the side-effect.
 */

const SUPPORTED_BACKENDS = new Set(['env', 'aws']);

/**
 * Load secrets from the configured backend into process.env.
 * @param {NodeJS.ProcessEnv} env - process.env (mutated in-place)
 * @returns {Promise<void>}
 */
export async function loadSecrets(env = process.env) {
  const backend = String(env.SECRETS_BACKEND || 'env').toLowerCase();

  if (!SUPPORTED_BACKENDS.has(backend)) {
    throw new Error(`Unknown SECRETS_BACKEND: "${backend}". Supported: ${[...SUPPORTED_BACKENDS].join(', ')}`);
  }

  if (backend === 'env') {
    // No-op: secrets are already in process.env.
    return;
  }

  if (backend === 'aws') {
    await _loadFromAwsSecretsManager(env);
    return;
  }
}

/**
 * Load secrets from AWS Secrets Manager.
 * Requires `@aws-sdk/client-secrets-manager` to be installed.
 * @param {NodeJS.ProcessEnv} env
 */
async function _loadFromAwsSecretsManager(env) {
  // Dynamically import so the dep is optional for non-AWS deployments.
  let SecretsManagerClient, GetSecretValueCommand;
  try {
    const mod = await import('@aws-sdk/client-secrets-manager');
    SecretsManagerClient = mod.SecretsManagerClient;
    GetSecretValueCommand = mod.GetSecretValueCommand;
  } catch {
    throw new Error(
      'SECRETS_BACKEND=aws requires @aws-sdk/client-secrets-manager. ' +
      'Run: npm install @aws-sdk/client-secrets-manager'
    );
  }

  const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1';
  const client = new SecretsManagerClient({ region });

  // Collect all ARNs: SECRETS_ARN, SECRETS_ARN_1, SECRETS_ARN_2, ...
  const arns = _collectArns(env);
  if (arns.length === 0) {
    throw new Error('SECRETS_BACKEND=aws but no SECRETS_ARN (or SECRETS_ARN_1, ...) is set.');
  }

  for (const arn of arns) {
    const command = new GetSecretValueCommand({ SecretId: arn });
    const response = await client.send(command);
    const raw = response.SecretString;
    if (!raw) {
      throw new Error(`Secret ${arn} has no SecretString (binary secrets are not supported).`);
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Secret ${arn} is not valid JSON. Each secret must be a JSON object of { ENV_VAR: value }.`);
    }

    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
      throw new Error(`Secret ${arn} must be a JSON object, not an array or scalar.`);
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') {
        throw new Error(`Secret ${arn} key "${key}" must be a string value.`);
      }
      // Only set if not already present — allows local overrides to win.
      if (!env[key]) {
        env[key] = value;
        process.env[key] = value;
      }
    }
  }
}

/**
 * Collect all SECRETS_ARN* values from env.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function _collectArns(env) {
  const arns = [];
  if (env.SECRETS_ARN) arns.push(String(env.SECRETS_ARN));
  let i = 1;
  while (env[`SECRETS_ARN_${i}`]) {
    arns.push(String(env[`SECRETS_ARN_${i}`]));
    i++;
  }
  return arns;
}
