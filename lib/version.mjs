// Crucix version — package.json is the single source of truth.
// Bump it with `npm version <x.y.z> --no-git-tag-version`; the API, server banner,
// loading screen and dashboard boot sequence all read it from here.

import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const VERSION = pkg.version;
