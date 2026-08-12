/**
 * Thin MCP tool catalog.
 *
 * Golden rule: no provider calls or duplicated business logic here.
 * Tools map 1:1 to connector action IDs and reuse existing JSON Schemas.
 */

import { listActions, manifest } from "../connector.js";
import {
  LIST_FOLDER_ACTION_ID,
  listFolderInputSchema,
} from "../schemas/list-folder.js";
import {
  READ_OR_EXPORT_FILE_ACTION_ID,
  readOrExportFileInputSchema,
} from "../schemas/read-or-export-file.js";
import {
  SEARCH_FILES_ACTION_ID,
  searchFilesInputSchema,
} from "../schemas/search-files.js";
import {
  SHARE_FILE_ACTION_ID,
  shareFileInputSchema,
} from "../schemas/share-file.js";
import {
  UPLOAD_FILE_ACTION_ID,
  uploadFileInputSchema,
} from "../schemas/upload-file.js";
import type { RequiredActionId } from "../types.js";
import { REQUIRED_ACTION_IDS } from "../types.js";

export interface McpToolDefinition {
  /** Exact connector action ID — also the MCP tool name. */
  name: RequiredActionId;
  description: string;
  approvalRequired: boolean;
  /** JSON Schema for tool arguments (action input + optional execute meta). */
  inputSchema: Record<string, unknown>;
}

const ACTION_INPUT_SCHEMAS: Record<RequiredActionId, Record<string, unknown>> = {
  [SEARCH_FILES_ACTION_ID]: searchFilesInputSchema as unknown as Record<string, unknown>,
  [LIST_FOLDER_ACTION_ID]: listFolderInputSchema as unknown as Record<string, unknown>,
  [READ_OR_EXPORT_FILE_ACTION_ID]:
    readOrExportFileInputSchema as unknown as Record<string, unknown>,
  [UPLOAD_FILE_ACTION_ID]: uploadFileInputSchema as unknown as Record<string, unknown>,
  [SHARE_FILE_ACTION_ID]: shareFileInputSchema as unknown as Record<string, unknown>,
};

const APPROVAL_PROPERTY = {
  type: "object",
  additionalProperties: false,
  required: ["approved"],
  properties: {
    approved: {
      type: "boolean",
      description:
        "Must be true for write actions. Enforced by connector.execute() before Google is called.",
    },
    note: {
      type: "string",
      description: "Optional human-readable approval note.",
    },
  },
  description: "Explicit write approval. Checked by the connector core, not by MCP.",
} as const;

const IDEMPOTENCY_KEY_PROPERTY = {
  type: "string",
  description:
    "Caller-supplied correlation key for external duplicate tracking. Google Drive does not deduplicate using this key.",
} as const;

function mcpInputSchemaFor(
  actionId: RequiredActionId,
  approvalRequired: boolean,
): Record<string, unknown> {
  const base = ACTION_INPUT_SCHEMAS[actionId];
  const baseProps =
    base.properties && typeof base.properties === "object"
      ? (base.properties as Record<string, unknown>)
      : {};

  return {
    ...base,
    $id: `${actionId}.mcp_tool_input`,
    additionalProperties: false,
    properties: {
      ...baseProps,
      ...(approvalRequired ? { approval: APPROVAL_PROPERTY } : {}),
      idempotencyKey: IDEMPOTENCY_KEY_PROPERTY,
    },
  };
}

/** Discoverable MCP tools for the five required Drive actions. */
export function listMcpTools(): McpToolDefinition[] {
  const catalog = new Map(listActions().map((action) => [action.id, action]));

  return REQUIRED_ACTION_IDS.map((actionId) => {
    const action = catalog.get(actionId);
    if (!action || action.status !== "implemented") {
      throw new Error(`MCP tool ${actionId} is not implemented in connector core`);
    }
    return {
      name: actionId,
      description: `${action.description} Routes through connector.execute(); MCP adds no Drive logic.`,
      approvalRequired: action.approvalRequired,
      inputSchema: mcpInputSchemaFor(actionId, action.approvalRequired),
    };
  });
}

export function getMcpServerInfo(): { name: string; version: string } {
  return {
    name: "google-drive-mcp-server",
    version: manifest.version,
  };
}
