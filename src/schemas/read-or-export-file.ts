/**
 * JSON Schema + types for drive.read_or_export_file.
 * Export formats are connector-controlled aliases, not arbitrary Google MIME types.
 */

export const READ_OR_EXPORT_FILE_ACTION_ID = "drive.read_or_export_file" as const;

export const READ_OR_EXPORT_FORMATS = [
  "pdf",
  "docx",
  "odt",
  "rtf",
  "txt",
  "md",
  "epub",
  "xlsx",
  "ods",
  "csv",
  "tsv",
  "pptx",
  "odp",
  "png",
  "jpeg",
  "svg",
] as const;

export const readOrExportFileInputSchema = {
  $id: "drive.read_or_export_file.input",
  type: "object",
  additionalProperties: false,
  required: ["fileId"],
  properties: {
    fileId: {
      type: "string",
      minLength: 1,
      description: "Drive file ID to download or export.",
    },
    format: {
      type: "string",
      enum: READ_OR_EXPORT_FORMATS,
      description:
        "Optional export format for Google Workspace files only. Supplying format for a normal/blob file returns invalid_input. Defaults: Docs/Slides/Drawings → pdf, Sheets → xlsx.",
      examples: ["pdf", "docx", "xlsx", "csv", "pptx"],
    },
    maxBytes: {
      type: "integer",
      minimum: 1,
      maximum: 26_214_400,
      description:
        "Maximum content size to return. Defaults to 10 MiB (Google export limit). Larger content fails with content_too_large instead of silent truncation.",
    },
  },
} as const;

export const readOrExportFileOutputSchema = {
  $id: "drive.read_or_export_file.output",
  type: "object",
  additionalProperties: false,
  required: [
    "fileId",
    "name",
    "sourceMimeType",
    "delivery",
    "mimeType",
    "encoding",
    "content",
    "sizeBytes",
    "truncated",
  ],
  properties: {
    fileId: { type: "string" },
    name: { type: "string" },
    sourceMimeType: { type: "string" },
    delivery: {
      type: "string",
      enum: ["download", "export"],
      description: "download = files.get?alt=media; export = files.export.",
    },
    mimeType: {
      type: "string",
      description: "MIME type of the returned content.",
    },
    encoding: {
      type: "string",
      enum: ["utf-8", "base64"],
      description:
        "utf-8 for text-like MIME types; base64 for binary (safe for JSON/MCP).",
    },
    content: {
      type: "string",
      description: "File content encoded according to encoding.",
    },
    sizeBytes: {
      type: "integer",
      description: "Byte length of the content before JSON encoding.",
    },
    truncated: {
      type: "boolean",
      description: "Always false in this connector; oversized files error instead.",
    },
    exportFormat: {
      type: "string",
      description: "Export alias used when delivery is export.",
    },
    limit: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxBytes: { type: "integer" },
        googleExportLimitBytes: { type: "integer" },
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
      fileId: "file_sanitized_notes",
      name: "Notes",
      sourceMimeType: "application/vnd.google-apps.document",
      delivery: "export",
      mimeType: "application/pdf",
      encoding: "base64",
      content: "JVBERi0xLjQ=",
      sizeBytes: 8,
      truncated: false,
      exportFormat: "pdf",
      limit: { maxBytes: 10485760, googleExportLimitBytes: 10485760 },
    },
  ],
} as const;

export type ReadOrExportFormat = (typeof READ_OR_EXPORT_FORMATS)[number];

export interface ReadOrExportFileInput {
  fileId: string;
  format?: ReadOrExportFormat;
  maxBytes?: number;
}

export interface ReadOrExportFileOutput {
  fileId: string;
  name: string;
  sourceMimeType: string;
  delivery: "download" | "export";
  mimeType: string;
  encoding: "utf-8" | "base64";
  content: string;
  sizeBytes: number;
  truncated: false;
  exportFormat?: string;
  limit: {
    maxBytes: number;
    googleExportLimitBytes: number;
  };
  rateLimit?: {
    limit?: string;
    remaining?: string;
    reset?: string;
    retryAfter?: string;
  };
}
