function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function isValidDateTime(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && /[tT]/.test(value);
}

function joinPath(base, segment) {
  if (!base || base === '$') return `$.${segment}`;
  return `${base}.${segment}`;
}

function matchesType(value, expectedType) {
  if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expectedType === 'integer') return Number.isInteger(value);
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'null') return value === null;
  if (expectedType === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === expectedType;
}

function validateEnum(value, allowed) {
  return allowed.some(item => Object.is(item, value));
}

function validateNode(value, schema, path, errors) {
  if (!schema || typeof schema !== 'object') return;

  if ('type' in schema) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    const validType = expectedTypes.some(expectedType => matchesType(value, expectedType));
    if (!validType) {
      errors.push(`${path} expected type ${expectedTypes.join(' | ')}, received ${typeOf(value)}`);
      return;
    }
  }

  if ('const' in schema && !Object.is(value, schema.const)) {
    errors.push(`${path} expected const ${JSON.stringify(schema.const)}`);
  }

  if (Array.isArray(schema.enum) && !validateEnum(value, schema.enum)) {
    errors.push(`${path} expected one of ${schema.enum.map(item => JSON.stringify(item)).join(', ')}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push(`${path} expected minLength ${schema.minLength}`);
    }
    if (schema.format === 'date-time' && !isValidDateTime(value)) {
      errors.push(`${path} expected RFC3339 date-time string`);
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum != null && value < schema.minimum) {
      errors.push(`${path} expected minimum ${schema.minimum}`);
    }
    if (schema.maximum != null && value > schema.maximum) {
      errors.push(`${path} expected maximum ${schema.maximum}`);
    }
    if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) {
      errors.push(`${path} expected > ${schema.exclusiveMinimum}`);
    }
    if (schema.exclusiveMaximum != null && value >= schema.exclusiveMaximum) {
      errors.push(`${path} expected < ${schema.exclusiveMaximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) {
      errors.push(`${path} expected minItems ${schema.minItems}`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateNode(item, schema.items, `${path}[${index}]`, errors));
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in value)) errors.push(`${path} missing required property ${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path} has unexpected property ${key}`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value) validateNode(value[key], childSchema, joinPath(path, key), errors);
    }
  }
}

export function validateAgainstSchema(value, schema, { path = '$' } = {}) {
  const errors = [];
  validateNode(value, schema, path, errors);
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertValidAgainstSchema(value, schema, label = 'value') {
  const result = validateAgainstSchema(value, schema);
  if (!result.ok) {
    throw new Error(`${label} failed schema validation:\n- ${result.errors.join('\n- ')}`);
  }
  return result;
}
