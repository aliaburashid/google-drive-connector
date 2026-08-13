import { shareFile } from "./actions/share-file.js";
import { listFolder } from "./actions/list-folder.js";
import { readOrExportFile } from "./actions/read-or-export-file.js";
import { searchFiles } from "./actions/search-files.js";
import { uploadFile } from "./actions/upload-file.js";
import { assertWriteApproved } from "./auth/approval.js";
import { DriveClient } from "./client.js";
import { normalizeError } from "./errors/normalize.js";
import {
  LIST_FOLDER_ACTION_ID,
  listFolderInputSchema,
  listFolderOutputSchema,
} from "./schemas/list-folder.js";
import {
  READ_OR_EXPORT_FILE_ACTION_ID,
  readOrExportFileInputSchema,
  readOrExportFileOutputSchema,
} from "./schemas/read-or-export-file.js";
import {
  SEARCH_FILES_ACTION_ID,
  searchFilesInputSchema,
  searchFilesOutputSchema,
} from "./schemas/search-files.js";
import {
  SHARE_FILE_ACTION_ID,
  shareFileInputSchema,
  shareFileOutputSchema,
} from "./schemas/share-file.js";
import {
  UPLOAD_FILE_ACTION_ID,
  uploadFileInputSchema,
  uploadFileOutputSchema,
} from "./schemas/upload-file.js";
import type {
  ConnectionTestResult,
  ConnectorAction,
  ConnectorExecuteRequest,
  ConnectorExecutionResult,
  ConnectorManifest,
  DooConnector,
  OAuthCredentials,
  RequiredActionId,
} from "./types.js";
import { DRIVE_SCOPE, REQUIRED_ACTION_IDS } from "./types.js";

const IMPLEMENTED_ACTIONS = [
  SEARCH_FILES_ACTION_ID,
  LIST_FOLDER_ACTION_ID,
  READ_OR_EXPORT_FILE_ACTION_ID,
  UPLOAD_FILE_ACTION_ID,
  SHARE_FILE_ACTION_ID,
] as const;

const ACTION_CATALOG: Record<
  RequiredActionId,
  Omit<ConnectorAction, "id" | "status">
> = {
  "drive.search_files": {
    name: "Search files",
    description: "Search Drive files and folders using a Drive query string.",
    approvalRequired: false,
  },
  "drive.list_folder": {
    name: "List folder",
    description: "List children of a folder (including My Drive root).",
    approvalRequired: false,
  },
  "drive.read_or_export_file": {
    name: "Read or export file",
    description:
      "Download blob content or export a Google Workspace document to a chosen MIME type.",
    approvalRequired: false,
  },
  "drive.upload_file": {
    name: "Upload file",
    description: "Upload a new file (multipart or resumable) into Drive.",
    approvalRequired: true,
  },
  "drive.share_file": {
    name: "Share file",
    description: "Create a permission on a file or folder.",
    approvalRequired: true,
  },
};

type ActionHandler = (
  client: DriveClient,
  input: Record<string, unknown>,
  request: ConnectorExecuteRequest,
) => Promise<{ data: unknown; requestId?: string }>;

const ACTION_HANDLERS: Partial<Record<RequiredActionId, ActionHandler>> = {
  [SEARCH_FILES_ACTION_ID]: (client, input) => searchFiles(client, input),
  [LIST_FOLDER_ACTION_ID]: (client, input) => listFolder(client, input),
  [READ_OR_EXPORT_FILE_ACTION_ID]: (client, input) => readOrExportFile(client, input),
  [UPLOAD_FILE_ACTION_ID]: (client, input, request) =>
    uploadFile(client, input, {
      ...(request.idempotencyKey !== undefined
        ? { idempotencyKey: request.idempotencyKey }
        : {}),
    }),
  [SHARE_FILE_ACTION_ID]: (client, input) => shareFile(client, input),
};

export const manifest: ConnectorManifest = {
  id: "google-drive",
  name: "Google Drive",
  version: "1.0.0",
  provider: "Google Drive API v3",
  authType: "oauth2",
  scopes: [DRIVE_SCOPE],
  requiredActions: REQUIRED_ACTION_IDS,
  implementedActions: [...IMPLEMENTED_ACTIONS],
  risks: [
    "Restricted OAuth scope https://www.googleapis.com/auth/drive is required for broad search/list without Google Picker; public apps need Google verification.",
    "drive.share_file can overshare (especially type=anyone); writes require explicit approval plus allowPublicShare for public links.",
    "drive.share_file is not naturally idempotent; repeated permission creates may duplicate, update, or fail depending on Google ACL rules. idempotencyKey is client-side only.",
    "For user/group shares, omitting sendNotificationEmail lets Google default to sending a notification email; pass false to disable where permitted.",
    "drive.upload_file is not naturally idempotent; retries may create duplicate files. Track idempotencyKey on the client.",
    "files.export is limited to ~10MB; this connector returns base64 for binary and fails with content_too_large instead of silent truncation.",
    "Shared drives require supportsAllDrives / includeItemsFromAllDrives flags.",
  ],
  capabilities: {
    testConnection: true,
    listActions: true,
    execute: true,
    pagination: true,
    rateLimitMetadata: true,
  },
};

