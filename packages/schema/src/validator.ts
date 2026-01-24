/**
 * Schema Validator
 *
 * Runtime validation of data against schema definitions.
 */

import {
  CRDTType,
  type SchemaDefinition,
} from './types.js';
import { parseSchema, type ParsedField, type ParsedSchema } from './parser.js';

/**
 * Validation error details
 */
export interface ValidationIssue {
  /** Path to the invalid field */
  path: string[];
  /** Error message */
  message: string;
  /** The invalid value */
  value: unknown;
  /** Expected type */
  expected: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** List of issues found */
  issues: ValidationIssue[];
}

/**
 * Validate data against a schema
 */
export function validate(
  data: unknown,
  schema: SchemaDefinition | ParsedSchema
): ValidationResult {
  const parsed = 'fields' in schema ? schema : parseSchema(schema);
  const issues: ValidationIssue[] = [];

  if (typeof data !== 'object' || data === null) {
    issues.push({
      path: [],
      message: 'Data must be an object',
      value: data,
      expected: 'object',
    });
    return { valid: false, issues };
  }

  const dataObj = data as Record<string, unknown>;

  // Check each field in the schema
  for (const [fieldName, fieldDef] of parsed.fields) {
    const value = dataObj[fieldName];
    validateField(value, fieldDef, [fieldName], issues);
  }

  // Check for extra fields not in schema (warning, not error)
  for (const key of Object.keys(dataObj)) {
    if (!parsed.fields.has(key)) {
      issues.push({
        path: [key],
        message: `Unknown field "${key}" not defined in schema`,
        value: dataObj[key],
        expected: 'undefined',
      });
    }
  }

  return {
    valid: issues.filter(i => !i.message.includes('Unknown field')).length === 0,
    issues,
  };
}

/**
 * Validate a single field value
 */
function validateField(
  value: unknown,
  field: ParsedField,
  path: string[],
  issues: ValidationIssue[]
): void {
  // Handle undefined/null for optional fields
  if (value === undefined || value === null) {
    if (!field.optional && field.type !== CRDTType.Nullable) {
      issues.push({
        path,
        message: `Required field is missing`,
        value,
        expected: getExpectedType(field),
      });
    }
    return;
  }

  // Type-specific validation
  switch (field.type) {
    case CRDTType.LWWString:
    case CRDTType.PlainText:
      if (typeof value !== 'string') {
        issues.push({
          path,
          message: `Expected string, got ${typeof value}`,
          value,
          expected: 'string',
        });
      }
      break;

    case CRDTType.LWWNumber:
    case CRDTType.GCounter:
    case CRDTType.PNCounter:
      if (typeof value !== 'number') {
        issues.push({
          path,
          message: `Expected number, got ${typeof value}`,
          value,
          expected: 'number',
        });
      }
      break;

    case CRDTType.LWWBoolean:
      if (typeof value !== 'boolean') {
        issues.push({
          path,
          message: `Expected boolean, got ${typeof value}`,
          value,
          expected: 'boolean',
        });
      }
      break;

    case CRDTType.MVString:
      validateArray(value, 'string', path, issues);
      break;

    case CRDTType.MVNumber:
      validateArray(value, 'number', path, issues);
      break;

    case CRDTType.MVBoolean:
      validateArray(value, 'boolean', path, issues);
      break;

    case CRDTType.List:
      validateList(value, field, path, issues);
      break;

    case CRDTType.Set:
      validateSet(value, field, path, issues);
      break;

    case CRDTType.Map:
      validateMap(value, field, path, issues);
      break;

    case CRDTType.Object:
      validateObject(value, field, path, issues);
      break;

    case CRDTType.RichText:
      validateRichText(value, path, issues);
      break;

    case CRDTType.Nullable:
      if (value !== null && field.innerType) {
        validateField(value, field.innerType, path, issues);
      }
      break;

    case CRDTType.Ref:
      if (typeof value !== 'string') {
        issues.push({
          path,
          message: `Reference must be a string (document ID)`,
          value,
          expected: 'string',
        });
      }
      break;

    case CRDTType.LWWAny:
      // Any type accepts anything
      break;
  }
}

function validateArray(
  value: unknown,
  elementType: string,
  path: string[],
  issues: ValidationIssue[]
): void {
  if (!Array.isArray(value)) {
    issues.push({
      path,
      message: `Expected array, got ${typeof value}`,
      value,
      expected: `${elementType}[]`,
    });
    return;
  }

  for (let i = 0; i < value.length; i++) {
    const element = value[i];
    if (typeof element !== elementType) {
      issues.push({
        path: [...path, String(i)],
        message: `Expected ${elementType}, got ${typeof element}`,
        value: element,
        expected: elementType,
      });
    }
  }
}

function validateList(
  value: unknown,
  field: ParsedField,
  path: string[],
  issues: ValidationIssue[]
): void {
  if (!Array.isArray(value)) {
    issues.push({
      path,
      message: `Expected array, got ${typeof value}`,
      value,
      expected: 'array',
    });
    return;
  }

  if (field.elementType) {
    for (let i = 0; i < value.length; i++) {
      validateField(value[i], field.elementType, [...path, String(i)], issues);
    }
  }
}

