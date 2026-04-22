
import fs from 'fs';
import path from 'path';

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function createArtifactStore(rootDir) {
  const absoluteRoot = path.resolve(rootDir || './artifacts');
  fs.mkdirSync(absoluteRoot, { recursive: true });

  function executionDir(executionId) {
    return path.join(absoluteRoot, executionId);
  }

  function ensureExecutionDir(executionId) {
    const dir = executionDir(executionId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function writeText(executionId, filename, content) {
    const dir = ensureExecutionDir(executionId);
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  function writeBinary(executionId, filename, content) {
    const dir = ensureExecutionDir(executionId);
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  function readText(executionId, filename) {
    const filePath = path.join(executionDir(executionId), filename);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  }

  function readJson(executionId, filename) {
    const raw = readText(executionId, filename);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function fileExists(executionId, filename) {
    return fs.existsSync(path.join(executionDir(executionId), filename));
  }

  function statFile(executionId, filename) {
    const filePath = path.join(executionDir(executionId), filename);
    if (!fs.existsSync(filePath)) return null;
    const stats = fs.statSync(filePath);
    return {
      filename,
      bytes: stats.size,
      updated_at: stats.mtime.toISOString(),
      created_at: stats.birthtime?.toISOString?.() || stats.mtime.toISOString(),
      path: filePath,
    };
  }

  function listFiles(executionId) {
    const dir = executionDir(executionId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).sort();
  }

  function listArtifacts(executionId) {
    return listFiles(executionId).map((filename) => statFile(executionId, filename)).filter(Boolean);
  }

  function getManifest(executionId) {
    return readJson(executionId, 'manifest.json');
  }

  function listExecutionIds() {
    if (!fs.existsSync(absoluteRoot)) return [];
    return fs.readdirSync(absoluteRoot)
      .filter((entry) => fs.statSync(path.join(absoluteRoot, entry)).isDirectory())
      .sort()
      .reverse();
  }

  function listManifests() {
    return listExecutionIds()
      .map((executionId) => getManifest(executionId))
      .filter(Boolean)
      .sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')));
  }

  function listProjectExecutions(projectId) {
    return listManifests().filter((manifest) => String(manifest?.project_id || '') === String(projectId || ''));
  }

  return {
    rootDir: absoluteRoot,
    executionDir,
    ensureExecutionDir,
    writeText,
    writeBinary,
    readText,
    readJson,
    fileExists,
    statFile,
    listFiles,
    listArtifacts,
    getManifest,
    listExecutionIds,
    listManifests,
    listProjectExecutions,
  };
}
