import { DriveClient } from "./client.js";
import { normalizeError } from "./errors/normalize.js";
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

export const manifest: ConnectorManifest = {
  id: "google-drive",
  name: "Google Drive",
  version: "0.1.0",
  provider: "Google Drive API v3",
  authType: "oauth2",
  scopes: [DRIVE_SCOPE],
  requiredActions: REQUIRED_ACTION_IDS,
  implementedActions: [],
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
  return REQUIRED_ACTION_IDS.map((id) => ({
    id,
    ...ACTION_CATALOG[id],
    status: "planned",
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

  return {
    ok: false,
    actionId: request.actionId,
    error: {
      code: "not_implemented",
      message: `Action ${request.actionId} is planned but not implemented yet (Milestone 2 skeleton).`,
      retryClass: "fatal",
    },
  };
}

export const googleDriveConnector: DooConnector = {
  manifest,
  testConnection,
  listActions,
  execute,
};

export default googleDriveConnector;

// Re-export auth helpers for local scripts without exposing secrets in logs.
export { credentialsFromEnv, getAccessToken, refreshAccessToken } from "./auth/oauth.js";
export { ConnectorError, normalizeError } from "./errors/normalize.js";
export type {
  ConnectionTestResult,
  ConnectorAction,
  ConnectorExecuteRequest,
  ConnectorExecutionResult,
  ConnectorManifest,
  DooConnector,
  OAuthCredentials,
} from "./types.js";
