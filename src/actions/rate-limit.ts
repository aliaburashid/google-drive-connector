import type { DriveRateLimitMetadata } from "../client.js";

/** Include rateLimit on action outputs when Google returned useful headers. */
export function optionalRateLimit(
  rateLimit?: DriveRateLimitMetadata,
): { rateLimit: DriveRateLimitMetadata } | Record<string, never> {
  if (rateLimit === undefined || Object.keys(rateLimit).length === 0) {
    return {};
  }
  return { rateLimit };
}
