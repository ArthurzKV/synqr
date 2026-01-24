/**
 * Schema Type DSL
 *
 * Provides a declarative way to define document schemas with full TypeScript inference.
 * Usage: t.lww.string(), t.list(t.object({ ... })), etc.
 */

/**
 * Base type for all schema field definitions
 */
export interface SchemaField<T = unknown> {
  /** The CRDT type to use */
  readonly _type: CRDTType;
  /** The TypeScript type (phantom type for inference) */
  readonly _tsType: T;
  /** Whether this field is optional */
  readonly _optional: boolean;
  /** Default value (if any) */
  readonly _default?: T | undefined;
}

/**
 * Supported CRDT types
 */
export enum CRDTType {
  // Registers
  LWWString = 'lww.string',
  LWWNumber = 'lww.number',
  LWWBoolean = 'lww.boolean',
  LWWAny = 'lww.any',
  MVString = 'mv.string',
  MVNumber = 'mv.number',
  MVBoolean = 'mv.boolean',

  // Counters
  GCounter = 'g-counter',
  PNCounter = 'pn-counter',

  // Collections
  Set = 'set',
  Map = 'map',
  List = 'list',
  Object = 'object',

  // Text
  PlainText = 'plain-text',
  RichText = 'rich-text',

  // Special
  Ref = 'ref',
  Nullable = 'nullable',
}

// ============================================
// LWW Register Types
// ============================================

export interface LWWStringField extends SchemaField<string> {
  readonly _type: CRDTType.LWWString;
}

export interface LWWNumberField extends SchemaField<number> {
  readonly _type: CRDTType.LWWNumber;
}

export interface LWWBooleanField extends SchemaField<boolean> {
  readonly _type: CRDTType.LWWBoolean;
}

export interface LWWAnyField<T = unknown> extends SchemaField<T> {
  readonly _type: CRDTType.LWWAny;
}

// ============================================
// MV Register Types
// ============================================

export interface MVStringField extends SchemaField<string[]> {
  readonly _type: CRDTType.MVString;
}

export interface MVNumberField extends SchemaField<number[]> {
  readonly _type: CRDTType.MVNumber;
}

export interface MVBooleanField extends SchemaField<boolean[]> {
  readonly _type: CRDTType.MVBoolean;
}

// ============================================
// Counter Types
// ============================================

export interface GCounterField extends SchemaField<number> {
  readonly _type: CRDTType.GCounter;
}

export interface PNCounterField extends SchemaField<number> {
  readonly _type: CRDTType.PNCounter;
}

// ============================================
// Collection Types
// ============================================

export interface SetField<T> extends SchemaField<T[]> {
  readonly _type: CRDTType.Set;
  readonly _elementType: SchemaField<T>;
}

export interface MapField<K extends string, V> extends SchemaField<Record<K, V>> {
  readonly _type: CRDTType.Map;
  readonly _keyType: K;
  readonly _valueType: SchemaField<V>;
}

export interface ListField<T> extends SchemaField<T[]> {
  readonly _type: CRDTType.List;
  readonly _elementType: SchemaField<T>;
}

export interface ObjectField<T extends Record<string, SchemaField>> extends SchemaField<InferObjectType<T>> {
  readonly _type: CRDTType.Object;
  readonly _fields: T;
}

// ============================================
// Text Types
// ============================================

export interface PlainTextField extends SchemaField<string> {
  readonly _type: CRDTType.PlainText;
}

export interface RichTextField extends SchemaField<RichTextValue> {
  readonly _type: CRDTType.RichText;
}

export interface RichTextValue {
  text: string;
  spans: Array<{ text: string; format: Record<string, unknown> }>;
}

// ============================================
// Special Types
// ============================================

export interface RefField<T extends string> extends SchemaField<string> {
  readonly _type: CRDTType.Ref;
  readonly _refSchema: T;
}

export interface NullableField<T extends SchemaField> extends SchemaField<InferType<T> | null> {
  readonly _type: CRDTType.Nullable;
  readonly _innerType: T;
}

// ============================================
// Type Inference Utilities
// ============================================

/**
 * Infer the TypeScript type from a SchemaField
 */
export type InferType<T extends SchemaField> =
  T extends SchemaField<infer U> ? U : never;

/**
 * Infer types from an object schema
 */
export type InferObjectType<T extends Record<string, SchemaField>> = {
  [K in keyof T]: InferType<T[K]>;
};

/**
 * Infer the full document type from a schema definition
 */
export type InferSchemaType<T extends SchemaDefinition> = InferObjectType<T['types']>;

// ============================================
// Schema Definition
// ============================================

/**
 * A complete schema definition
 */
export interface SchemaDefinition<
  T extends Record<string, SchemaField> = Record<string, SchemaField>
> {
  /** Schema name (used for identification) */
  readonly name: string;
  /** Schema version (for migrations) */
  readonly version: number;
  /** Field definitions */
  readonly types: T;
  /** Optional migration functions */
  readonly migrations?: SchemaMigration[];
}

