// Load .env file for API keys
// Searches: project root .env first, then apis/.env as fallback
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const paths = [
  resolve(__dirname, '..', '..', '.env'), // project root
  resolve(__dirname, '..', '.env'),        // apis/.env (legacy)
];

function loadEnv(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    let loaded = 0;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      // Strip surrounding quotes (single or double) — matches dotenv behavior
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) { process.env[key] = val; loaded++; }
    }
    return loaded;
  } catch { return -1; }
}

for (const p of paths) {
  if (loadEnv(p) >= 0) break;
}
