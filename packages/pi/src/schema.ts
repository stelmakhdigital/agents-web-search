/**
 * JSON Schema (core `ToolSpec.parameters`, draft 2020-12 subset) → typebox
 * schema (`pi.registerTool` `parameters`).
 *
 * ADR-002: JSON Schema is the neutral schema format; the adapter performs the
 * host projection. typebox is a JSON-Schema dialect, so most keywords map
 * directly (type/enum/description/items/properties/additionalProperties/
 * oneOf/minimum/maximum/minItems/maxItems); unsupported keywords (pattern,
 * default, format, …) are dropped — the core re-validates arguments at
 * execution time (double validation, accepted cost of neutrality).
 *
 * @module @agents-web-search/pi/schema
 */

import { Type, type TSchema } from 'typebox'

/** A JSON-Schema value node (structural; the core owns the real types). */
interface JsonSchemaNode {
  readonly type?: string
  readonly description?: string
  readonly enum?: readonly (string | number | boolean)[]
  readonly minimum?: number
  readonly maximum?: number
  readonly minItems?: number
  readonly maxItems?: number
  readonly items?: JsonSchemaNode
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>
  readonly additionalProperties?: boolean
  readonly oneOf?: readonly JsonSchemaNode[]
  readonly required?: readonly string[]
  readonly [keyword: string]: unknown
}

/**
 * Convert a JSON-Schema value node to a typebox schema. Throws on an
 * unsupported `type` (authoring bug, not runtime data).
 * @param node - the JSON-Schema node.
 * @returns the typebox schema.
 */
export function toTypeBox(node: JsonSchemaNode): TSchema {
  const description = node.description
  const desc = (modifier: Record<string, unknown>): Record<string, unknown> =>
    description !== undefined ? { ...modifier, description } : modifier

  if (node.enum !== undefined) {
    const literals = node.enum.map(value => Type.Literal(value))
    return literals.length >= 2
      ? Type.Union(literals, desc({}))
      : Type.Literal(node.enum[0] as string | number | boolean)
  }

  switch (node.type) {
    case 'string':
      return Type.String(desc({}))
    case 'number':
      return Type.Number(desc({
        ...(node.minimum !== undefined ? { minimum: node.minimum } : {}),
        ...(node.maximum !== undefined ? { maximum: node.maximum } : {}),
      }))
    case 'integer':
      return Type.Integer(desc({
        ...(node.minimum !== undefined ? { minimum: node.minimum } : {}),
        ...(node.maximum !== undefined ? { maximum: node.maximum } : {}),
      }))
    case 'boolean':
      return Type.Boolean(desc({}))
    case 'null':
      return Type.Null(desc({}))
    case 'array':
      return Type.Array(
        node.items !== undefined ? toTypeBox(node.items) : Type.Any(desc({})),
        desc({
          ...(node.minItems !== undefined ? { minItems: node.minItems } : {}),
          ...(node.maxItems !== undefined ? { maxItems: node.maxItems } : {}),
        }),
      )
    case 'object':
      return toTypeBoxObject(node)
    default:
      if (node.oneOf !== undefined) {
        const branches = node.oneOf.map(branch => toTypeBox(branch))
        if (branches.length < 2) {
          throw new Error('pi adapter: oneOf requires at least two branches in tool parameters')
        }
        return Type.Union(branches as [TSchema, TSchema, ...TSchema[]], desc({}))
      }
      throw new Error(`pi adapter: unsupported JSON Schema type ${String(node.type)} in tool parameters`)
  }
}

/** Convert an object node (root or nested) to `Type.Object`. */
function toTypeBoxObject(node: JsonSchemaNode): TSchema {
  const required = new Set(node.required ?? [])
  const properties = node.properties ?? {}
  const shape: Record<string, TSchema> = {}
  for (const [name, prop] of Object.entries(properties)) {
    const converted = toTypeBox(prop)
    shape[name] = required.has(name) ? converted : Type.Optional(converted)
  }
  return Type.Object(shape, {
    additionalProperties: node.additionalProperties === false ? false : true,
    ...(node.description !== undefined ? { description: node.description } : {}),
  })
}

/**
 * Convert a core `ToolSpec.parameters` JSON Schema (object root) to a
 * typebox object schema for `pi.registerTool`.
 * @param schema - the tool's JSON-Schema parameter definition.
 * @returns the typebox schema.
 */
export function toTypeBoxParameters(schema: JsonSchemaNode): TSchema {
  if (schema.type !== undefined && schema.type !== 'object') {
    throw new Error('pi adapter: tool parameters must be an object-rooted JSON Schema')
  }
  return toTypeBoxObject(schema)
}
