import type { DriveClient } from "../client.js";
import { ConnectorError } from "../errors/normalize.js";
import {
  ABSOLUTE_UPLOAD_MAX_BYTES,
  MULTIPART_MAX_BYTES,
  UPLOAD_CONTENT_ENCODINGS,
  UPLOAD_FILE_ACTION_ID,
  UPLOAD_IDEMPOTENCY_WARNING,
  UPLOAD_RESULT_FIELDS,
  UPLOAD_STRATEGIES,
  type UploadFileInput,
  type UploadFileOutput,
  type UploadStrategyChoice,
} from "../schemas/upload-file.js";
import {
  assertObjectInput,
  optionalEnum,
  rejectUnknownKeys,
  requiredString,
} from "../schemas/validate.js";
import { optionalRateLimit } from "./rate-limit.js";

const ALLOWED_KEYS = [
  "name",
  "mimeType",
  "content",
  "encoding",
  "parents",
  "uploadStrategy",
] as const;

export function selectUploadStrategy(
  sizeBytes: number,
  requested: UploadStrategyChoice = "auto",
): "multipart" | "resumable" {
  if (requested === "multipart") {
    if (sizeBytes > MULTIPART_MAX_BYTES) {
      throw new ConnectorError({
        code: "invalid_input",
        message: `multipart upload is only supported up to ${MULTIPART_MAX_BYTES} bytes (got ${sizeBytes})`,
        retryClass: "fatal",
      });
    }
    return "multipart";
  }
  if (requested === "resumable") return "resumable";
  return sizeBytes <= MULTIPART_MAX_BYTES ? "multipart" : "resumable";
}

export function decodeUploadContent(
  content: string,
  encoding: "utf-8" | "base64",
): Uint8Array {
  if (encoding === "utf-8") {
    return new TextEncoder().encode(content);
  }
  return new Uint8Array(Buffer.from(content, "base64"));
}

export function parseUploadFileInput(raw: unknown): UploadFileInput {
  assertObjectInput(raw, UPLOAD_FILE_ACTION_ID);
  rejectUnknownKeys(raw, ALLOWED_KEYS, UPLOAD_FILE_ACTION_ID);

  const encoding = optionalEnum(
    raw,
    "encoding",
    UPLOAD_CONTENT_ENCODINGS,
    UPLOAD_FILE_ACTION_ID,
  );
  if (encoding === undefined) {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${UPLOAD_FILE_ACTION_ID}: "encoding" is required`,
      retryClass: "fatal",
    });
  }

  const parsed: UploadFileInput = {
    name: requiredString(raw, "name", UPLOAD_FILE_ACTION_ID),
    mimeType: requiredString(raw, "mimeType", UPLOAD_FILE_ACTION_ID),
    content: requiredString(raw, "content", UPLOAD_FILE_ACTION_ID),
    encoding,
  };

  if ("parents" in raw && raw.parents !== undefined) {
    if (!Array.isArray(raw.parents) || raw.parents.length === 0) {
      throw new ConnectorError({
        code: "invalid_input",
        message: `Action ${UPLOAD_FILE_ACTION_ID}: "parents" must be a non-empty array of folder IDs`,
        retryClass: "fatal",
      });
    }
    if (raw.parents.length > 1) {
      throw new ConnectorError({
        code: "invalid_input",
        message: `Action ${UPLOAD_FILE_ACTION_ID}: only one parent folder is supported`,
        retryClass: "fatal",
      });
    }
    if (typeof raw.parents[0] !== "string" || raw.parents[0].trim() === "") {
      throw new ConnectorError({
        code: "invalid_input",
        message: `Action ${UPLOAD_FILE_ACTION_ID}: parent folder ID must be a non-empty string`,
        retryClass: "fatal",
      });
    }
    parsed.parents = [raw.parents[0].trim()];
  }

  const strategy = optionalEnum(
    raw,
    "uploadStrategy",
    UPLOAD_STRATEGIES,
    UPLOAD_FILE_ACTION_ID,
  );
  if (strategy !== undefined) parsed.uploadStrategy = strategy;

  return parsed;
}

/**
 * Upload a file. Caller must already have passed connector-core approval.
 */
export async function uploadFile(
  client: DriveClient,
  rawInput: unknown,
  options?: { idempotencyKey?: string },
): Promise<{ data: UploadFileOutput; requestId?: string }> {
  const input = parseUploadFileInput(rawInput);
  const bytes = decodeUploadContent(input.content, input.encoding);

  if (bytes.byteLength === 0) {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${UPLOAD_FILE_ACTION_ID}: content must not be empty`,
      retryClass: "fatal",
    });
  }
  if (bytes.byteLength > ABSOLUTE_UPLOAD_MAX_BYTES) {
    throw new ConnectorError({
      code: "content_too_large",
      message: `Upload is ${bytes.byteLength} bytes; connector limit is ${ABSOLUTE_UPLOAD_MAX_BYTES} bytes`,
      retryClass: "fatal",
    });
  }

  const strategy = selectUploadStrategy(bytes.byteLength, input.uploadStrategy ?? "auto");
  const uploadParams = {
    name: input.name,
    mimeType: input.mimeType,
    bytes,
    ...(input.parents !== undefined ? { parents: input.parents } : {}),
    fields: UPLOAD_RESULT_FIELDS,
  };

  const result =
    strategy === "multipart"
      ? await client.uploadMultipart(uploadParams)
      : await client.uploadResumable(uploadParams);

  const file = result.data;
  if (!file.id || !file.name) {
    throw new ConnectorError({
      code: "invalid_provider_response",
      message: "Google Drive upload response missing id or name",
      retryClass: "retryable",
      ...(result.requestId !== undefined ? { requestId: result.requestId } : {}),
    });
  }

  const output: UploadFileOutput = {
    file: {
      id: file.id,
      name: file.name,
      ...(file.mimeType !== undefined ? { mimeType: file.mimeType } : {}),
      ...(file.parents !== undefined ? { parents: file.parents } : {}),
      ...(file.size !== undefined ? { size: file.size } : {}),
      ...(file.webViewLink !== undefined ? { webViewLink: file.webViewLink } : {}),
      ...(file.createdTime !== undefined ? { createdTime: file.createdTime } : {}),
      ...(file.modifiedTime !== undefined ? { modifiedTime: file.modifiedTime } : {}),
    },
    uploadStrategy: strategy,
    sizeBytes: bytes.byteLength,
    idempotency: {
      ...(options?.idempotencyKey !== undefined ? { key: options.idempotencyKey } : {}),
      naturallyIdempotent: false,
      warning: UPLOAD_IDEMPOTENCY_WARNING,
    },
    ...optionalRateLimit(result.rateLimit),
  };

  return {
    data: output,
    ...(result.requestId !== undefined ? { requestId: result.requestId } : {}),
  };
}
