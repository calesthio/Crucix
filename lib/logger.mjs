// Structured JSON logger for Crucix
// Wraps console methods with timestamp, level, source, and error fields.

function formatEntry(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  if (meta.source) entry.source = meta.source;
  if (meta.error) {
    const err = meta.error;
    entry.error = {
      name: err.name || 'Error',
      message: err.message || String(err),
      code: err.code || undefined,
      statusCode: err.statusCode || undefined,
      stack: err.stack || undefined,
    };
  }
  // Merge any extra fields
  for (const [k, v] of Object.entries(meta)) {
    if (k !== 'source' && k !== 'error' && v !== undefined) {
      entry[k] = v;
    }
  }
  return entry;
}

export const logger = {
  info(message, meta) {
    console.log(JSON.stringify(formatEntry('info', message, meta)));
  },

  warn(message, meta) {
    console.warn(JSON.stringify(formatEntry('warn', message, meta)));
  },

  error(message, meta) {
    console.error(JSON.stringify(formatEntry('error', message, meta)));
  },

  debug(message, meta) {
    if (process.env.CRUCIX_DEBUG) {
      console.log(JSON.stringify(formatEntry('debug', message, meta)));
    }
  },
};
