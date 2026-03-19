// lib/i18n — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLanguage,
  t,
  isSupported,
  getSupportedLocales,
} from '../lib/i18n.mjs';

describe('i18n — getLanguage()', () => {
  it('returns "en" when no language env vars are set', () => {
    const origCrucix = process.env.CRUCIX_LANG;
    const origLanguage = process.env.LANGUAGE;
    const origLang = process.env.LANG;
    try {
      delete process.env.CRUCIX_LANG;
      delete process.env.LANGUAGE;
      delete process.env.LANG;
      assert.equal(getLanguage(), 'en');
    } finally {
      if (origCrucix === undefined) delete process.env.CRUCIX_LANG;
      else process.env.CRUCIX_LANG = origCrucix;
      if (origLanguage === undefined) delete process.env.LANGUAGE;
      else process.env.LANGUAGE = origLanguage;
      if (origLang === undefined) delete process.env.LANG;
      else process.env.LANG = origLang;
    }
  });

  it('uses CRUCIX_LANG env var when set to a supported locale', () => {
    const orig = process.env.CRUCIX_LANG;
    try {
      process.env.CRUCIX_LANG = 'fr';
      assert.equal(getLanguage(), 'fr');
    } finally {
      if (orig === undefined) delete process.env.CRUCIX_LANG;
      else process.env.CRUCIX_LANG = orig;
    }
  });

  it('falls back to "en" for an unsupported locale like "zz"', () => {
    const orig = process.env.CRUCIX_LANG;
    try {
      process.env.CRUCIX_LANG = 'zz';
      assert.equal(getLanguage(), 'en');
    } finally {
      if (orig === undefined) delete process.env.CRUCIX_LANG;
      else process.env.CRUCIX_LANG = orig;
    }
  });
});

describe('i18n — t()', () => {
  it('returns a non-empty string for a key that exists in en.json', () => {
    // 'dashboard.title' exists in locales/en.json → "CRUCIX — Intelligence Terminal"
    const result = t('dashboard.title');
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
  });

  it('returns the key path itself for a nonexistent key', () => {
    const result = t('nonexistent.key.path');
    assert.equal(result, 'nonexistent.key.path');
  });
});

describe('i18n — isSupported()', () => {
  it('returns true for "en"', () => {
    assert.equal(isSupported('en'), true);
  });

  it('returns true for "fr"', () => {
    assert.equal(isSupported('fr'), true);
  });

  it('returns false for unsupported locale "zz"', () => {
    assert.equal(isSupported('zz'), false);
  });

  it('returns false for null', () => {
    assert.equal(isSupported(null), false);
  });
});

describe('i18n — getSupportedLocales()', () => {
  it('returns an array of objects with code and name fields', () => {
    const locales = getSupportedLocales();
    assert.ok(Array.isArray(locales));
    assert.ok(locales.length > 0);
    for (const locale of locales) {
      assert.ok('code' in locale, 'locale object must have a code field');
      assert.ok('name' in locale, 'locale object must have a name field');
      assert.equal(typeof locale.code, 'string');
      assert.equal(typeof locale.name, 'string');
    }
  });
});
