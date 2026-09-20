import { describe, expect, it } from 'vitest'
import { toTypeBox, toTypeBoxParameters } from '../src/schema.ts'

describe('toTypeBox (JSON Schema → typebox)', () => {
  it('maps scalars with descriptions', () => {
    expect(toTypeBox({ type: 'string', description: 'q' })).toMatchObject({ type: 'string', description: 'q' })
    expect(toTypeBox({ type: 'number' })).toMatchObject({ type: 'number' })
    expect(toTypeBox({ type: 'integer' })).toMatchObject({ type: 'integer' })
    expect(toTypeBox({ type: 'boolean' })).toMatchObject({ type: 'boolean' })
    expect(toTypeBox({ type: 'null' })).toMatchObject({ type: 'null' })
  })

  it('maps numeric bounds', () => {
    expect(toTypeBox({ type: 'integer', minimum: 1, maximum: 100 })).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 100,
    })
    expect(toTypeBox({ type: 'number', minimum: 0.5 })).toMatchObject({ type: 'number', minimum: 0.5 })
  })

  it('maps enums to literal unions (single enum → literal)', () => {
    const union = toTypeBox({ type: 'string', enum: ['search', 'fetch', 'all'] }) as {
      anyOf?: Array<{ const?: unknown }>
    }
    // typebox 1.x unions surface as `anyOf` of const-literals.
    expect(union.anyOf).toHaveLength(3)
    expect(union.anyOf?.map(b => b.const)).toEqual(['search', 'fetch', 'all'])

    const single = toTypeBox({ type: 'string', enum: ['only'] })
    expect(single).toMatchObject({ type: 'string', const: 'only' })
  })

  it('maps arrays with item schemas and bounds', () => {
    const arr = toTypeBox({ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 }) as {
      type: string
      items: unknown
      minItems?: number
      maxItems?: number
    }
    expect(arr.type).toBe('array')
    expect(arr.minItems).toBe(1)
    expect(arr.maxItems).toBe(5)
  })

  it('maps objects with explicit openness', () => {
    const open = toTypeBox({ type: 'object', properties: { a: { type: 'string' } } }) as {
      additionalProperties: boolean
    }
    expect(open.additionalProperties).toBe(true)
    const closed = toTypeBox({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    }) as { additionalProperties: boolean }
    expect(closed.additionalProperties).toBe(false)
  })

  it('maps oneOf to a typebox union (min two branches)', () => {
    const node = toTypeBox({ oneOf: [{ type: 'string' }, { type: 'number' }] })
    expect(JSON.stringify(node)).toContain('anyOf')
    expect(() => toTypeBox({ oneOf: [{ type: 'string' }] })).toThrow(/at least two branches/)
  })

  it('throws on unsupported types and non-object roots', () => {
    expect(() => toTypeBox({ type: 'date' as string })).toThrow(/unsupported JSON Schema type/)
    expect(() => toTypeBoxParameters({ type: 'string' })).toThrow(/object-rooted/)
  })

  it('converts a real object-root schema with required marking', () => {
    const schema = toTypeBoxParameters({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        maxResults: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['query'],
    }) as {
      required?: string[]
      properties: Record<string, { optional?: boolean; type?: string }>
    }
    // typebox marks optionality by omission from `required` (no flag).
    expect(schema.required).toEqual(['query'])
    expect(schema.properties?.query).toMatchObject({ type: 'string' })
    expect(schema.properties?.maxResults).toMatchObject({ type: 'integer', minimum: 1, maximum: 10 })
    expect(schema.required).not.toContain('maxResults')
  })
})
