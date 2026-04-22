export function createWorkflowStepPluginRegistry(plugins = {}) {
  const registry = new Map();
  function register(name, plugin = {}) {
    registry.set(String(name), { name: String(name), ...plugin });
  }
  function get(name) {
    return registry.get(String(name)) || null;
  }
  function list() {
    return Array.from(registry.values()).map((entry) => ({ ...entry }));
  }
  for (const [name, plugin] of Object.entries(plugins || {})) register(name, plugin);
  return { register, get, list };
}
