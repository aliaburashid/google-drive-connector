/**
 * JSON Schema + types for drive.upload_file.
 *
 * Google Drive uploads are NOT naturally idempotent. Retrying the same upload
 * (network timeout, client retry, duplicate execute) can create multiple files
 * with the same name. Callers should supply an idempotencyKey for their own
 * dedupe tracking; the connector does not ask Google to coalesce uploads.
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
  },
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
}

export const UPLOAD_RESULT_FIELDS =
  "id, name, mimeType, parents, size, webViewLink, createdTime, modifiedTime";

export const MULTIPART_MAX_BYTES = 5 * 1024 * 1024;
export const ABSOLUTE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export const UPLOAD_IDEMPOTENCY_WARNING =
  "Google Drive uploads are not naturally idempotent. Retrying this action may create another file with the same name. Track idempotencyKey on the client if you need deduplication.";
