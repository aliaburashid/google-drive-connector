import { ConnectorError } from "../errors/normalize.js";

/**
 * Lightweight runtime checks against our JSON Schema-shaped definitions.
 * Enough for Milestone 3 without pulling a full validator dependency.
 */
export function assertObjectInput(
  input: unknown,
  actionId: string,
): asserts input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${actionId} expects a JSON object input`,
      retryClass: "fatal",
    });
  }
}

export function rejectUnknownKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  actionId: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(input).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${actionId} received unknown field(s): ${unknown.join(", ")}`,
      retryClass: "fatal",
    });
  }
}

export function optionalString(
  input: Record<string, unknown>,
  key: string,
  actionId: string,
): string | undefined {
  if (!(key in input) || input[key] === undefined) return undefined;
  if (typeof input[key] !== "string") {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${actionId}: "${key}" must be a string`,
      retryClass: "fatal",
    });
  }
  return input[key];
}

export function optionalBoolean(
  input: Record<string, unknown>,
  key: string,
  actionId: string,
): boolean | undefined {
  if (!(key in input) || input[key] === undefined) return undefined;
  if (typeof input[key] !== "boolean") {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${actionId}: "${key}" must be a boolean`,
      retryClass: "fatal",
    });
  }
  return input[key];
}

export function optionalInteger(
  input: Record<string, unknown>,
  key: string,
  actionId: string,
  bounds?: { min?: number; max?: number },
): number | undefined {
  if (!(key in input) || input[key] === undefined) return undefined;
  const value = input[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${actionId}: "${key}" must be an integer`,
      retryClass: "fatal",
    });
  }
  if (bounds?.min !== undefined && value < bounds.min) {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${actionId}: "${key}" must be >= ${bounds.min}`,
      retryClass: "fatal",
    });
  }
  if (bounds?.max !== undefined && value > bounds.max) {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${actionId}: "${key}" must be <= ${bounds.max}`,
      retryClass: "fatal",
    });
  }
  return value;
}

export function optionalEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  actionId: string,
): T | undefined {
  if (!(key in input) || input[key] === undefined) return undefined;
  const value = input[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${actionId}: "${key}" must be one of: ${allowed.join(", ")}`,
      retryClass: "fatal",
    });
  }
  return value as T;
}
