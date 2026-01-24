/**
 * Schema package tests
 */

import { describe, it, expect } from 'vitest';
import {
  t,
  defineSchema,
  CRDTType,
  parseSchema,
  getDefaultValue,
  generateInterface,
  validate,
  createValidator,
  coerce,
  type InferSchemaType,
} from './index.js';

describe('Schema DSL', () => {
  it('should create LWW register fields', () => {
    const stringField = t.lww.string();
    const numberField = t.lww.number();
    const boolField = t.lww.boolean();

    expect(stringField._type).toBe(CRDTType.LWWString);
    expect(numberField._type).toBe(CRDTType.LWWNumber);
    expect(boolField._type).toBe(CRDTType.LWWBoolean);
  });

  it('should create counter fields', () => {
    const gCounter = t.gCounter();
    const pnCounter = t.pnCounter();

    expect(gCounter._type).toBe(CRDTType.GCounter);
    expect(pnCounter._type).toBe(CRDTType.PNCounter);
  });

  it('should create collection fields', () => {
    const setField = t.set.string();
    const listField = t.list(t.lww.number());
    const mapField = t.map(t.lww.string());

    expect(setField._type).toBe(CRDTType.Set);
    expect(listField._type).toBe(CRDTType.List);
    expect(mapField._type).toBe(CRDTType.Map);
  });

  it('should create nested object fields', () => {
    const objField = t.object({
      name: t.lww.string(),
      age: t.lww.number(),
    });

    expect(objField._type).toBe(CRDTType.Object);
    expect(objField._fields.name._type).toBe(CRDTType.LWWString);
    expect(objField._fields.age._type).toBe(CRDTType.LWWNumber);
  });

  it('should create nullable fields', () => {
    const nullableField = t.nullable(t.lww.string());

    expect(nullableField._type).toBe(CRDTType.Nullable);
    expect(nullableField._optional).toBe(true);
  });
});

describe('defineSchema', () => {
  it('should create a complete schema definition', () => {
    const TaskSchema = defineSchema({
      name: 'Task',
      version: 1,
      types: {
        title: t.lww.string(),
        done: t.lww.boolean(),
        priority: t.pnCounter(),
        tags: t.set.string(),
      },
    });

    expect(TaskSchema.name).toBe('Task');
    expect(TaskSchema.version).toBe(1);
    expect(TaskSchema.types.title._type).toBe(CRDTType.LWWString);
    expect(TaskSchema.types.done._type).toBe(CRDTType.LWWBoolean);
  });

  it('should support complex nested schemas', () => {
    const ProjectSchema = defineSchema({
      name: 'Project',
      version: 1,
      types: {
        name: t.lww.string(),
        tasks: t.list(t.object({
          id: t.lww.string(),
          title: t.lww.string(),
          assignee: t.nullable(t.ref('User')),
        })),
        settings: t.map(t.lww.any()),
      },
    });

    expect(ProjectSchema.types.tasks._type).toBe(CRDTType.List);
    expect(ProjectSchema.types.settings._type).toBe(CRDTType.Map);
  });
});

describe('parseSchema', () => {
  it('should parse a schema into internal representation', () => {
    const schema = defineSchema({
      name: 'Test',
      version: 1,
      types: {
        name: t.lww.string(),
        count: t.pnCounter(),
      },
    });

    const parsed = parseSchema(schema);

    expect(parsed.name).toBe('Test');
    expect(parsed.fields.size).toBe(2);
    expect(parsed.fields.get('name')?.type).toBe(CRDTType.LWWString);
    expect(parsed.fields.get('count')?.type).toBe(CRDTType.PNCounter);
  });

  it('should handle nested object parsing', () => {
    const schema = defineSchema({
      name: 'Nested',
      version: 1,
      types: {
        profile: t.object({
          name: t.lww.string(),
          email: t.lww.string(),
        }),
      },
    });

    const parsed = parseSchema(schema);
    const profileField = parsed.fields.get('profile');

    expect(profileField?.type).toBe(CRDTType.Object);
    expect(profileField?.fields?.get('name')?.type).toBe(CRDTType.LWWString);
  });
});