function validateSet(
  value: unknown,
  field: ParsedField,
  path: string[],
  issues: ValidationIssue[]
): void {
  // Accept both arrays and Sets
  const arr = Array.isArray(value) ? value : value instanceof Set ? Array.from(value) : null;

  if (!arr) {
    issues.push({
      path,
      message: `Expected array or Set, got ${typeof value}`,
      value,
      expected: 'array',
    });
    return;
  }

  if (field.elementType) {
    for (let i = 0; i < arr.length; i++) {
      validateField(arr[i], field.elementType, [...path, String(i)], issues);
    }
  }

  // Check for duplicates
  const seen = new Set();
  for (const item of arr) {
    const key = typeof item === 'object' ? JSON.stringify(item) : item;
    if (seen.has(key)) {
      issues.push({
        path,
        message: `Duplicate value in set: ${JSON.stringify(item)}`,
        value: item,
        expected: 'unique values',
      });
    }
    seen.add(key);
  }
}

function validateMap(
  value: unknown,
  field: ParsedField,
  path: string[],
  issues: ValidationIssue[]
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({
      path,
      message: `Expected object, got ${Array.isArray(value) ? 'array' : typeof value}`,
      value,
      expected: 'object',
    });
    return;
  }

  if (field.valueType) {
    for (const [key, val] of Object.entries(value)) {
      validateField(val, field.valueType, [...path, key], issues);
    }
  }
}

function validateObject(
  value: unknown,
  field: ParsedField,
  path: string[],
  issues: ValidationIssue[]
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({
      path,
      message: `Expected object, got ${Array.isArray(value) ? 'array' : typeof value}`,
      value,
      expected: 'object',
    });
    return;
  }

  if (field.fields) {
    const obj = value as Record<string, unknown>;

    for (const [fieldName, fieldDef] of field.fields) {
      validateField(obj[fieldName], fieldDef, [...path, fieldName], issues);
    }
  }
}

function validateRichText(
  value: unknown,
  path: string[],
  issues: ValidationIssue[]
): void {
  if (typeof value !== 'object' || value === null) {
    issues.push({
      path,
      message: `Expected rich text object, got ${typeof value}`,
      value,
      expected: '{ text: string, spans: Array }',
    });
    return;
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.text !== 'string') {
    issues.push({
      path: [...path, 'text'],
      message: `Expected string, got ${typeof obj.text}`,
      value: obj.text,
      expected: 'string',
    });
  }

  if (!Array.isArray(obj.spans)) {
    issues.push({
      path: [...path, 'spans'],
      message: `Expected array, got ${typeof obj.spans}`,
      value: obj.spans,
      expected: 'array',
    });
  }
}

function getExpectedType(field: ParsedField): string {
  switch (field.type) {
    case CRDTType.LWWString:
    case CRDTType.PlainText:
      return 'string';
    case CRDTType.LWWNumber:
    case CRDTType.GCounter:
    case CRDTType.PNCounter:
      return 'number';
    case CRDTType.LWWBoolean:
      return 'boolean';
    case CRDTType.List:
    case CRDTType.Set:
      return 'array';
    case CRDTType.Map:
    case CRDTType.Object:
      return 'object';
    default:
      return 'unknown';
  }
}

/**
 * Create a validator function for a specific schema
 */
export function createValidator(schema: SchemaDefinition): (data: unknown) => ValidationResult {
  const parsed = parseSchema(schema);
  return (data: unknown) => validate(data, parsed);
}

/**
 * Assert that data matches a schema (throws on failure)
 */
export function assertValid(data: unknown, schema: SchemaDefinition | ParsedSchema): void {
  const result = validate(data, schema);
  if (!result.valid) {
    const messages = result.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Schema validation failed:\n${messages}`);
  }
}

/**
 * Coerce data to match schema (best effort)
 */
export function coerce(
  data: unknown,
  schema: SchemaDefinition | ParsedSchema
): Record<string, unknown> {
  const parsed = 'fields' in schema ? schema : parseSchema(schema);
  const result: Record<string, unknown> = {};

  const dataObj = (typeof data === 'object' && data !== null)
    ? data as Record<string, unknown>
    : {};

  for (const [fieldName, fieldDef] of parsed.fields) {
    result[fieldName] = coerceField(dataObj[fieldName], fieldDef);
  }

  return result;
}

function coerceField(value: unknown, field: ParsedField): unknown {
  if (value === undefined || value === null) {
    if (field.defaultValue !== undefined) {
      return field.defaultValue;
    }
    if (field.optional || field.type === CRDTType.Nullable) {
      return null;
    }
    return getDefaultForType(field);
  }

  switch (field.type) {
    case CRDTType.LWWString:
    case CRDTType.PlainText:
      return String(value);

    case CRDTType.LWWNumber:
    case CRDTType.GCounter:
    case CRDTType.PNCounter:
      return Number(value) || 0;

    case CRDTType.LWWBoolean:
      return Boolean(value);

    case CRDTType.List:
      if (!Array.isArray(value)) return [];
      if (field.elementType) {
        return value.map(v => coerceField(v, field.elementType!));
      }
      return value;

    case CRDTType.Object:
      if (typeof value !== 'object' || value === null) return {};
      if (field.fields) {
        const obj: Record<string, unknown> = {};
        const valueObj = value as Record<string, unknown>;
        for (const [name, subField] of field.fields) {
          obj[name] = coerceField(valueObj[name], subField);
        }
        return obj;
      }
      return value;

    default:
      return value;
  }
}

function getDefaultForType(field: ParsedField): unknown {
  switch (field.type) {
    case CRDTType.LWWString:
    case CRDTType.PlainText:
      return '';
    case CRDTType.LWWNumber:
    case CRDTType.GCounter:
    case CRDTType.PNCounter:
      return 0;
    case CRDTType.LWWBoolean:
      return false;
    case CRDTType.List:
    case CRDTType.Set:
      return [];
    case CRDTType.Map:
    case CRDTType.Object:
      return {};
    default:
      return null;
  }
}
