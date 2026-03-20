// Internationalization (i18n) Module
// Loads locale files and provides translation functions

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOCALES_DIR = join(__dirname, '..', 'locales');

// Supported languages
const SUPPORTED_LOCALES = ['en', 'fr'];
const DEFAULT_LOCALE = 'en';

// Cache loaded locales
const localeCache = new Map();

/**
 * Get the current language from environment
 * @returns {string} Language code (e.g., 'en', 'fr')
 */
export function getLanguage() {
  // CRUCIX_LANG takes priority to avoid conflict with Linux system LANGUAGE variable
  const lang = (process.env.CRUCIX_LANG || process.env.LANGUAGE || process.env.LANG || DEFAULT_LOCALE)
    .toLowerCase()
    .slice(0, 2);
  return SUPPORTED_LOCALES.includes(lang) ? lang : DEFAULT_LOCALE;
}

/**
 * Load a locale file
 * @param {string} lang - Language code
 * @returns {object} Locale data
 */
function loadLocale(lang) {
  if (localeCache.has(lang)) {
    return localeCache.get(lang);
  }

  const localePath = join(LOCALES_DIR, `${lang}.json`);
  
  if (!existsSync(localePath)) {
    console.warn(`[i18n] Locale file not found: ${localePath}, falling back to ${DEFAULT_LOCALE}`);
    return loadLocale(DEFAULT_LOCALE);
  }

  try {
    const data = JSON.parse(readFileSync(localePath, 'utf-8'));
    localeCache.set(lang, data);
    return data;
  } catch (err) {
    console.error(`[i18n] Failed to load locale ${lang}:`, err.message);
    if (lang !== DEFAULT_LOCALE) {
      return loadLocale(DEFAULT_LOCALE);
    }
    return {};
  }
}

/**
 * Get the current locale data
 * @returns {object} Current locale data
 */
export function getLocale() {
  return loadLocale(getLanguage());
}

/**
 * Translate a key path (e.g., 'dashboard.title')
 * @param {string} keyPath - Dot-separated key path
 * @param {object} params - Optional parameters for interpolation
 * @returns {string} Translated string or key if not found
 */
export function t(keyPath, params = {}) {
  const locale = getLocale();
  const keys = keyPath.split('.');
  
  let value = locale;
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      console.warn(`[i18n] Missing translation: ${keyPath}`);
      return keyPath;
    }
  }

  if (typeof value !== 'string') {
    return keyPath;
  }

  // Interpolate parameters: {param} -> value
  return value.replace(/\{(\w+)\}/g, (_, key) => {
    return params[key] !== undefined ? params[key] : `{${key}}`;
  });
}

/**
 * Get LLM system prompt in current language
 * @returns {string} System prompt for LLM
 */
export function getLLMPrompt() {
  const locale = getLocale();
  // Use loadLocale('en') for fallback since getLocale() doesn't accept a language argument
  const fallbackLocale = loadLocale('en');
  return locale.llm?.systemPrompt || fallbackLocale.llm?.systemPrompt || '';
}

/**
 * Get all supported locales info
 * @returns {Array} Array of locale info objects
 */
export function getSupportedLocales() {
  return SUPPORTED_LOCALES.map(code => {
    const locale = loadLocale(code);
    return {
      code,
      name: locale.meta?.name || code,
      nativeName: locale.meta?.nativeName || code
    };
  });
}

/**
 * Check if a language is supported
 * @param {string} lang - Language code
 * @returns {boolean}
 */
export function isSupported(lang) {
  return SUPPORTED_LOCALES.includes(lang?.toLowerCase()?.slice(0, 2));
}

// Export current language on module load
export const currentLanguage = getLanguage();

console.log(`[i18n] Language: ${currentLanguage}`);
