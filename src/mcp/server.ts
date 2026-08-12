/**
 * Optional MCP SDK server wiring.
 *
 * Registers the five Drive tools and forwards every call to the thin adapter.
 * Does not call the provider client, OAuth helpers, or Google APIs.
 *
 * Tool inputSchema is derived from the real connector JSON Schemas (including
 * approval / idempotencyKey for writes) so MCP discovery shows typed fields.
 * Execution still routes only through connector.execute().
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { McpAdapter } from "./adapter.js";
import { zodObjectFromJsonSchema } from "./json-schema-to-zod.js";

/**
 * Build an MCP server whose tools all delegate to {@link McpAdapter.callTool}.
 * Does not start a transport (no deployment).
 */
export function createGoogleDriveMcpServer(adapter: McpAdapter): McpServer {
  const info = adapter.getServerInfo();
  const server = new McpServer({
    name: info.name,
    version: info.version,
  });

  for (const tool of adapter.listTools()) {
    const inputSchema = zodObjectFromJsonSchema(tool.inputSchema);

    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema,
        annotations: {
          readOnlyHint: !tool.approvalRequired,
          destructiveHint: tool.approvalRequired,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (args) => {
        const result = await adapter.callTool(
          tool.name,
          args as Record<string, unknown>,
        );
        const text = JSON.stringify(result);
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: result as unknown as Record<string, unknown>,
          isError: result.ok !== true,
        };
      },
    );
  }

  return server;
}
