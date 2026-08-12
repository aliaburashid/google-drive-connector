/**
 * Convert connector JSON Schema objects into Zod object schemas for MCP discovery.
 *
 * This is schema mirroring for MCP SDK registration only. Business validation,
 * approval enforcement, and provider rules remain in connector.execute().
 */

import { z, type ZodTypeAny } from "zod";

function propToZod(prop: Record<string, unknown>): ZodTypeAny {
  if (Array.isArray(prop.enum) && prop.enum.every((value) => typeof value === "string")) {
    const values = prop.enum as [string, ...string[]];
    let schema: ZodTypeAny = z.enum(values);
    if (typeof prop.description === "string") schema = schema.describe(prop.description);
    return schema;
  }

  switch (prop.type) {
    case "string": {
      let schema: ZodTypeAny = z.string();
      if (typeof prop.description === "string") schema = schema.describe(prop.description);
      return schema;
    }
    case "integer": {
      let schema = z.number().int();
      if (typeof prop.minimum === "number") schema = schema.min(prop.minimum);
      if (typeof prop.maximum === "number") schema = schema.max(prop.maximum);
      let out: ZodTypeAny = schema;
      if (typeof prop.description === "string") out = out.describe(prop.description);
      return out;
    }
    case "number": {
      let schema = z.number();
      if (typeof prop.minimum === "number") schema = schema.min(prop.minimum);
      if (typeof prop.maximum === "number") schema = schema.max(prop.maximum);
      let out: ZodTypeAny = schema;
      if (typeof prop.description === "string") out = out.describe(prop.description);
      return out;
    }
    case "boolean": {
      let schema: ZodTypeAny = z.boolean();
      if (typeof prop.description === "string") schema = schema.describe(prop.description);
      return schema;
    }
    case "array": {
      const items =
        prop.items && typeof prop.items === "object"
          ? propToZod(prop.items as Record<string, unknown>)
          : z.unknown();
      let schema = z.array(items);
      if (typeof prop.maxItems === "number") schema = schema.max(prop.maxItems);
      if (typeof prop.minItems === "number") schema = schema.min(prop.minItems);
      let out: ZodTypeAny = schema;
      if (typeof prop.description === "string") out = out.describe(prop.description);
      return out;
    }
    case "object": {
      const nested = zodObjectFromJsonSchema(prop);
      return typeof prop.description === "string"
        ? nested.describe(prop.description)
        : nested;
    }
    default: {
      let schema: ZodTypeAny = z.unknown();
      if (typeof prop.description === "string") schema = schema.describe(prop.description);
      return schema;
    }
  }
}

/**
 * Build a Zod object from a JSON Schema draft object used by connector actions.
 * Uses passthrough so unknown keys still reach connector.execute() for rejection.
 */
export function zodObjectFromJsonSchema(
  schema: Record<string, unknown>,
): z.ZodObject<Record<string, ZodTypeAny>> {
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : [],
  );

  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(properties)) {
    let field = propToZod(prop);
    if (!required.has(key)) field = field.optional();
    shape[key] = field;
  }

  return z.object(shape).passthrough();
}
