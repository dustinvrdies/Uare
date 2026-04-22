export function createAuditEntry({ actor, action, projectId, payload = {} }) {
  return {
    actor_id: actor?.id || 'unknown',
    actor_role: actor?.role || 'unknown',
    action,
    project_id: projectId || null,
    payload
  };
}
