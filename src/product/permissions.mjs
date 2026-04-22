import { requireActor } from '../auth/actorResolver.mjs';

export async function requireOrgRole(productStore, orgId, userId, allowedRoles = []) {
  requireActor({ id: userId, isAuthenticated: true });
  const membership = await productStore.getMembership(orgId, userId);
  if (!membership) {
    const error = new Error('Organization membership required');
    error.statusCode = 403;
    throw error;
  }
  if (allowedRoles.length && !allowedRoles.includes(membership.role)) {
    const error = new Error(`Requires one of roles: ${allowedRoles.join(', ')}`);
    error.statusCode = 403;
    throw error;
  }
  return membership;
}
