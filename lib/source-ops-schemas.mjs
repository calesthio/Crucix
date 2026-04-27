import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateAgainstSchema } from './schema-validator.mjs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadSourceOpsSchema(rootDir, relativePath) {
  return readJson(join(rootDir, relativePath));
}

export function validateSourceOpsArtifact({ rootDir, schemaPath, artifact, label = schemaPath }) {
  const schema = loadSourceOpsSchema(rootDir, schemaPath);
  return {
    schema,
    ...validateAgainstSchema(artifact, schema, { path: label }),
  };
}
