import { ConnectorError } from "../errors/normalize.js";
import type { ConnectorExecuteRequest } from "../types.js";

/**
 * Explicit approval for consequential writes.
 * Must be checked in the connector core before any provider call.
 */
export function assertWriteApproved(
  actionId: string,
  approval: ConnectorExecuteRequest["approval"],
): void {
  if (approval?.approved === true) {
    return;
  }

  throw new ConnectorError({
    code: "approval_required",
    message: `Action ${actionId} is a consequential write and requires explicit approval (approval.approved === true) before calling Google Drive.`,
    retryClass: "fatal",
  });
}
