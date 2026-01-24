/**
 * Schema Parser
 *
 * Parses schema definitions and generates internal representations
 * for document creation, validation, and serialization.
 */

import {
  CRDTType,
  type SchemaDefinition,
  type SchemaField,
  type ObjectField,
  type ListField,
  type SetField,
  type MapField,
  type NullableField,
  type RefField,
} from './types.js';

/**
 * Parsed field information
 */
export interface ParsedField {
  /** Field name */
  name: string;
  /** CRDT type */
  type: CRDTType;
  /** Is this field optional/nullable? */
  optional: boolean;
  /** Default value */
  defaultValue?: unknown;
  /** For collections: element type info */
  elementType?: ParsedField;
  /** For maps: value type info */
  valueType?: ParsedField;
  /** For objects: nested fields */
  fields?: Map<string, ParsedField>;
  /** For refs: target schema name */
  refSchema?: string;
  /** For nullable: inner type info */
  innerType?: ParsedField;
}

/**
 * Parsed schema representation
 */
export interface ParsedSchema {
  /** Schema name */
  name: string;
  /** Schema version */
  version: number;
  /** Parsed fields */
  fields: Map<string, ParsedField>;
  /** Original definition */
  original: SchemaDefinition;
}

/**
 * Parse a schema definition into an internal representation
 */
export function parseSchema(schema: SchemaDefinition): ParsedSchema {
  const fields = new Map<string, ParsedField>();

  for (const [name, field] of Object.entries(schema.types)) {
    fields.set(name, parseField(name, field));
  }

  return {
    name: schema.name,
    version: schema.version,
    fields,
    original: schema,
  };
}

/**
 * Parse a single field
 */
function parseField(name: string, field: SchemaField): ParsedField {
  const base: ParsedField = {
    name,
    type: field._type,
    optional: field._optional,
    defaultValue: field._default,
  };

  switch (field._type) {
    case CRDTType.Object:
      return parseObjectField(name, field as ObjectField<Record<string, SchemaField>>);

    case CRDTType.List:
      return parseListField(name, field as ListField<unknown>);

    case CRDTType.Set:
      return parseSetField(name, field as SetField<unknown>);

    case CRDTType.Map:
      return parseMapField(name, field as MapField<string, unknown>);

    case CRDTType.Nullable:
      return parseNullableField(name, field as NullableField<SchemaField>);

    case CRDTType.Ref:
      return {
        ...base,
        refSchema: (field as RefField<string>)._refSchema,
      };

    default:
      return base;
  }
}

function parseObjectField(
  name: string,
  field: ObjectField<Record<string, SchemaField>>
): ParsedField {
  const nestedFields = new Map<string, ParsedField>();

  for (const [fieldName, fieldDef] of Object.entries(field._fields)) {
    nestedFields.set(fieldName, parseField(fieldName, fieldDef));
  }

  return {
    name,
    type: CRDTType.Object,
    optional: field._optional,
    fields: nestedFields,
  };
}

function parseListField(name: string, field: ListField<unknown>): ParsedField {
  return {
    name,
    type: CRDTType.List,
    optional: field._optional,
    elementType: parseField('element', field._elementType),
  };
}

function parseSetField(name: string, field: SetField<unknown>): ParsedField {
  return {
    name,
    type: CRDTType.Set,
    optional: field._optional,
    elementType: parseField('element', field._elementType),
  };
}

function parseMapField(name: string, field: MapField<string, unknown>): ParsedField {
  return {
    name,
    type: CRDTType.Map,
    optional: field._optional,
    valueType: parseField('value', field._valueType),
  };
}

function parseNullableField(name: string, field: NullableField<SchemaField>): ParsedField {
  return {
    name,
    type: CRDTType.Nullable,
    optional: true,
    innerType: parseField('inner', field._innerType),
  };
}

/**
 * Get the default value for a field based on its type
 */
export function getDefaultValue(field: ParsedField): unknown {
  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }

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

    case CRDTType.MVString:
    case CRDTType.MVNumber:
    case CRDTType.MVBoolean:
    case CRDTType.List:
    case CRDTType.Set:
      return [];

    case CRDTType.Map:
    case CRDTType.Object:
      if (field.fields) {
        const obj: Record<string, unknown> = {};
        for (const [name, subField] of field.fields) {
          obj[name] = getDefaultValue(subField);
        }
        return obj;
      }
      return {};

    case CRDTType.RichText:
      return { text: '', spans: [] };

    case CRDTType.Nullable:
      return null;

    case CRDTType.Ref:
      return null;

    default:
      return undefined;
  }
}