describe('getDefaultValue', () => {
  it('should return correct defaults for types', () => {
    const schema = defineSchema({
      name: 'Test',
      version: 1,
      types: {
        str: t.lww.string(),
        num: t.lww.number(),
        bool: t.lww.boolean(),
        list: t.list(t.lww.string()),
        counter: t.pnCounter(),
      },
    });

    const parsed = parseSchema(schema);

    expect(getDefaultValue(parsed.fields.get('str')!)).toBe('');
    expect(getDefaultValue(parsed.fields.get('num')!)).toBe(0);
    expect(getDefaultValue(parsed.fields.get('bool')!)).toBe(false);
    expect(getDefaultValue(parsed.fields.get('list')!)).toEqual([]);
    expect(getDefaultValue(parsed.fields.get('counter')!)).toBe(0);
  });
});

describe('generateInterface', () => {
  it('should generate TypeScript interface', () => {
    const schema = defineSchema({
      name: 'User',
      version: 1,
      types: {
        name: t.lww.string(),
        age: t.lww.number(),
        active: t.lww.boolean(),
      },
    });

    const parsed = parseSchema(schema);
    const iface = generateInterface(parsed);

    expect(iface).toContain('export interface UserDocument');
    expect(iface).toContain('name: string');
    expect(iface).toContain('age: number');
    expect(iface).toContain('active: boolean');
  });
});

describe('validate', () => {
  const UserSchema = defineSchema({
    name: 'User',
    version: 1,
    types: {
      name: t.lww.string(),
      age: t.lww.number(),
      active: t.lww.boolean(),
      tags: t.list(t.lww.string()),
    },
  });

  it('should validate correct data', () => {
    const result = validate({
      name: 'Alice',
      age: 30,
      active: true,
      tags: ['admin', 'user'],
    }, UserSchema);

    expect(result.valid).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  it('should reject invalid types', () => {
    const result = validate({
      name: 123, // Should be string
      age: 'thirty', // Should be number
      active: true,
      tags: [],
    }, UserSchema);

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should report missing required fields', () => {
    const result = validate({
      name: 'Alice',
      // age is missing
      // active is missing
      // tags is missing
    }, UserSchema);

    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.path.includes('age'))).toBe(true);
  });
});

describe('createValidator', () => {
  it('should create a reusable validator function', () => {
    const schema = defineSchema({
      name: 'Simple',
      version: 1,
      types: {
        value: t.lww.string(),
      },
    });

    const validator = createValidator(schema);

    expect(validator({ value: 'test' }).valid).toBe(true);
    expect(validator({ value: 123 }).valid).toBe(false);
  });
});

describe('coerce', () => {
  it('should coerce data to match schema', () => {
    const schema = defineSchema({
      name: 'Test',
      version: 1,
      types: {
        name: t.lww.string(),
        count: t.lww.number(),
        items: t.list(t.lww.string()),
      },
    });

    const result = coerce({
      name: 123, // Will be coerced to '123'
      count: '42', // Will be coerced to 42
      // items missing - will default to []
    }, schema);

    expect(result.name).toBe('123');
    expect(result.count).toBe(42);
    expect(result.items).toEqual([]);
  });
});

describe('Type inference', () => {
  it('should correctly infer types from schema', () => {
    const schema = defineSchema({
      name: 'TypedSchema',
      version: 1,
      types: {
        title: t.lww.string(),
        count: t.lww.number(),
        items: t.list(t.object({
          id: t.lww.string(),
          value: t.lww.number(),
        })),
      },
    });

    // This is a compile-time test - if it compiles, types are correct
    type SchemaType = InferSchemaType<typeof schema>;

    // These assertions verify the inferred type structure
    const _testData: SchemaType = {
      title: 'Test',
      count: 42,
      items: [{ id: '1', value: 100 }],
    };

    expect(_testData.title).toBe('Test');
  });
});
