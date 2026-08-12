/**
 * Shared connector types for the Google Drive portable package.
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive" as const;

export const REQUIRED_ACTION_IDS = [
  "drive.search_files",
  "drive.list_folder",
  "drive.read_or_export_file",
  "drive.upload_file",
  "drive.share_file",
] as const;

export type RequiredActionId = (typeof REQUIRED_ACTION_IDS)[number];

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Optional short-lived access token; refreshed automatically when missing/expired. */
  accessToken?: string;
}

export interface ConnectorManifest {
  id: string;
  name: string;
  version: string;
  provider: string;
  authType: "oauth2";
  scopes: string[];
  requiredActions: readonly RequiredActionId[];
  implementedActions: readonly string[];
  risks: string[];
  capabilities: {
    testConnection: boolean;
    listActions: boolean;
    execute: boolean;
    pagination: boolean;
    rateLimitMetadata: boolean;
  };
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  /** Present when ok === true */
  user?: {
    displayName?: string;
    emailAddress?: string;
    permissionId?: string;
  };
  storageQuota?: {
    limit?: string;
    usage?: string;
    usageInDrive?: string;
  };
  checkedAt: string;
  requestId?: string;
}

export type RetryClass =
  | "none"
  | "retryable"
  | "rate_limited"
  | "auth"
  | "fatal";

export interface NormalizedConnectorError {
  code: string;
  message: string;
  retryClass: RetryClass;
  httpStatus?: number;
  requestId?: string;
  provider?: {
    reason?: string;
    status?: string;
    details?: unknown;
  };
}

export interface ConnectorAction {
  id: string;
  name: string;
  description: string;
  approvalRequired: boolean;
  status: "planned" | "implemented";
}

export interface ConnectorExecuteRequest {
  actionId: string;
  input: Record<string, unknown>;
  credentials: OAuthCredentials;
  /**
   * Caller-supplied correlation/idempotency key for external duplicate tracking;
   * Google Drive does not deduplicate uploads using this key.
   */
  idempotencyKey?: string;
  /**
   * Explicit approval for consequential writes.
   * Enforced in connector.execute() before any Google write (`approved === true`).
   */
  approval?: { approved: boolean; note?: string };
}

export interface ConnectorExecutionResult {
  ok: boolean;
  actionId: string;
  data?: unknown;
  error?: NormalizedConnectorError;
  requestId?: string;
}

export interface DooConnector {
  manifest: ConnectorManifest;
  testConnection(credentials: OAuthCredentials): Promise<ConnectionTestResult>;
  listActions(): ConnectorAction[];
  execute(request: ConnectorExecuteRequest): Promise<ConnectorExecutionResult>;
}

/** Subset of Drive `about.get` used by testConnection. */
export interface DriveAboutResponse {
  user?: {
    displayName?: string;
    emailAddress?: string;
    permissionId?: string;
  };
  storageQuota?: {
    limit?: string;
    usage?: string;
    usageInDrive?: string;
  };
}
