// Regression tests for HTML-injection hardening in the dashboard.
//
// The dashboard is a single self-contained HTML file with no build step, so these
// tests read dashboard/public/jarvis.html directly: the escaping helpers are
// extracted and executed, and the render templates are linted for sinks that take
// feed-derived text without escaping it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'dashboard/public/jarvis.html'), 'utf8');

/** Pull the real esc()/cleanText() implementations out of the dashboard. */
function loadHelpers() {
  const src = HTML.match(/const ESC_MAP=[\s\S]*?function cleanText\(t\)\{[^\n]*\}/);
  assert.ok(src, 'could not locate ESC_MAP/esc/cleanText in jarvis.html');
  return new Function(`${src[0]}; return { esc, cleanText };`)();
}

const { esc, cleanText } = loadHelpers();

/** Does this string still contain something a parser would treat as a tag? */
const hasLiveTag = s => /<[a-zA-Z/!]/.test(s);

const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '"><svg onload=alert(1)>',
  "'><img src=x onerror=alert(1)>",
  '</script><img src=x onerror=alert(1)>',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '<im<div>g src=x onerror=alert(1)>',
  '<iframe src="javascript:alert(1)">',
  '<a href="x" onmouseover="alert(1)">hover</a>',
];

describe('esc()', () => {
  test('escapes every HTML-significant character', () => {
    assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  });

  for (const payload of PAYLOADS) {
    test(`neutralizes: ${payload}`, () => {
      const out = esc(payload);
      assert.ok(!hasLiveTag(out), `payload survived escaping: ${out}`);
      assert.ok(!out.includes('<'), 'no raw < may remain');
      assert.ok(!out.includes('>'), 'no raw > may remain');
    });
  }

  test('escapes attribute-breaking quotes', () => {
    // Sinks like data-url="${esc(...)}" depend on this.
    assert.ok(!esc('" onload="alert(1)').includes('"'));
    assert.ok(!esc("' onload='alert(1)").includes("'"));
  });

  test('renders nullish input as an empty string', () => {
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
  });

  test('preserves falsy non-nullish values', () => {
    // Numeric fields (delta from/to, counts) pass through esc(); 0 must survive.
    assert.equal(esc(0), '0');
    assert.equal(esc(false), 'false');
    assert.equal(esc(''), '');
  });

  test('leaves ordinary feed text untouched', () => {
    assert.equal(esc('Brent crude up 3.2% on Red Sea disruption'),
      'Brent crude up 3.2% on Red Sea disruption');
  });
});

describe('cleanText()', () => {
  for (const payload of PAYLOADS) {
    test(`neutralizes: ${payload}`, () => {
      const out = cleanText(payload);
      assert.ok(!hasLiveTag(out), `payload survived cleanText: ${out}`);
    });
  }

  test('still decodes the entities feeds double-encode', () => {
    assert.equal(cleanText('Iran&#39;s response'), 'Iran&#39;s response');
    assert.equal(cleanText('Reuters &amp; AP'), 'Reuters &amp; AP');
  });

  test('escapes the result of tag stripping', () => {
    // Stripping alone used to leave attribute fragments live in the output.
    const out = cleanText('<im<div>g src=x onerror=alert(1)>');
    assert.ok(!out.includes('<'), out);
    assert.ok(!out.includes('>'), out);
  });

  test('tolerates nullish input', () => {
    assert.equal(cleanText(null), '');
    assert.equal(cleanText(undefined), '');
  });
});

describe('render templates — no unescaped feed data reaches innerHTML', () => {
  // Interpolations of third-party text that must never be raw. Each entry is the
  // exact `${...}` expression that would appear if the escaping were removed.
  const FORBIDDEN = [
    // LLM output (prompted with OSINT text, so attacker-influenceable)
    '${idea.title}', '${idea.text||idea.rationale||\'\'}', '${idea.risk}', '${idea.ticker}',
    // Telegram
    '${p.channel}', '${f}',
    // ACLED / NOAA / WHO
    '${e.location}', '${e.country}', '${a.headline}', '${w.summary}',
    // KiwiSDR receiver names (operator-supplied), EPA, Safecast, CelesTrak
    '${r.name}', '${s.analyte}', '${s.state}', '${s.site}',
    // Delta rows and cross-source signals
    '${s.label}', '${s.reason||s.label||s.key}', '${s.label||s.key}',
    // Market tiles
    '${q.name||q.symbol}',
  ];

  for (const expr of FORBIDDEN) {
    test(`no raw interpolation of ${expr}`, () => {
      assert.ok(!HTML.includes(expr),
        `${expr} is interpolated without esc() — wrap it in esc(...)`);
    });
  }

  test('the popup body is still an innerHTML sink', () => {
    // If this stops being innerHTML the two tests below can be relaxed — until
    // then every value reaching it has to arrive pre-escaped.
    assert.ok(HTML.includes(".pp-text').innerHTML"), 'popup sink moved — revisit these tests');
  });

  test('every direct showPopup call passes escaped body text', () => {
    const calls = (HTML.match(/(?<!function )showPopup\([^\n]*/g) || []);
    assert.ok(calls.length >= 4, 'expected several showPopup call sites');
    for (const call of calls) {
      // The globe's generic dispatcher forwards pt.popText, which is escaped where
      // each point is constructed (covered by the popText test below).
      if (call.includes('pt.popText')) continue;
      // A hardcoded string literal as the body carries no feed data.
      if (/^showPopup\([^,]+,[^,]+,\s*'[^']*'\s*,/.test(call)) continue;
      assert.ok(/esc\(|cleanText\(/.test(call),
        `showPopup call passes unescaped text: ${call.slice(0, 120)}`);
    }
  });

  test('every popText payload is escaped at construction', () => {
    const matches = HTML.match(/popText\s*:[^\n]*/g) || [];
    assert.ok(matches.length >= 5, 'expected several popText producers');
    for (const m of matches) {
      assert.ok(/esc\(|cleanText\(/.test(m), `unescaped popText: ${m.slice(0, 120)}`);
    }
  });
});

describe('inject.mjs — script-block breakout', () => {
  const injectSrc = readFileSync(join(ROOT, 'dashboard/inject.mjs'), 'utf8');

  test('neutralizes </script> and <!-- in the injected data blob', () => {
    // Reproduce the escaping cliInject() applies to the serialized sweep.
    const escapeBlob = json => json
      .replace(/<\/(script)/gi, '<\\/$1')
      .replace(/<!--/g, '<\\u0021--');

    const poisoned = {
      news: [{ title: '</script><img src=x onerror=alert(1)>' }],
      tg: { urgent: [{ text: '<!--<script>alert(1)</script>-->' }] },
    };
    const blob = escapeBlob(JSON.stringify(poisoned));

    assert.ok(!/<\/script/i.test(blob), 'blob can still close the script element');
    assert.ok(!blob.includes('<!--'), 'blob can still open an HTML comment');

    // The escapes are JS string escapes, so the value is unchanged once parsed.
    assert.deepEqual(JSON.parse(eval(`(${JSON.stringify(blob)})`)), poisoned);
  });

  test('cliInject applies that escaping before writing the HTML', () => {
    assert.match(injectSrc, /replace\(\/<\\\/\(script\)\/gi/,
      'the </script> guard is missing from inject.mjs');
    assert.match(injectSrc, /replace\(\/<!--\/g/,
      'the <!-- guard is missing from inject.mjs');
  });
});
