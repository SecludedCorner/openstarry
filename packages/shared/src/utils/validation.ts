/**
 * Zod validation helpers.
 */

import { z, type ZodType, type ZodError } from "zod";

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Validate input against a Zod schema, returning a structured result. */
export function validateInput<T>(schema: ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: formatZodError(result.error),
  };
}

/** Format a ZodError into a human-readable string. */
export function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

/** Convert a Zod schema to JSON Schema (simplified). */
export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  // Simplified conversion — handles common Zod types
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodType>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  if (schema instanceof z.ZodString) {
    return { type: "string", description: schema.description };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "number", description: schema.description };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean", description: schema.description };
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodToJsonSchema(schema.element),
      description: schema.description,
    };
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodEnum) {
    return {
      type: "string",
      enum: schema.options,
      description: schema.description,
    };
  }

  // Fallback
  return { type: "string" };
}
