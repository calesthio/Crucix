// Crucix Error Hierarchy — structured, serializable error classes

/**
 * Base error for all Crucix-specific errors.
 * Carries a machine-readable `code`, optional `source` identifier,
 * and an HTTP `statusCode` for use in Express error middleware.
 */
export class CrucixError extends Error {
  constructor(message, { code = 'CRUCIX_ERROR', source = null, statusCode = 500, cause } = {}) {
    super(message, { cause });
    this.name = 'CrucixError';
    this.code = code;
    this.source = source;
    this.statusCode = statusCode;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      source: this.source,
      statusCode: this.statusCode,
      ...(this.cause ? { cause: this.cause.message || String(this.cause) } : {}),
    };
  }
}

/**
 * Data-source fetch failures (HTTP errors, timeouts, bad responses).
 */
export class SourceError extends CrucixError {
  constructor(message, { source = null, statusCode = 502, cause } = {}) {
    super(message, { code: 'SOURCE_ERROR', source, statusCode, cause });
    this.name = 'SourceError';
  }
}

/**
 * Missing or invalid configuration (env vars, config file values).
 */
export class ConfigError extends CrucixError {
  constructor(message, { source = null, statusCode = 500, cause } = {}) {
    super(message, { code: 'CONFIG_ERROR', source, statusCode, cause });
    this.name = 'ConfigError';
  }
}

/**
 * LLM provider failures (API errors, timeouts, invalid responses).
 */
export class LLMError extends CrucixError {
  constructor(message, { source = null, statusCode = 502, cause } = {}) {
    super(message, { code: 'LLM_ERROR', source, statusCode, cause });
    this.name = 'LLMError';
  }
}

/**
 * Alert delivery failures (Telegram, Discord, webhooks).
 */
export class AlertError extends CrucixError {
  constructor(message, { source = null, statusCode = 502, cause } = {}) {
    super(message, { code: 'ALERT_ERROR', source, statusCode, cause });
    this.name = 'AlertError';
  }
}
