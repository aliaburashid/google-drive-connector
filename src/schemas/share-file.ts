/**
 * JSON Schema + types for drive.share_file.
 *
 * Public sharing (type=anyone) is high-risk. This connector requires
 * allowPublicShare=true in addition to execute approval. anyone+writer also
 * requires allowDangerousPublicWrite=true.
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
      description: "Whether Google should email the recipient (user/group shares).",
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
  },
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
}

export const PERMISSION_RESULT_FIELDS =
  "id, type, role, emailAddress, domain, allowFileDiscovery";
