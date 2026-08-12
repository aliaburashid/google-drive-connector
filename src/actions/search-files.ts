import type { DriveClient } from "../client.js";
import {
  DEFAULT_SEARCH_FIELDS,
  SEARCH_FILES_ACTION_ID,
  type SearchFilesInput,
  type SearchFilesOutput,
} from "../schemas/search-files.js";
import {
  assertObjectInput,
  optionalBoolean,
  optionalEnum,
  optionalInteger,
  optionalString,
  rejectUnknownKeys,
} from "../schemas/validate.js";
import { mapFileListResult } from "./file-list-result.js";

const ALLOWED_KEYS = [
  "q",
  "pageSize",
  "pageToken",
  "orderBy",
  "spaces",
  "corpora",
  "includeItemsFromAllDrives",
  "supportsAllDrives",
] as const;

const CORPORA = ["user", "domain", "drive", "allDrives"] as const;

export function parseSearchFilesInput(raw: unknown): SearchFilesInput {
  assertObjectInput(raw, SEARCH_FILES_ACTION_ID);
  rejectUnknownKeys(raw, ALLOWED_KEYS, SEARCH_FILES_ACTION_ID);

  const parsed: SearchFilesInput = {};

  const q = optionalString(raw, "q", SEARCH_FILES_ACTION_ID);
  if (q !== undefined) parsed.q = q;

  const pageSize = optionalInteger(raw, "pageSize", SEARCH_FILES_ACTION_ID, {
    min: 1,
    max: 1000,
  });
  if (pageSize !== undefined) parsed.pageSize = pageSize;

  const pageToken = optionalString(raw, "pageToken", SEARCH_FILES_ACTION_ID);
  if (pageToken !== undefined) parsed.pageToken = pageToken;

  const orderBy = optionalString(raw, "orderBy", SEARCH_FILES_ACTION_ID);
  if (orderBy !== undefined) parsed.orderBy = orderBy;

  const spaces = optionalString(raw, "spaces", SEARCH_FILES_ACTION_ID);
  if (spaces !== undefined) parsed.spaces = spaces;

  const corpora = optionalEnum(raw, "corpora", CORPORA, SEARCH_FILES_ACTION_ID);
  if (corpora !== undefined) parsed.corpora = corpora;

  const includeItemsFromAllDrives = optionalBoolean(
    raw,
    "includeItemsFromAllDrives",
    SEARCH_FILES_ACTION_ID,
  );
  if (includeItemsFromAllDrives !== undefined) {
    parsed.includeItemsFromAllDrives = includeItemsFromAllDrives;
  }

  const supportsAllDrives = optionalBoolean(
    raw,
    "supportsAllDrives",
    SEARCH_FILES_ACTION_ID,
  );
  if (supportsAllDrives !== undefined) parsed.supportsAllDrives = supportsAllDrives;

  return parsed;
}

/**
 * Search Drive files via files.list. Provider logic lives here — not in MCP.
 */
export async function searchFiles(
  client: DriveClient,
  rawInput: unknown,
): Promise<{ data: SearchFilesOutput; requestId?: string }> {
  const input = parseSearchFilesInput(rawInput);

  const { data, requestId, rateLimit } = await client.listFiles({
    ...(input.q !== undefined ? { q: input.q } : {}),
    ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {}),
    ...(input.pageToken !== undefined ? { pageToken: input.pageToken } : {}),
    ...(input.orderBy !== undefined ? { orderBy: input.orderBy } : {}),
    ...(input.spaces !== undefined ? { spaces: input.spaces } : {}),
    ...(input.corpora !== undefined ? { corpora: input.corpora } : {}),
    ...(input.includeItemsFromAllDrives !== undefined
      ? { includeItemsFromAllDrives: input.includeItemsFromAllDrives }
      : {}),
    ...(input.supportsAllDrives !== undefined
      ? { supportsAllDrives: input.supportsAllDrives }
      : {}),
    fields: DEFAULT_SEARCH_FIELDS,
  });

  return {
    data: mapFileListResult(data, rateLimit),
    ...(requestId !== undefined ? { requestId } : {}),
  };
}