/**
 * Side-effect-free credential check via Drive about.get.
 * Confirms OAuth refresh + API access without creating or modifying files.
 */
export async function testConnection(
  credentials: OAuthCredentials,
): Promise<ConnectionTestResult> {
  const checkedAt = new Date().toISOString();

  try {
    const client = new DriveClient({ credentials });
    const { data, requestId } = await client.about(
      "user(displayName,emailAddress,permissionId),storageQuota(limit,usage,usageInDrive)",
    );

    return {
      ok: true,
      message: "Google Drive credentials are valid.",
      ...(data.user !== undefined ? { user: data.user } : {}),
      ...(data.storageQuota !== undefined ? { storageQuota: data.storageQuota } : {}),
      checkedAt,
      ...(requestId !== undefined ? { requestId } : {}),
    };
  } catch (err) {
    const normalized = normalizeError(err);
    return {
      ok: false,
      message: normalized.message,
      checkedAt,
      ...(normalized.requestId !== undefined
        ? { requestId: normalized.requestId }
        : {}),
    };
  }
}

export function listActions(): ConnectorAction[] {
  const implemented = new Set<string>(IMPLEMENTED_ACTIONS);
  return REQUIRED_ACTION_IDS.map((id) => ({
    id,
    ...ACTION_CATALOG[id],
    status: implemented.has(id) ? "implemented" : "planned",
  }));
}

export async function execute(
  request: ConnectorExecuteRequest,
): Promise<ConnectorExecutionResult> {
  const known = (REQUIRED_ACTION_IDS as readonly string[]).includes(request.actionId);

  if (!known) {
    return {
      ok: false,
      actionId: request.actionId,
      error: {
        code: "unknown_action",
        message: `Unknown action: ${request.actionId}`,
        retryClass: "fatal",
      },
    };
  }

  const actionId = request.actionId as RequiredActionId;
  const catalog = ACTION_CATALOG[actionId];
  const handler = ACTION_HANDLERS[actionId];
  if (!handler) {
    return {
      ok: false,
      actionId: request.actionId,
      error: {
        code: "not_implemented",
        message: `Action ${request.actionId} is planned but not implemented yet.`,
        retryClass: "fatal",
      },
    };
  }

  // Write gate: approval is checked BEFORE DriveClient is constructed or used.
  if (catalog.approvalRequired) {
    try {
      assertWriteApproved(request.actionId, request.approval);
    } catch (err) {
      const error = normalizeError(err);
      return {
        ok: false,
        actionId: request.actionId,
        error,
      };
    }
  }

  try {
    const client = new DriveClient({ credentials: request.credentials });
    const { data, requestId } = await handler(client, request.input, request);
    return {
      ok: true,
      actionId: request.actionId,
      data,
      ...(requestId !== undefined ? { requestId } : {}),
    };
  } catch (err) {
    const error = normalizeError(err);
    return {
      ok: false,
      actionId: request.actionId,
      error,
      ...(error.requestId !== undefined ? { requestId: error.requestId } : {}),
    };
  }
}

export const googleDriveConnector: DooConnector = {
  manifest,
  testConnection,
  listActions,
  execute,
};

export default googleDriveConnector;

export { credentialsFromEnv, getAccessToken, refreshAccessToken } from "./auth/oauth.js";
export { ConnectorError, normalizeError } from "./errors/normalize.js";
export {
  LIST_FOLDER_ACTION_ID,
  listFolderInputSchema,
  listFolderOutputSchema,
} from "./schemas/list-folder.js";
export {
  READ_OR_EXPORT_FILE_ACTION_ID,
  readOrExportFileInputSchema,
  readOrExportFileOutputSchema,
} from "./schemas/read-or-export-file.js";
export {
  SEARCH_FILES_ACTION_ID,
  searchFilesInputSchema,
  searchFilesOutputSchema,
} from "./schemas/search-files.js";
export {
  SHARE_FILE_ACTION_ID,
  shareFileInputSchema,
  shareFileOutputSchema,
} from "./schemas/share-file.js";
export {
  UPLOAD_FILE_ACTION_ID,
  uploadFileInputSchema,
  uploadFileOutputSchema,
} from "./schemas/upload-file.js";
export type {
  ConnectionTestResult,
  ConnectorAction,
  ConnectorExecuteRequest,
  ConnectorExecutionResult,
  ConnectorManifest,
  DooConnector,
  OAuthCredentials,
} from "./types.js";
