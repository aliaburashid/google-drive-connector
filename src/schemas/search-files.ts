/**
 * JSON Schema + types for drive.search_files.
 */

export const SEARCH_FILES_ACTION_ID = "drive.search_files" as const;

export const searchFilesInputSchema = {
  $id: "drive.search_files.input",
  type: "object",
  additionalProperties: false,
  properties: {
    q: {
      type: "string",
      description:
        "Google Drive query string (e.g. \"name contains 'report' and trashed = false\").",
      examples: ["name contains 'invoice' and trashed = false", "mimeType = 'application/pdf'"],
    },
    pageSize: {
      type: "integer",
      minimum: 1,
      maximum: 1000,
      description: "Max files to return in this page (Drive default is 100).",
      examples: [10, 50],
    },
    pageToken: {
      type: "string",
      description: "Token from a previous response nextPageToken for the next page.",
    },
    orderBy: {
      type: "string",
      description: "Sort order (e.g. \"modifiedTime desc\", \"name\").",
      examples: ["modifiedTime desc", "name"],
    },
    spaces: {
      type: "string",
      description: "Comma-separated spaces to search (drive, appDataFolder, photos).",
      examples: ["drive"],
    },
    corpora: {
      type: "string",
      enum: ["user", "domain", "drive", "allDrives"],
      description: "Which corpora to search.",
    },
    includeItemsFromAllDrives: {
      type: "boolean",
      description: "Whether both My Drive and shared drive items can appear.",
    },
    supportsAllDrives: {
      type: "boolean",
      description: "Whether the requesting app supports both My Drives and shared drives.",
    },
    fields: {
      type: "string",
      description:
        "Optional Drive fields mask. Defaults to a safe metadata set including nextPageToken.",
    },
  },
} as const;

export const driveFileSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    mimeType: { type: "string" },
    parents: { type: "array", items: { type: "string" } },
    modifiedTime: { type: "string" },
    createdTime: { type: "string" },
    size: { type: "string" },
    webViewLink: { type: "string" },
    trashed: { type: "boolean" },
    driveId: { type: "string" },
  },
  required: ["id", "name"],
} as const;

export const searchFilesOutputSchema = {
  $id: "drive.search_files.output",
  type: "object",
  additionalProperties: false,
  required: ["files"],
  properties: {
    files: {
      type: "array",
      items: driveFileSchema,
      description: "Matching Drive files for this page.",
    },
    nextPageToken: {
      type: "string",
      description: "Pass as pageToken on the next call when more results exist.",
    },
    incompleteSearch: {
      type: "boolean",
      description: "True when Drive omitted some results (large corpora).",
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
      files: [
        {
          id: "1abcExampleFileId",
          name: "Invoice April.pdf",
          mimeType: "application/pdf",
          parents: ["0BrootFolderId"],
          modifiedTime: "2026-04-01T12:00:00.000Z",
          trashed: false,
        },
      ],
      nextPageToken: "next-page-token-example",
    },
  ],
} as const;

export interface SearchFilesInput {
  q?: string;
  pageSize?: number;
  pageToken?: string;
  orderBy?: string;
  spaces?: string;
  corpora?: "user" | "domain" | "drive" | "allDrives";
  includeItemsFromAllDrives?: boolean;
  supportsAllDrives?: boolean;
  fields?: string;
}

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType?: string;
  parents?: string[];
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
  webViewLink?: string;
  trashed?: boolean;
  driveId?: string;
  [key: string]: unknown;
}

export interface SearchFilesOutput {
  files: DriveFileMetadata[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
  rateLimit?: {
    limit?: string;
    remaining?: string;
    reset?: string;
    retryAfter?: string;
  };
}

export const DEFAULT_SEARCH_FIELDS =
  "nextPageToken, incompleteSearch, files(id, name, mimeType, parents, modifiedTime, createdTime, size, webViewLink, trashed, driveId)";
