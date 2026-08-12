import { listFolder } from "./actions/list-folder.js";
import { searchFiles } from "./actions/search-files.js";
import { DriveClient } from "./client.js";
import { normalizeError } from "./errors/normalize.js";
import {
  LIST_FOLDER_ACTION_ID,
  listFolderInputSchema,
  listFolderOutputSchema,
} from "./schemas/list-folder.js";
import {
  SEARCH_FILES_ACTION_ID,
  searchFilesInputSchema,
  searchFilesOutputSchema,
} from "./schemas/search-files.js";
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

const IMPLEMENTED_ACTIONS = [SEARCH_FILES_ACTION_ID, LIST_FOLDER_ACTION_ID] as const;

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
) => Promise<{ data: unknown; requestId?: string }>;

const ACTION_HANDLERS: Partial<Record<RequiredActionId, ActionHandler>> = {
  [SEARCH_FILES_ACTION_ID]: searchFiles,
  [LIST_FOLDER_ACTION_ID]: listFolder,
};

export const manifest: ConnectorManifest = {
  id: "google-drive",
  name: "Google Drive",
  version: "0.3.0",
  provider: "Google Drive API v3",
  authType: "oauth2",
  scopes: [DRIVE_SCOPE],
  requiredActions: REQUIRED_ACTION_IDS,
  implementedActions: [...IMPLEMENTED_ACTIONS],
  risks: [
    "Restricted OAuth scope https://www.googleapis.com/auth/drive is required for broad search/list without Google Picker; public apps need Google verification.",
    "drive.share_file can overshare (especially type=anyone); writes require explicit approval.",
    "drive.upload_file is not naturally idempotent; document client idempotency strategy.",
    "files.export is limited to ~10MB; large binary content needs an encoding strategy over MCP.",
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

  const handler = ACTION_HANDLERS[request.actionId as RequiredActionId];
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

  try {
    const client = new DriveClient({ credentials: request.credentials });
    const { data, requestId } = await handler(client, request.input);
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
  SEARCH_FILES_ACTION_ID,
  searchFilesInputSchema,
  searchFilesOutputSchema,
} from "./schemas/search-files.js";
export type {
  ConnectionTestResult,
  ConnectorAction,
  ConnectorExecuteRequest,
  ConnectorExecutionResult,
  ConnectorManifest,
  DooConnector,
  OAuthCredentials,
} from "./types.js";
