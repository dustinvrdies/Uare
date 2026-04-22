import { createRemoteJWKSet, jwtVerify } from 'jose';

let jwks = null;

function getJwks(runtime = {}) {
  if (!runtime.jwtJwksUrl) return null;
  if (!jwks) jwks = createRemoteJWKSet(new URL(runtime.jwtJwksUrl));
  return jwks;
}

export async function verifyBearerToken(token, runtime = {}) {
  const keySet = getJwks(runtime);
  if (!keySet) throw new Error('JWT JWKS URL not configured');
  const result = await jwtVerify(token, keySet, {
    issuer: runtime.jwtIssuer || undefined,
    audience: runtime.jwtAudience || undefined
  });
  return result.payload || {};
}
