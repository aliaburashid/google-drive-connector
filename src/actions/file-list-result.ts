import type { DriveFileListResponse, DriveRateLimitMetadata } from "../client.js";
import type { DriveFileMetadata, SearchFilesOutput } from "../schemas/search-files.js";
import { optionalRateLimit } from "./rate-limit.js";

/** Shared files.list output shape used by search and folder listing. */
export type FileListOutput = SearchFilesOutput;

export function mapFileListResult(
  data: DriveFileListResponse,
  rateLimit?: DriveRateLimitMetadata,
): FileListOutput {
  const files: DriveFileMetadata[] = (data.files ?? []).map((file) => ({
    ...file,
    id: file.id ?? "",
    name: file.name ?? "",
  }));

  return {
    files,
    ...(data.nextPageToken !== undefined && data.nextPageToken !== ""
      ? { nextPageToken: data.nextPageToken }
      : {}),
    ...(data.incompleteSearch !== undefined
      ? { incompleteSearch: data.incompleteSearch }
      : {}),
    ...optionalRateLimit(rateLimit),
  };
}
