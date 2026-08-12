/**
 * JSON Schema + types for drive.list_folder.
 * Field selection is owned by the connector — callers cannot pass `fields`.
 */

import { driveFileSchema, type DriveFileMetadata } from "./search-files.js";

export const LIST_FOLDER_ACTION_ID = "drive.list_folder" as const;

export const listFolderInputSchema = {
  $id: "drive.list_folder.input",
  type: "object",
  additionalProperties: false,
  required: ["folderId"],
  properties: {
    folderId: {
      type: "string",
      minLength: 1,
      description:
        'Folder to list. Use "root" for the user\'s My Drive root. Only direct children are returned.',
      examples: ["root", "1abcExampleFolderId"],
    },
    pageSize: {
      type: "integer",
      minimum: 1,
      maximum: 1000,
      description: "Max children to return in this page (Drive default is 100).",
      examples: [10, 50],
    },
    pageToken: {
      type: "string",
      description: "Token from a previous response nextPageToken for the next page.",
    },
  },
} as const;

export const listFolderOutputSchema = {
  $id: "drive.list_folder.output",
  type: "object",
  additionalProperties: false,
  required: ["folderId", "files"],
  properties: {
    folderId: {
      type: "string",
      description: "The folder that was listed (including \"root\" when requested).",
    },
    files: {
      type: "array",
      items: driveFileSchema,
      description: "Direct, non-trashed children of the folder for this page.",
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
      folderId: "root",
      files: [
        {
          id: "1abcExampleFolderId",
          name: "Projects",
          mimeType: "application/vnd.google-apps.folder",
          parents: ["0ArootId"],
          modifiedTime: "2026-04-01T12:00:00.000Z",
          trashed: false,
        },
      ],
      nextPageToken: "next-page-token-example",
    },
  ],
} as const;

export interface ListFolderInput {
  folderId: string;
  pageSize?: number;
  pageToken?: string;
}

export interface ListFolderOutput {
  folderId: string;
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
