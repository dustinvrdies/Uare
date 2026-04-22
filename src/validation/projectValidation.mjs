export function validateProjectPayload(project = {}) {
  const issues = [];
  if (!project?.id) issues.push('project.id is required');
  if (typeof project?.title !== 'undefined' && typeof project.title !== 'string') issues.push('project.title must be a string');
  if (typeof project?.description !== 'undefined' && typeof project.description !== 'string') issues.push('project.description must be a string');
  if (typeof project?.workflow_status !== 'undefined' && typeof project.workflow_status !== 'string') issues.push('project.workflow_status must be a string');
  return { valid: issues.length === 0, issues };
}
