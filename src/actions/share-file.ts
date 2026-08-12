import type { DriveClient } from "../client.js";
import { ConnectorError } from "../errors/normalize.js";
import {
  PERMISSION_RESULT_FIELDS,
  SHARE_FILE_ACTION_ID,
  SHARE_ROLES,
  SHARE_TYPES,
  type ShareFileInput,
  type ShareFileOutput,
} from "../schemas/share-file.js";
import {
  assertObjectInput,
  optionalBoolean,
  optionalEnum,
  optionalString,
  rejectUnknownKeys,
  requiredString,
} from "../schemas/validate.js";

const ALLOWED_KEYS = [
  "fileId",
  "type",
  "role",
  "emailAddress",
  "domain",
  "sendNotificationEmail",
  "allowPublicShare",
  "allowDangerousPublicWrite",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseShareFileInput(raw: unknown): ShareFileInput {
  assertObjectInput(raw, SHARE_FILE_ACTION_ID);
  rejectUnknownKeys(raw, ALLOWED_KEYS, SHARE_FILE_ACTION_ID);

  const type = optionalEnum(raw, "type", SHARE_TYPES, SHARE_FILE_ACTION_ID);
  const role = optionalEnum(raw, "role", SHARE_ROLES, SHARE_FILE_ACTION_ID);
  if (type === undefined || role === undefined) {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${SHARE_FILE_ACTION_ID}: "type" and "role" are required`,
      retryClass: "fatal",
    });
  }

  const parsed: ShareFileInput = {
    fileId: requiredString(raw, "fileId", SHARE_FILE_ACTION_ID),
    type,
    role,
  };

  const emailAddress = optionalString(raw, "emailAddress", SHARE_FILE_ACTION_ID);
  if (emailAddress !== undefined) parsed.emailAddress = emailAddress.trim();

  const domain = optionalString(raw, "domain", SHARE_FILE_ACTION_ID);
  if (domain !== undefined) parsed.domain = domain.trim();

  const sendNotificationEmail = optionalBoolean(
    raw,
    "sendNotificationEmail",
    SHARE_FILE_ACTION_ID,
  );
  if (sendNotificationEmail !== undefined) {
    parsed.sendNotificationEmail = sendNotificationEmail;
  }

  const allowPublicShare = optionalBoolean(raw, "allowPublicShare", SHARE_FILE_ACTION_ID);
  if (allowPublicShare !== undefined) parsed.allowPublicShare = allowPublicShare;

  const allowDangerousPublicWrite = optionalBoolean(
    raw,
    "allowDangerousPublicWrite",
    SHARE_FILE_ACTION_ID,
  );
  if (allowDangerousPublicWrite !== undefined) {
    parsed.allowDangerousPublicWrite = allowDangerousPublicWrite;
  }

  validateShareCombination(parsed);
  return parsed;
}

export function validateShareCombination(input: ShareFileInput): void {
  if (input.type === "user" || input.type === "group") {
    if (!input.emailAddress) {
      throw new ConnectorError({
        code: "invalid_input",
        message: `Action ${SHARE_FILE_ACTION_ID}: emailAddress is required when type=${input.type}`,
        retryClass: "fatal",
      });
    }
    if (!EMAIL_RE.test(input.emailAddress)) {
      throw new ConnectorError({
        code: "invalid_input",
        message: `Action ${SHARE_FILE_ACTION_ID}: emailAddress looks invalid`,
        retryClass: "fatal",
      });
    }
  }

  if (input.type === "domain") {
    if (!input.domain) {
      throw new ConnectorError({
        code: "invalid_input",
        message: `Action ${SHARE_FILE_ACTION_ID}: domain is required when type=domain`,
        retryClass: "fatal",
      });
    }
  }

  if (input.type === "anyone") {
    if (input.allowPublicShare !== true) {
      throw new ConnectorError({
        code: "public_share_not_allowed",
        message: `Action ${SHARE_FILE_ACTION_ID}: type=anyone requires allowPublicShare=true (in addition to execute approval)`,
        retryClass: "fatal",
      });
    }
    if (input.role === "writer" && input.allowDangerousPublicWrite !== true) {
      throw new ConnectorError({
        code: "dangerous_public_write_not_allowed",
        message: `Action ${SHARE_FILE_ACTION_ID}: anyone+writer requires allowDangerousPublicWrite=true`,
        retryClass: "fatal",
      });
    }
    if (input.emailAddress !== undefined || input.domain !== undefined) {
      throw new ConnectorError({
        code: "invalid_input",
        message: `Action ${SHARE_FILE_ACTION_ID}: emailAddress/domain are not used when type=anyone`,
        retryClass: "fatal",
      });
    }
  }

  if (input.type !== "user" && input.type !== "group" && input.sendNotificationEmail === true) {
    throw new ConnectorError({
      code: "invalid_input",
      message: `Action ${SHARE_FILE_ACTION_ID}: sendNotificationEmail is only valid for user/group shares`,
      retryClass: "fatal",
    });
  }
}

/**
 * Create a Drive permission. Caller must already have passed connector-core approval.
 */
export async function shareFile(
  client: DriveClient,
  rawInput: unknown,
): Promise<{ data: ShareFileOutput; requestId?: string }> {
  const input = parseShareFileInput(rawInput);

  const result = await client.createPermission({
    fileId: input.fileId,
    type: input.type,
    role: input.role,
    ...(input.emailAddress !== undefined ? { emailAddress: input.emailAddress } : {}),
    ...(input.domain !== undefined ? { domain: input.domain } : {}),
    ...(input.sendNotificationEmail !== undefined
      ? { sendNotificationEmail: input.sendNotificationEmail }
      : {}),
    fields: PERMISSION_RESULT_FIELDS,
  });

  const permission = result.data;
  if (!permission.id || !permission.type || !permission.role) {
    throw new ConnectorError({
      code: "invalid_provider_response",
      message: "Google Drive permission response missing id, type, or role",
      retryClass: "retryable",
      ...(result.requestId !== undefined ? { requestId: result.requestId } : {}),
    });
  }

  const output: ShareFileOutput = {
    fileId: input.fileId,
    permission: {
      id: permission.id,
      type: permission.type,
      role: permission.role,
      ...(permission.emailAddress !== undefined
        ? { emailAddress: permission.emailAddress }
        : {}),
      ...(permission.domain !== undefined ? { domain: permission.domain } : {}),
      ...(permission.allowFileDiscovery !== undefined
        ? { allowFileDiscovery: permission.allowFileDiscovery }
        : {}),
    },
    ...(input.sendNotificationEmail !== undefined
      ? { notification: { sendNotificationEmail: input.sendNotificationEmail } }
      : {}),
  };

  return {
    data: output,
    ...(result.requestId !== undefined ? { requestId: result.requestId } : {}),
  };
}
