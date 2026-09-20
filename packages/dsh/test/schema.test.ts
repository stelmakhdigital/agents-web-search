import { describe, expect, it } from 'vitest'
import { toDshParameterSchema, toDshValueSchema } from '../src/schema.ts'

describe('toDshValueSchema (JSON Schema → DSH)', () => {
  it('maps scalar types with descriptions', () => {
    expect(toDshValueSchema({ type: 'string', description: 'q' })).toEqual({ type: 'string', description: 'q' })
    expect(toDshValueSchema({ type: 'integer', description: 'n' })).toEqual({ type: 'integer', description: 'n' })
    expect(toDshValueSchema({ type: 'number' })).toEqual({ type: 'number' })
    expect(toDshValueSchema({ type: 'boolean' })).toEqual({ type: 'boolean' })
  })

  it('maps enums on string types', () => {
    expect(toDshValueSchema({ type: 'string', enum: ['day', 'week'] })).toEqual({
      type: 'string',
      enum: ['day', 'week'],
    })
  })

  it('maps arrays with items and drops numeric bounds', () => {
    expect(
      toDshValueSchema({
        type: 'array',
        description: 'queries',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 4,
      }),
    ).toEqual({ type: 'array', description: 'queries', items: { type: 'string' } })
  })

  it('maps nested objects with explicit additionalProperties', () => {
    expect(
      toDshValueSchema({
        type: 'object',
        properties: { inner: { type: 'boolean' } },
        additionalProperties: false,
      }),
    ).toEqual({ type: 'object', properties: { inner: { type: 'boolean' } }, additionalProperties: false })
    // JSON Schema omits additionalProperties by default (open) → DSH needs true.
    expect(toDshValueSchema({ type: 'object', properties: {} })).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: true,
    })
  })

  it('maps oneOf branches', () => {
    expect(toDshValueSchema({ oneOf: [{ type: 'string' }, { type: 'null' }], description: 'x' })).toEqual({
      oneOf: [{ type: 'string' }, { type: 'null' }],
      description: 'x',
    })
  })

  it('throws on an unsupported type', () => {
    expect(() => toDshValueSchema({ type: 'any' })).toThrow(/unsupported JSON Schema type/)
  })
})

describe('toDshParameterSchema (object root)', () => {
  it('converts properties and marks required ones', () => {
    const converted = toDshParameterSchema({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The query.' },
        limit: { type: 'integer', description: 'Max results.' },
      },
      required: ['query'],
      additionalProperties: false,
    })
    expect(converted).toEqual({
      query: { type: 'string', description: 'The query.', required: true },
      limit: { type: 'integer', description: 'Max results.' },
    })
  })

  it('handles an empty schema', () => {
    expect(toDshParameterSchema({})).toEqual({})
    expect(toDshParameterSchema({ type: 'object' })).toEqual({})
  })

  it('rejects a non-object root', () => {
    expect(() => toDshParameterSchema({ type: 'string' })).toThrow(/object-rooted/)
  })

  it('drops unsupported keywords (double validation is in the core)', () => {
    const converted = toDshParameterSchema({
      type: 'object',
      properties: {
        n: { type: 'integer', minimum: 1, maximum: 20, default: 5, pattern: '^x$' },
      },
    })
    expect(converted).toEqual({ n: { type: 'integer' } })
  })
})
