/**
 * JSON Schema + types for drive.share_file.
 *
 * Approval: consequential write. Requires execute approval (`approval.approved === true`)
 * before any Google call. Public sharing (type=anyone) also requires allowPublicShare=true.
 * anyone+writer additionally requires allowDangerousPublicWrite=true.
 *
 * Idempotency: permissions.create is NOT naturally idempotent. This connector does not
 * coalesce or guarantee a single permission for repeated executes. Callers may pass an
 * execute-level idempotencyKey for external tracking only; Google does not use it.
 *
 * Duplicate / repeated permission behavior: repeating the same user/group share may
 * create another permission, update an existing one, or fail with a provider error
 * depending on Google Drive rules and the current ACL. Treat uncertain retries as
 * potentially duplicate side effects; inspect the returned permission id.
 *
 * Retry: provider/transient failures are normalized with retryClass (e.g. retryable /
 * rate_limited). Do not blindly retry after an uncertain success/failure boundary.
 *
 * sendNotificationEmail (user/group only):
 * - If omitted, this connector omits the query param and Google defaults to sending
 *   a notification email for user/group shares.
 * - Explicit false disables the notification where Google permits.
 * - Explicit true requests a notification (user/group only; rejected for other types).
 */

export const SHARE_FILE_ACTION_ID = "drive.share_file" as const;

export const SHARE_TYPES = ["user", "group", "domain", "anyone"] as const;
export const SHARE_ROLES = ["reader", "commenter", "writer"] as const;

export const shareFileInputSchema = {
  $id: "drive.share_file.input",
  type: "object",
  additionalProperties: false,
  required: ["fileId", "type", "role"],
  properties: {
    fileId: {
      type: "string",
      minLength: 1,
      description: "File or folder ID to share.",
    },
    type: {
      type: "string",
      enum: SHARE_TYPES,
      description: "Permission type.",
    },
    role: {
      type: "string",
      enum: SHARE_ROLES,
      description: "Permission role.",
    },
    emailAddress: {
      type: "string",
      description: "Required for type=user and type=group.",
    },
    domain: {
      type: "string",
      description: "Required for type=domain.",
    },
    sendNotificationEmail: {
      type: "boolean",
      description:
        "User/group only. If omitted, Google defaults to sending a notification. Explicit false disables it where Google permits.",
    },
    allowPublicShare: {
      type: "boolean",
      description: "Required true when type=anyone (extra safety beyond execute approval).",
    },
    allowDangerousPublicWrite: {
      type: "boolean",
      description: "Required true when type=anyone and role=writer.",
    },
  },
  examples: [
    {
      fileId: "file_sanitized_upload_001",
      type: "user",
      role: "reader",
      emailAddress: "sandbox.reader@example.com",
      sendNotificationEmail: false,
    },
    {
      fileId: "file_sanitized_upload_001",
      type: "anyone",
      role: "reader",
      allowPublicShare: true,
    },
  ],
} as const;

export const shareFileOutputSchema = {
  $id: "drive.share_file.output",
  type: "object",
  additionalProperties: false,
  required: ["fileId", "permission"],
  properties: {
    fileId: { type: "string" },
    permission: {
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "role"],
      properties: {
        id: { type: "string" },
        type: { type: "string" },
        role: { type: "string" },
        emailAddress: { type: "string" },
        domain: { type: "string" },
        allowFileDiscovery: { type: "boolean" },
      },
    },
    notification: {
      type: "object",
      additionalProperties: false,
      properties: {
        sendNotificationEmail: { type: "boolean" },
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
      fileId: "file_sanitized_upload_001",
      permission: {
        id: "permission_sanitized_001",
        type: "user",
        role: "reader",
        emailAddress: "sandbox.reader@example.com",
      },
      notification: {
        sendNotificationEmail: false,
      },
    },
  ],
} as const;

export type ShareType = (typeof SHARE_TYPES)[number];
export type ShareRole = (typeof SHARE_ROLES)[number];

export interface ShareFileInput {
  fileId: string;
  type: ShareType;
  role: ShareRole;
  emailAddress?: string;
  domain?: string;
  sendNotificationEmail?: boolean;
  allowPublicShare?: boolean;
  allowDangerousPublicWrite?: boolean;
}

export interface ShareFileOutput {
  fileId: string;
  permission: {
    id: string;
    type: string;
    role: string;
    emailAddress?: string;
    domain?: string;
    allowFileDiscovery?: boolean;
  };
  notification?: {
    sendNotificationEmail?: boolean;
  };
  rateLimit?: {
    limit?: string;
    remaining?: string;
    reset?: string;
    retryAfter?: string;
  };
}

export const PERMISSION_RESULT_FIELDS =
  "id, type, role, emailAddress, domain, allowFileDiscovery";
