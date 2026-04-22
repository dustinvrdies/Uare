import path from 'path';
import { fileURLToPath } from 'url';

export function dirnameFromImportMeta(metaUrl) {
  return path.dirname(fileURLToPath(metaUrl));
}

export function resolveFromImportMeta(metaUrl, ...segments) {
  return path.resolve(dirnameFromImportMeta(metaUrl), ...segments);
}