/**
 * Migration between schema versions
 */
export interface SchemaMigration {
  /** From version */
  from: number;
  /** To version */
  to: number;
  /** Migration function */
  migrate: (data: unknown) => unknown;
}

// ============================================
// Type Builder (DSL)
// ============================================

/**
 * LWW Register builders
 */
const lww = {
  string: (defaultValue?: string): LWWStringField => ({
    _type: CRDTType.LWWString,
    _tsType: '' as string,
    _optional: false,
    _default: defaultValue,
  }),

  number: (defaultValue?: number): LWWNumberField => ({
    _type: CRDTType.LWWNumber,
    _tsType: 0 as number,
    _optional: false,
    _default: defaultValue,
  }),

  boolean: (defaultValue?: boolean): LWWBooleanField => ({
    _type: CRDTType.LWWBoolean,
    _tsType: false as boolean,
    _optional: false,
    _default: defaultValue,
  }),

  any: <T = unknown>(defaultValue?: T): LWWAnyField<T> => ({
    _type: CRDTType.LWWAny,
    _tsType: undefined as unknown as T,
    _optional: false,
    _default: defaultValue,
  }),
};

/**
 * MV Register builders
 */
const mv = {
  string: (): MVStringField => ({
    _type: CRDTType.MVString,
    _tsType: [] as string[],
    _optional: false,
  }),

  number: (): MVNumberField => ({
    _type: CRDTType.MVNumber,
    _tsType: [] as number[],
    _optional: false,
  }),

  boolean: (): MVBooleanField => ({
    _type: CRDTType.MVBoolean,
    _tsType: [] as boolean[],
    _optional: false,
  }),
};

/**
 * Set builders with element type shortcuts
 */
const set = {
  string: (): SetField<string> => ({
    _type: CRDTType.Set,
    _tsType: [] as string[],
    _optional: false,
    _elementType: lww.string(),
  }),

  number: (): SetField<number> => ({
    _type: CRDTType.Set,
    _tsType: [] as number[],
    _optional: false,
    _elementType: lww.number(),
  }),

  of: <T extends SchemaField>(elementType: T): SetField<InferType<T>> => ({
    _type: CRDTType.Set,
    _tsType: [] as InferType<T>[],
    _optional: false,
    _elementType: elementType as SchemaField<InferType<T>>,
  }),
};

/**
 * Main type builder object
 */
export const t = {
  // LWW Registers
  lww,

  // MV Registers
  mv,

  // Counters
  gCounter: (): GCounterField => ({
    _type: CRDTType.GCounter,
    _tsType: 0 as number,
    _optional: false,
    _default: 0,
  }),

  pnCounter: (defaultValue: number = 0): PNCounterField => ({
    _type: CRDTType.PNCounter,
    _tsType: 0 as number,
    _optional: false,
    _default: defaultValue,
  }),

  // Sets
  set,

  // Map
  map: <V extends SchemaField>(valueType: V): MapField<string, InferType<V>> => ({
    _type: CRDTType.Map,
    _tsType: {} as Record<string, InferType<V>>,
    _optional: false,
    _keyType: '' as string,
    _valueType: valueType as SchemaField<InferType<V>>,
  }),

  // List
  list: <T extends SchemaField>(elementType: T): ListField<InferType<T>> => ({
    _type: CRDTType.List,
    _tsType: [] as InferType<T>[],
    _optional: false,
    _elementType: elementType as SchemaField<InferType<T>>,
  }),

  // Object (nested structure)
  object: <T extends Record<string, SchemaField>>(fields: T): ObjectField<T> => ({
    _type: CRDTType.Object,
    _tsType: {} as InferObjectType<T>,
    _optional: false,
    _fields: fields,
  }),

  // Text
  plainText: (): PlainTextField => ({
    _type: CRDTType.PlainText,
    _tsType: '' as string,
    _optional: false,
  }),

  richText: (): RichTextField => ({
    _type: CRDTType.RichText,
    _tsType: { text: '', spans: [] } as RichTextValue,
    _optional: false,
  }),

  // Reference to another document
  ref: <T extends string>(schemaName: T): RefField<T> => ({
    _type: CRDTType.Ref,
    _tsType: '' as string,
    _optional: false,
    _refSchema: schemaName,
  }),

  // Nullable wrapper
  nullable: <T extends SchemaField>(innerType: T): NullableField<T> => ({
    _type: CRDTType.Nullable,
    _tsType: null as InferType<T> | null,
    _optional: true,
    _innerType: innerType,
  }),

  // Optional (alias for nullable)
  optional: <T extends SchemaField>(innerType: T): NullableField<T> => ({
    _type: CRDTType.Nullable,
    _tsType: null as InferType<T> | null,
    _optional: true,
    _innerType: innerType,
  }),
};

/**
 * Define a schema with full type inference
 */
export function defineSchema<T extends Record<string, SchemaField>>(
  definition: Omit<SchemaDefinition<T>, 'types'> & { types: T }
): SchemaDefinition<T> {
  return definition;
}
