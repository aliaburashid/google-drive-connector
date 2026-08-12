import type { DriveClient } from "../client.js";
import { ConnectorError } from "../errors/normalize.js";
import {
  LIST_FOLDER_ACTION_ID,
  type ListFolderInput,
  type ListFolderOutput,
} from "../schemas/list-folder.js";
import { DEFAULT_SEARCH_FIELDS } from "../schemas/search-files.js";
import {
  assertObjectInput,
  optionalInteger,
  optionalString,
  rejectUnknownKeys,
  requiredString,
} from "../schemas/validate.js";
import { mapFileListResult } from "./file-list-result.js";

const ALLOWED_KEYS = ["folderId", "pageSize", "pageToken"] as const;

/**
 * Escape a value for use inside a Drive query string literal.
 */
export function escapeDriveQueryValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

/**
 * Direct children only, excluding trash. "root" lists My Drive root.
 */
export function buildListFolderQuery(folderId: string): string {
  return `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`;
}

export function parseListFolderInput(raw: unknown): ListFolderInput {
  assertObjectInput(raw, LIST_FOLDER_ACTION_ID);
  rejectUnknownKeys(raw, ALLOWED_KEYS, LIST_FOLDER_ACTION_ID);

  const folderId = requiredString(raw, "folderId", LIST_FOLDER_ACTION_ID);
  if (folderId.includes("\0")) {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${LIST_FOLDER_ACTION_ID}: "folderId" is invalid`,
      retryClass: "fatal",
    });
  }

  const parsed: ListFolderInput = { folderId };

  const pageSize = optionalInteger(raw, "pageSize", LIST_FOLDER_ACTION_ID, {
    min: 1,
    max: 1000,
  });
  if (pageSize !== undefined) parsed.pageSize = pageSize;

  const pageToken = optionalString(raw, "pageToken", LIST_FOLDER_ACTION_ID);
  if (pageToken !== undefined) parsed.pageToken = pageToken;

  return parsed;
}

/**
 * List direct children of a Drive folder via files.list.
 * Reuses DriveClient.listFiles — no extra Google endpoint.
 */
export async function listFolder(
  client: DriveClient,
  rawInput: unknown,
): Promise<{ data: ListFolderOutput; requestId?: string }> {
  const input = parseListFolderInput(rawInput);

  const { data, requestId, rateLimit } = await client.listFiles({
    q: buildListFolderQuery(input.folderId),
    ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {}),
    ...(input.pageToken !== undefined ? { pageToken: input.pageToken } : {}),
    fields: DEFAULT_SEARCH_FIELDS,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const listed = mapFileListResult(data, rateLimit);
  const output: ListFolderOutput = {
    folderId: input.folderId,
    files: listed.files,
    ...(listed.nextPageToken !== undefined ? { nextPageToken: listed.nextPageToken } : {}),
    ...(listed.incompleteSearch !== undefined
      ? { incompleteSearch: listed.incompleteSearch }
      : {}),
    ...(listed.rateLimit !== undefined ? { rateLimit: listed.rateLimit } : {}),
  };

  return {
    data: output,
    ...(requestId !== undefined ? { requestId } : {}),
  };
}
