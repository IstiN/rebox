import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to repo root `openapi.yaml` (from `src/` or `dist/`). */
export function resolveOpenApiSpecPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'openapi.yaml');
}
