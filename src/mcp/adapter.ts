/**
 * Thin MCP adapter over the portable connector core.
 *
 * Flow: MCP tool → connector.execute() → action → provider client → Google
 *
 * Golden rule: no provider calls or duplicated business logic inside the MCP adapter.
 */

import { execute as defaultExecute } from "../connector.js";
import type {
  ConnectorExecuteRequest,
  ConnectorExecutionResult,
  OAuthCredentials,
  RequiredActionId,
} from "../types.js";
import { REQUIRED_ACTION_IDS } from "../types.js";
import { getMcpServerInfo, listMcpTools, type McpToolDefinition } from "./tools.js";

export type McpExecuteFn = (
  request: ConnectorExecuteRequest,
) => Promise<ConnectorExecutionResult>;

export interface McpAdapterOptions {
  /** Credentials for connector.execute(). MCP does not implement OAuth. */
  getCredentials: () => OAuthCredentials | Promise<OAuthCredentials>;
  /**
   * Injectable execute for tests. Defaults to connector.execute.
   * MCP must never call the provider client or Google APIs itself.
   */
  execute?: McpExecuteFn;
}

export interface McpAdapter {
  listTools(): McpToolDefinition[];
  getServerInfo(): { name: string; version: string };
  callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<ConnectorExecutionResult>;
}

const META_KEYS = new Set(["approval", "idempotencyKey"]);

function isRequiredActionId(name: string): name is RequiredActionId {
  return (REQUIRED_ACTION_IDS as readonly string[]).includes(name);
}

function splitToolArguments(args: Record<string, unknown>): {
  input: Record<string, unknown>;
  approval?: ConnectorExecuteRequest["approval"];
  idempotencyKey?: string;
} {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (META_KEYS.has(key)) continue;
    input[key] = value;
  }

  const result: {
    input: Record<string, unknown>;
    approval?: ConnectorExecuteRequest["approval"];
    idempotencyKey?: string;
  } = { input };

  const approvalRaw = args.approval;
  if (approvalRaw !== undefined) {
    if (
      approvalRaw === null ||
      typeof approvalRaw !== "object" ||
      Array.isArray(approvalRaw)
    ) {
      throw new TypeError('MCP tool argument "approval" must be an object');
    }
    const approved = (approvalRaw as { approved?: unknown }).approved;
    const note = (approvalRaw as { note?: unknown }).note;
    result.approval = {
      approved: approved === true,
      ...(typeof note === "string" ? { note } : {}),
    };
  }

  if (typeof args.idempotencyKey === "string") {
    result.idempotencyKey = args.idempotencyKey;
  }

  return result;
}

/**
 * Create a thin MCP adapter that only forwards tool calls to connector.execute().
 */
export function createMcpAdapter(options: McpAdapterOptions): McpAdapter {
  const runExecute = options.execute ?? defaultExecute;

  return {
    listTools: listMcpTools,
    getServerInfo: getMcpServerInfo,
    async callTool(name, args = {}) {
      if (!isRequiredActionId(name)) {
        return {
          ok: false,
          actionId: name,
          error: {
            code: "unknown_action",
            message: `Unknown MCP tool "${name}". Expected one of: ${REQUIRED_ACTION_IDS.join(", ")}`,
            retryClass: "fatal",
          },
        };
      }

      const { input, approval, idempotencyKey } = splitToolArguments(args);
      const credentials = await options.getCredentials();

      const request: ConnectorExecuteRequest = {
        actionId: name,
        input,
        credentials,
        ...(approval !== undefined ? { approval } : {}),
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      };

      return runExecute(request);
    },
  };
}
