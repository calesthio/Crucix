import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePublicOrigin, socialPreviewMeta } from '../lib/social-preview.mjs';

test('resolvePublicOrigin prefers a valid configured URL', () => {
  assert.equal(
    resolvePublicOrigin('https://example.com/dashboard', { protocol: 'http', host: 'localhost:3117' }),
    'https://example.com',
  );
});

test('resolvePublicOrigin falls back to the request origin', () => {
  assert.equal(resolvePublicOrigin(null, { protocol: 'https', host: 'crucix.test' }), 'https://crucix.test');
  assert.equal(resolvePublicOrigin('javascript:alert(1)', { protocol: 'http', host: 'localhost:3117' }), 'http://localhost:3117');
});

test('socialPreviewMeta emits complete absolute Open Graph metadata', () => {
  const meta = socialPreviewMeta('https://crucix.test');
  assert.match(meta, /property="og:title"/);
  assert.match(meta, /property="og:description"/);
  assert.match(meta, /property="og:url" content="https:\/\/crucix\.test\/"/);
  assert.match(meta, /property="og:image" content="https:\/\/crucix\.test\/share-card\.png"/);
  assert.match(meta, /name="twitter:card" content="summary_large_image"/);
  assert.match(meta, /property="og:image:width" content="1200"/);
  assert.match(meta, /property="og:image:height" content="630"/);
});

test('share preview is a 1200 by 630 PNG', () => {
  const png = readFileSync(new URL('../dashboard/public/share-card.png', import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
