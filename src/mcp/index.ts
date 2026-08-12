/**
 * Thin MCP surface for the Google Drive connector.
 *
 * Golden rule: no provider calls or duplicated business logic inside the MCP adapter.
 */

export { createMcpAdapter, type McpAdapter, type McpAdapterOptions, type McpExecuteFn } from "./adapter.js";
export { zodObjectFromJsonSchema } from "./json-schema-to-zod.js";
export { createGoogleDriveMcpServer } from "./server.js";
export {
  getMcpServerInfo,
  listMcpTools,
  type McpToolDefinition,
} from "./tools.js";