/**
 * Generate a TypeScript type string for a field (for codegen)
 */
export function generateTypeString(field: ParsedField): string {
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

    case CRDTType.LWWAny:
      return 'unknown';

    case CRDTType.MVString:
      return 'string[]';

    case CRDTType.MVNumber:
      return 'number[]';

    case CRDTType.MVBoolean:
      return 'boolean[]';

    case CRDTType.List:
      if (field.elementType) {
        return `${generateTypeString(field.elementType)}[]`;
      }
      return 'unknown[]';

    case CRDTType.Set:
      if (field.elementType) {
        return `${generateTypeString(field.elementType)}[]`;
      }
      return 'unknown[]';

    case CRDTType.Map:
      if (field.valueType) {
        return `Record<string, ${generateTypeString(field.valueType)}>`;
      }
      return 'Record<string, unknown>';

    case CRDTType.Object:
      if (field.fields) {
        const props = Array.from(field.fields.entries())
          .map(([name, f]) => {
            const optional = f.optional ? '?' : '';
            return `${name}${optional}: ${generateTypeString(f)}`;
          })
          .join('; ');
        return `{ ${props} }`;
      }
      return '{}';

    case CRDTType.RichText:
      return '{ text: string; spans: Array<{ text: string; format: Record<string, unknown> }> }';

    case CRDTType.Nullable:
      if (field.innerType) {
        return `${generateTypeString(field.innerType)} | null`;
      }
      return 'unknown | null';

    case CRDTType.Ref:
      return 'string';

    default:
      return 'unknown';
  }
}

/**
 * Generate TypeScript interface for a schema
 */
export function generateInterface(schema: ParsedSchema): string {
  const lines: string[] = [];

  lines.push(`export interface ${schema.name}Document {`);

  for (const [name, field] of schema.fields) {
    const optional = field.optional ? '?' : '';
    const typeStr = generateTypeString(field);
    lines.push(`  ${name}${optional}: ${typeStr};`);
  }

  lines.push('}');

  return lines.join('\n');
}

/**
 * Schema registry for managing multiple schemas
 */
export class SchemaRegistry {
  private schemas: Map<string, ParsedSchema> = new Map();

  /**
   * Register a schema
   */
  register(schema: SchemaDefinition): ParsedSchema {
    const parsed = parseSchema(schema);
    this.schemas.set(schema.name, parsed);
    return parsed;
  }

  /**
   * Get a registered schema by name
   */
  get(name: string): ParsedSchema | undefined {
    return this.schemas.get(name);
  }

  /**
   * Check if a schema is registered
   */
  has(name: string): boolean {
    return this.schemas.has(name);
  }

  /**
   * Get all registered schema names
   */
  getNames(): string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * Validate references between schemas
   */
  validateRefs(): ValidationResult {
    const errors: ValidationError[] = [];

    for (const [schemaName, schema] of this.schemas) {
      this.validateFieldRefs(schemaName, schema.fields, errors);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private validateFieldRefs(
    schemaName: string,
    fields: Map<string, ParsedField>,
    errors: ValidationError[]
  ): void {
    for (const [fieldName, field] of fields) {
      if (field.type === CRDTType.Ref && field.refSchema) {
        if (!this.schemas.has(field.refSchema)) {
          errors.push({
            schema: schemaName,
            field: fieldName,
            message: `Reference to unknown schema: ${field.refSchema}`,
          });
        }
      }

      if (field.fields) {
        this.validateFieldRefs(schemaName, field.fields, errors);
      }

      if (field.elementType) {
        this.validateFieldRefs(schemaName, new Map([['element', field.elementType]]), errors);
      }

      if (field.valueType) {
        this.validateFieldRefs(schemaName, new Map([['value', field.valueType]]), errors);
      }

      if (field.innerType) {
        this.validateFieldRefs(schemaName, new Map([['inner', field.innerType]]), errors);
      }
    }
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  schema: string;
  field: string;
  message: string;
}
