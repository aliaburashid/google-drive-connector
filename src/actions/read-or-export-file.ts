import type { DriveClient, DriveFileResource, DriveRateLimitMetadata } from "../client.js";
import { ConnectorError } from "../errors/normalize.js";
import {
  READ_OR_EXPORT_FILE_ACTION_ID,
  READ_OR_EXPORT_FORMATS,
  type ReadOrExportFileInput,
  type ReadOrExportFileOutput,
} from "../schemas/read-or-export-file.js";
import {
  assertObjectInput,
  optionalEnum,
  optionalInteger,
  rejectUnknownKeys,
  requiredString,
} from "../schemas/validate.js";
import {
  ABSOLUTE_MAX_BYTES,
  DEFAULT_MAX_BYTES,
  GOOGLE_EXPORT_LIMIT_BYTES,
  isGoogleWorkspaceMimeType,
  isNonExportableWorkspaceType,
  isTextMimeType,
  resolveExport,
  type ExportFormatAlias,
} from "./export-formats.js";
import { optionalRateLimit } from "./rate-limit.js";

const ALLOWED_KEYS = ["fileId", "format", "maxBytes"] as const;

export const READ_METADATA_FIELDS =
  "id, name, mimeType, size, capabilities(canDownload)";

export function parseReadOrExportFileInput(raw: unknown): ReadOrExportFileInput {
  assertObjectInput(raw, READ_OR_EXPORT_FILE_ACTION_ID);
  rejectUnknownKeys(raw, ALLOWED_KEYS, READ_OR_EXPORT_FILE_ACTION_ID);

  const parsed: ReadOrExportFileInput = {
    fileId: requiredString(raw, "fileId", READ_OR_EXPORT_FILE_ACTION_ID),
  };

  const format = optionalEnum(
    raw,
    "format",
    READ_OR_EXPORT_FORMATS,
    READ_OR_EXPORT_FILE_ACTION_ID,
  );
  if (format !== undefined) parsed.format = format;

  const maxBytes = optionalInteger(raw, "maxBytes", READ_OR_EXPORT_FILE_ACTION_ID, {
    min: 1,
    max: ABSOLUTE_MAX_BYTES,
  });
  if (maxBytes !== undefined) parsed.maxBytes = maxBytes;

  return parsed;
}

export function chooseDelivery(mimeType: string): "download" | "export" {
  return isGoogleWorkspaceMimeType(mimeType) ? "export" : "download";
}

function encodeContent(
  bytes: Uint8Array,
  mimeType: string,
): { encoding: "utf-8" | "base64"; content: string } {
  if (isTextMimeType(mimeType)) {
    try {
      return { encoding: "utf-8", content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch {
      // Fall through to base64 if the payload is not valid UTF-8.
    }
  }
  return { encoding: "base64", content: Buffer.from(bytes).toString("base64") };
}

function assertCanDownload(file: DriveFileResource): void {
  if (file.capabilities?.canDownload === false) {
    throw new ConnectorError({
      code: "download_not_allowed",
      message: `Google Drive reports this file cannot be downloaded (fileId=${file.id ?? "unknown"}).`,
      retryClass: "fatal",
    });
  }
}

function assertWithinLimit(
  sizeBytes: number,
  maxBytes: number,
  knownAhead: boolean,
): void {
  if (sizeBytes <= maxBytes) return;
  throw new ConnectorError({
    code: "content_too_large",
    message: knownAhead
      ? `File is ${sizeBytes} bytes, which exceeds maxBytes=${maxBytes}. Content was not downloaded.`
      : `Retrieved content is ${sizeBytes} bytes, which exceeds maxBytes=${maxBytes}. Content was not returned.`,
    retryClass: "fatal",
  });
}

/**
 * Download a blob file or export a Google Workspace file.
 * Google HTTP stays in DriveClient; routing/format rules stay here.
 */
export async function readOrExportFile(
  client: DriveClient,
  rawInput: unknown,
): Promise<{ data: ReadOrExportFileOutput; requestId?: string }> {
  const input = parseReadOrExportFileInput(rawInput);
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;

  const metadata = await client.getFile(input.fileId, READ_METADATA_FIELDS);
  const file = metadata.data;
  const sourceMimeType = file.mimeType ?? "application/octet-stream";
  const fileId = file.id ?? input.fileId;
  const name = file.name ?? fileId;

  const delivery = chooseDelivery(sourceMimeType);
  if (delivery === "download" && input.format !== undefined) {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${READ_OR_EXPORT_FILE_ACTION_ID}: "format" is only valid for Google Workspace files`,
      retryClass: "fatal",
    });
  }

  if (isNonExportableWorkspaceType(sourceMimeType)) {
    throw new ConnectorError({
      code: "unsupported_file_type",
      message: `Cannot read or export a Google Workspace type of ${sourceMimeType}`,
      retryClass: "fatal",
    });
  }

  assertCanDownload(file);

  let bytes: Uint8Array;
  let contentMimeType: string;
  let exportFormat: string | undefined;
  let requestId = metadata.requestId;
  let rateLimit: DriveRateLimitMetadata | undefined = metadata.rateLimit;

  if (delivery === "export") {
    const resolved = resolveExport(sourceMimeType, input.format as ExportFormatAlias | undefined);
    exportFormat = resolved.alias;
    const exported = await client.exportFile(fileId, resolved.mimeType);
    bytes = exported.bytes;
    contentMimeType = exported.mimeType ?? resolved.mimeType;
    requestId = exported.requestId ?? requestId;
    rateLimit = exported.rateLimit ?? rateLimit;
  } else {
    const knownSize = file.size !== undefined ? Number(file.size) : Number.NaN;
    if (Number.isFinite(knownSize)) {
      assertWithinLimit(knownSize, maxBytes, true);
    }
    const downloaded = await client.downloadFile(fileId);
    bytes = downloaded.bytes;
    contentMimeType = downloaded.mimeType ?? sourceMimeType;
    requestId = downloaded.requestId ?? requestId;
    rateLimit = downloaded.rateLimit ?? rateLimit;
  }

  assertWithinLimit(bytes.byteLength, maxBytes, false);

  const encoded = encodeContent(bytes, contentMimeType);
  const output: ReadOrExportFileOutput = {
    fileId,
    name,
    sourceMimeType,
    delivery,
    mimeType: contentMimeType,
    encoding: encoded.encoding,
    content: encoded.content,
    sizeBytes: bytes.byteLength,
    truncated: false,
    ...(exportFormat !== undefined ? { exportFormat } : {}),
    limit: {
      maxBytes,
      googleExportLimitBytes: GOOGLE_EXPORT_LIMIT_BYTES,
    },
    ...optionalRateLimit(rateLimit),
  };

  return {
    data: output,
    ...(requestId !== undefined ? { requestId } : {}),
  };
}
