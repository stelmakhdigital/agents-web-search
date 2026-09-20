/**
 * JSON Schema (core `ToolSpec.parameters`, draft 2020-12 subset) → DSH
 * `ParameterSchemaSpec` (the `defineTool` property-map schema language).
 *
 * ADR-002: JSON Schema is the neutral schema format; the adapter performs the
 * host projection. DSH's property-map language is a strict JSON-Schema subset
 * (type/enum/const/description/items/properties/additionalProperties/oneOf),
 * so unsupported keywords (minimum, maximum, minItems, maxItems, pattern,
 * default, …) are dropped here — the core re-validates arguments at execution
 * time (double validation, accepted cost of neutrality, ADR-002 §6).
 * @module @agents-web-search/dsh/schema
 */

import type {
  ParameterPropertySpec,
  ParameterSchemaSpec,
  ValueSchemaSpec,
} from '@deepseek-ai/dsh-tools'

/** A property-map schema node as accepted by DSH `defineTool` (host type). */
export type DshValueSchema = ValueSchemaSpec

/** One parameter property (optional `required: true` marks the root-required). */
export type DshPropertySchema = ParameterPropertySpec

/** The root parameter map handed to `defineTool`. */
export type DshParameterSchema = ParameterSchemaSpec

/** Minimal JSON-Schema node shape (structural; the core owns the real types). */
interface JsonSchemaNode {
  readonly type?: string
  readonly description?: string
  readonly enum?: readonly (string | number | boolean)[]
  readonly items?: JsonSchemaNode
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>
  readonly additionalProperties?: boolean
  readonly oneOf?: readonly JsonSchemaNode[]
  readonly required?: readonly string[]
  /** Other JSON-Schema keywords (dropped by the projection). */
  readonly [keyword: string]: unknown
}

/**
 * Convert a JSON-Schema value node to a DSH value schema. Unsupported
 * keywords are dropped (the core re-validates). Throws on an unsupported
 * `type` (authoring bug, not runtime data).
 * @param node - the JSON-Schema node.
 * @returns the DSH value schema.
 */
export function toDshValueSchema(node: JsonSchemaNode): DshValueSchema {
  const description = node.description
  switch (node.type) {
    case 'string': {
      const enumValues = node.enum !== undefined ? (node.enum as readonly string[]) : undefined
      return {
        type: 'string',
        ...(enumValues !== undefined ? { enum: enumValues } : {}),
        ...(description !== undefined ? { description } : {}),
      }
    }
    case 'number':
    case 'integer':
      return { type: node.type, ...(description !== undefined ? { description } : {}) }
    case 'boolean':
      return { type: 'boolean', ...(description !== undefined ? { description } : {}) }
    case 'null':
      return { type: 'null', ...(description !== undefined ? { description } : {}) }
    case 'array':
      return {
        type: 'array',
        ...(node.items !== undefined ? { items: toDshValueSchema(node.items) } : {}),
        ...(description !== undefined ? { description } : {}),
      }
    case 'object':
      return {
        type: 'object',
        ...(node.properties !== undefined ? { properties: toDshPropertySchema(node) } : {}),
        // DSH requires an explicit openness flag; JSON Schema defaults to open.
        additionalProperties: node.additionalProperties === false ? false : true,
        ...(description !== undefined ? { description } : {}),
      }
    default:
      if (node.oneOf !== undefined) {
        const branches = node.oneOf.map(oneOf => toDshValueSchema(oneOf))
        if (branches.length < 2) {
          throw new Error('dsh adapter: oneOf requires at least two branches in tool parameters')
        }
        return {
          oneOf: [branches[0] as DshValueSchema, branches[1] as DshValueSchema, ...branches.slice(2)],
          ...(description !== undefined ? { description } : {}),
        }
      }
      throw new Error(`dsh adapter: unsupported JSON Schema type ${String(node.type)} in tool parameters`)
  }
}

/** Convert the properties of an object-root schema to a DSH property map. */
function toDshPropertySchema(objectNode: JsonSchemaNode): DshParameterSchema {
  const required = new Set(objectNode.required ?? [])
  const properties = objectNode.properties ?? {}
  const out: DshParameterSchema = {}
  for (const [name, prop] of Object.entries(properties)) {
    const converted = toDshValueSchema(prop)
    out[name] = required.has(name) ? { ...converted, required: true } : converted
  }
  return out
}

/**
 * Convert a core `ToolSpec.parameters` JSON Schema (object root) to the DSH
 * `defineTool` `parameters` map.
 * @param schema - the tool's JSON-Schema parameter definition.
 * @returns the DSH parameter map.
 */
export function toDshParameterSchema(schema: JsonSchemaNode): DshParameterSchema {
  if (schema.type !== undefined && schema.type !== 'object') {
    throw new Error('dsh adapter: tool parameters must be an object-rooted JSON Schema')
  }
  return toDshPropertySchema(schema)
}
