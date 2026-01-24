/**
 * @syncforge/schema
 *
 * Declarative schema system with TypeScript inference
 */

// Type DSL
export {
  t,
  defineSchema,
  CRDTType,
  type SchemaField,
  type SchemaDefinition,
  type SchemaMigration,
  type InferType,
  type InferObjectType,
  type InferSchemaType,
  // Individual field types
  type LWWStringField,
  type LWWNumberField,
  type LWWBooleanField,
  type LWWAnyField,
  type MVStringField,
  type MVNumberField,
  type MVBooleanField,
  type GCounterField,
  type PNCounterField,
  type SetField,
  type MapField,
  type ListField,
  type ObjectField,
  type PlainTextField,
  type RichTextField,
  type RichTextValue,
  type RefField,
  type NullableField,
} from './types.js';

// Parser
export {
  parseSchema,
  getDefaultValue,
  generateTypeString,
  generateInterface,
  SchemaRegistry,
  type ParsedField,
  type ParsedSchema,
  type ValidationResult as ParserValidationResult,
  type ValidationError as ParserValidationError,
} from './parser.js';

// Validator
export {
  validate,
  createValidator,
  assertValid,
  coerce,
  type ValidationIssue,
  type ValidationResult,
} from './validator.js';
