import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('deployment service examples exist and document headless restart-safe defaults', () => {
  const launchdPath = new URL('../deploy/launchd/com.crucix.local.plist', import.meta.url);
  const systemdPath = new URL('../deploy/systemd/crucix.service', import.meta.url);
  const docs = read('../docs/deployment-service-examples.md');
  const launchd = read('../deploy/launchd/com.crucix.local.plist');
  const systemd = read('../deploy/systemd/crucix.service');

  assert.equal(existsSync(launchdPath), true);
  assert.equal(existsSync(systemdPath), true);

  assert.match(docs, /deploy\/launchd\/com\.crucix\.local\.plist/);
  assert.match(docs, /deploy\/systemd\/crucix\.service/);
  assert.match(docs, /CRUCIX_AUTO_OPEN_BROWSER=0/);
  assert.match(docs, /503/);

  assert.match(launchd, /<string>com\.crucix\.local<\/string>/);
  assert.match(launchd, /<string>node<\/string>/);
  assert.match(launchd, /<string>server\.mjs<\/string>/);
  assert.match(launchd, /<key>RunAtLoad<\/key>/);
  assert.match(launchd, /<key>KeepAlive<\/key>/);
  assert.match(launchd, /<key>CRUCIX_AUTO_OPEN_BROWSER<\/key>/);

  assert.match(systemd, /^ExecStart=\/usr\/bin\/env node server\.mjs$/m);
  assert.match(systemd, /^ExecStartPre=\/usr\/bin\/env node --check server\.mjs$/m);
  assert.match(systemd, /^Restart=on-failure$/m);
  assert.match(systemd, /^RestartSec=10$/m);
  assert.match(systemd, /^KillSignal=SIGTERM$/m);
  assert.match(systemd, /^Environment=CRUCIX_AUTO_OPEN_BROWSER=0$/m);
});

test('launchd plist is syntactically valid xml on macOS hosts', { skip: process.platform !== 'darwin' }, () => {
  const plistPath = join(new URL('../deploy/launchd/com.crucix.local.plist', import.meta.url).pathname);
  execFileSync('plutil', ['-lint', plistPath], { stdio: 'pipe' });
});
