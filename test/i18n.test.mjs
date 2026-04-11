// Internationalization (i18n) — unit tests
// Uses Node.js built-in test runner (node:test)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withEnv } from './helpers.mjs';

// i18n caches locales in a module-level Map, so we need to import fresh
// Since the module also logs on import, we accept that side effect

import { getLanguage, getLocale, t, getLLMPrompt, getSupportedLocales, isSupported, currentLanguage } from '../lib/i18n.mjs';

// ─── getLanguage Tests ───

describe('getLanguage', () => {
  it('should return en by default when no env vars set', async () => {
    await withEnv({ CRUCIX_LANG: null, LANGUAGE: null, LANG: null }, () => {
      const lang = getLanguage();
      assert.equal(lang, 'en');
    });
  });

  it('should prefer CRUCIX_LANG over LANGUAGE and LANG', async () => {
    await withEnv({ CRUCIX_LANG: 'fr', LANGUAGE: 'en', LANG: 'en' }, () => {
      assert.equal(getLanguage(), 'fr');
    });
  });

  it('should fall back to LANGUAGE when CRUCIX_LANG not set', async () => {
    await withEnv({ CRUCIX_LANG: null, LANGUAGE: 'FR_FR', LANG: 'en' }, () => {
      assert.equal(getLanguage(), 'fr');
    });
  });

  it('should fall back to LANG when others not set', async () => {
    await withEnv({ CRUCIX_LANG: null, LANGUAGE: null, LANG: 'fr_FR.UTF-8' }, () => {
      assert.equal(getLanguage(), 'fr');
    });
  });

  it('should return en for unsupported locale', async () => {
    await withEnv({ CRUCIX_LANG: 'de', LANGUAGE: null, LANG: null }, () => {
      assert.equal(getLanguage(), 'en');
    });
  });

  it('should handle case insensitivity', async () => {
    await withEnv({ CRUCIX_LANG: 'FR', LANGUAGE: null, LANG: null }, () => {
      assert.equal(getLanguage(), 'fr');
    });
  });
});

// ─── getLocale Tests ───

describe('getLocale', () => {
  it('should return an object with expected keys for en', async () => {
    await withEnv({ CRUCIX_LANG: 'en', LANGUAGE: null, LANG: null }, () => {
      const locale = getLocale();
      assert.ok(locale.meta);
      assert.ok(locale.dashboard);
      assert.ok(locale.panels);
      assert.equal(locale.meta.code, 'en');
    });
  });

  it('should return French locale data', async () => {
    await withEnv({ CRUCIX_LANG: 'fr', LANGUAGE: null, LANG: null }, () => {
      const locale = getLocale();
      assert.equal(locale.meta.code, 'fr');
      assert.equal(locale.meta.nativeName, 'Fran\u00e7ais');
    });
  });
});

// ─── t() Translation Tests ───

describe('t', () => {
  it('should resolve simple key path', async () => {
    await withEnv({ CRUCIX_LANG: 'en', LANGUAGE: null, LANG: null }, () => {
      const result = t('dashboard.title');
      assert.match(result, /CRUCIX/);
    });
  });

  it('should resolve nested key path', async () => {
    await withEnv({ CRUCIX_LANG: 'en', LANGUAGE: null, LANG: null }, () => {
      const result = t('nuclear.allSitesNormal');
      assert.equal(result, 'ALL SITES NORMAL');
    });
  });

  it('should return keyPath for missing key', async () => {
    await withEnv({ CRUCIX_LANG: 'en', LANGUAGE: null, LANG: null }, () => {
      const result = t('nonexistent.key.path');
      assert.equal(result, 'nonexistent.key.path');
    });
  });

  it('should interpolate parameters', async () => {
    await withEnv({ CRUCIX_LANG: 'en', LANGUAGE: null, LANG: null }, () => {
      const result = t('boot.connecting', { count: 25 });
      assert.match(result, /25/);
      assert.match(result, /CONNECTING/);
    });
  });

  it('should keep placeholder for missing params', async () => {
    await withEnv({ CRUCIX_LANG: 'en', LANGUAGE: null, LANG: null }, () => {
      const result = t('boot.connecting', {});
      assert.match(result, /\{count\}/);
    });
  });

  it('should return French translations', async () => {
    await withEnv({ CRUCIX_LANG: 'fr', LANGUAGE: null, LANG: null }, () => {
      const result = t('dashboard.title');
      assert.match(result, /Renseignement/);
    });
  });

  it('should return keyPath when value is an object not string', async () => {
    await withEnv({ CRUCIX_LANG: 'en', LANGUAGE: null, LANG: null }, () => {
      // 'dashboard' points to an object, not a string
      const result = t('dashboard');
      assert.equal(result, 'dashboard');
    });
  });
});

// ─── getLLMPrompt Tests ───

describe('getLLMPrompt', () => {
  it('should return English LLM prompt', async () => {
    await withEnv({ CRUCIX_LANG: 'en', LANGUAGE: null, LANG: null }, () => {
      const prompt = getLLMPrompt();
      assert.ok(prompt.length > 0);
      assert.match(prompt, /quantitative analyst/);
    });
  });

  it('should return French LLM prompt when lang is fr', async () => {
    await withEnv({ CRUCIX_LANG: 'fr', LANGUAGE: null, LANG: null }, () => {
      const prompt = getLLMPrompt();
      assert.ok(prompt.length > 0);
      assert.match(prompt, /analyste quantitatif/);
    });
  });
});

// ─── getSupportedLocales Tests ───

describe('getSupportedLocales', () => {
  it('should return array with en and fr', () => {
    const locales = getSupportedLocales();
    assert.ok(Array.isArray(locales));
    assert.equal(locales.length, 2);

    const codes = locales.map(l => l.code);
    assert.ok(codes.includes('en'));
    assert.ok(codes.includes('fr'));
  });

  it('should include name and nativeName', () => {
    const locales = getSupportedLocales();
    const en = locales.find(l => l.code === 'en');
    assert.equal(en.name, 'English');
    assert.equal(en.nativeName, 'English');

    const fr = locales.find(l => l.code === 'fr');
    assert.equal(fr.name, 'French');
    assert.equal(fr.nativeName, 'Fran\u00e7ais');
  });
});

// ─── isSupported Tests ───

describe('isSupported', () => {
  it('should return true for en', () => assert.equal(isSupported('en'), true));
  it('should return true for fr', () => assert.equal(isSupported('fr'), true));
  it('should return true for FR (case insensitive)', () => assert.equal(isSupported('FR'), true));
  it('should return true for fr_FR (slices to 2 chars)', () => assert.equal(isSupported('fr_FR'), true));
  it('should return false for de', () => assert.equal(isSupported('de'), false));
  it('should return false for null', () => assert.equal(isSupported(null), false));
  it('should return false for undefined', () => assert.equal(isSupported(undefined), false));
});

// ─── currentLanguage export ───

describe('currentLanguage', () => {
  it('should be a string', () => {
    assert.equal(typeof currentLanguage, 'string');
  });

  it('should be a supported locale', () => {
    assert.ok(isSupported(currentLanguage));
  });
});
