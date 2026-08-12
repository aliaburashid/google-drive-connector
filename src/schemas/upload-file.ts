/**
 * JSON Schema + types for drive.upload_file.
 *
 * Approval: consequential write. Requires execute approval (`approval.approved === true`)
 * before any Google call.
 *
 * Idempotency: Google Drive uploads are NOT naturally idempotent. Retrying the same
 * upload (network timeout, client retry, duplicate execute) can create multiple files
 * with the same name. Callers may supply an execute-level idempotencyKey for their own
 * external duplicate tracking; Google Drive does not deduplicate uploads using that key,
 * and this connector does not guarantee idempotency.
 *
 * Retry: provider/transient failures are normalized with retryClass (e.g. retryable /
 * rate_limited). Blind retries after an uncertain outcome may create duplicates.
 */

export const UPLOAD_FILE_ACTION_ID = "drive.upload_file" as const;

export const UPLOAD_CONTENT_ENCODINGS = ["utf-8", "base64"] as const;
export const UPLOAD_STRATEGIES = ["auto", "multipart", "resumable"] as const;

export const uploadFileInputSchema = {
  $id: "drive.upload_file.input",
  type: "object",
  additionalProperties: false,
  required: ["name", "mimeType", "content", "encoding"],
  properties: {
    name: {
      type: "string",
      minLength: 1,
      description: "File name to create in Drive.",
    },
    mimeType: {
      type: "string",
      minLength: 1,
      description: "MIME type of the file content.",
      examples: ["text/plain", "application/pdf", "image/png"],
    },
    content: {
      type: "string",
      description: "File bytes as a string, interpreted using encoding.",
    },
    encoding: {
      type: "string",
      enum: UPLOAD_CONTENT_ENCODINGS,
      description: "utf-8 for text; base64 for binary (JSON/MCP-safe).",
    },
    parents: {
      type: "array",
      items: { type: "string", minLength: 1 },
      maxItems: 1,
      description: "Optional parent folder IDs. Only the first parent is used.",
    },
    uploadStrategy: {
      type: "string",
      enum: UPLOAD_STRATEGIES,
      description:
        "auto (default): multipart when content ≤ 5 MiB, otherwise resumable. multipart and resumable force a strategy.",
    },
  },
  examples: [
    {
      name: "connector-upload-test.txt",
      mimeType: "text/plain",
      encoding: "utf-8",
      content: "hello from connector\n",
      uploadStrategy: "multipart",
    },
    {
      name: "notes.pdf",
      mimeType: "application/pdf",
      encoding: "base64",
      content: "JVBERi0xLjQ=",
      parents: ["1abcExampleFolderId"],
    },
  ],
} as const;

export const uploadFileOutputSchema = {
  $id: "drive.upload_file.output",
  type: "object",
  additionalProperties: false,
  required: ["file", "uploadStrategy", "sizeBytes", "idempotency"],
  properties: {
    file: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        mimeType: { type: "string" },
        parents: { type: "array", items: { type: "string" } },
        size: { type: "string" },
        webViewLink: { type: "string" },
        createdTime: { type: "string" },
        modifiedTime: { type: "string" },
      },
    },
    uploadStrategy: {
      type: "string",
      enum: ["multipart", "resumable"],
    },
    sizeBytes: { type: "integer" },
    idempotency: {
      type: "object",
      additionalProperties: false,
      required: ["naturallyIdempotent", "warning"],
      properties: {
        key: { type: "string" },
        naturallyIdempotent: { type: "boolean" },
        warning: { type: "string" },
      },
    },
    rateLimit: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "string" },
        remaining: { type: "string" },
        reset: { type: "string" },
        retryAfter: { type: "string" },
      },
      description: "Rate-limit metadata when Google returns related headers.",
    },
  },
  examples: [
    {
      file: {
        id: "file_sanitized_upload_001",
        name: "connector-upload-test.txt",
        mimeType: "text/plain",
        parents: ["folder_sanitized_root"],
        size: "21",
        webViewLink: "https://drive.google.com/file/d/file_sanitized_upload_001/view",
        createdTime: "2026-08-12T12:00:00.000Z",
        modifiedTime: "2026-08-12T12:00:00.000Z",
      },
      uploadStrategy: "multipart",
      sizeBytes: 21,
      idempotency: {
        naturallyIdempotent: false,
        warning:
          "Google Drive uploads are not naturally idempotent. Retrying this action may create another file with the same name. Track idempotencyKey on the client if you need deduplication.",
      },
    },
  ],
} as const;

export type UploadContentEncoding = (typeof UPLOAD_CONTENT_ENCODINGS)[number];
export type UploadStrategyChoice = (typeof UPLOAD_STRATEGIES)[number];

export interface UploadFileInput {
  name: string;
  mimeType: string;
  content: string;
  encoding: UploadContentEncoding;
  parents?: string[];
  uploadStrategy?: UploadStrategyChoice;
}

export interface UploadFileOutput {
  file: {
    id: string;
    name: string;
    mimeType?: string;
    parents?: string[];
    size?: string;
    webViewLink?: string;
    createdTime?: string;
    modifiedTime?: string;
  };
  uploadStrategy: "multipart" | "resumable";
  sizeBytes: number;
  idempotency: {
    key?: string;
    naturallyIdempotent: false;
    warning: string;
  };
  rateLimit?: {
    limit?: string;
    remaining?: string;
    reset?: string;
    retryAfter?: string;
  };
}

export const UPLOAD_RESULT_FIELDS =
  "id, name, mimeType, parents, size, webViewLink, createdTime, modifiedTime";

export const MULTIPART_MAX_BYTES = 5 * 1024 * 1024;
export const ABSOLUTE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export const UPLOAD_IDEMPOTENCY_WARNING =
  "Google Drive uploads are not naturally idempotent. Retrying this action may create another file with the same name. Track idempotencyKey on the client if you need deduplication.";
