/**
 * Validate a remote HTTPS MCP endpoint from your own device.
 *
 * Usage:
 *   npm run validate:remote-mcp -- --url=https://YOUR-SERVICE.onrender.com/mcp
 *
 * Does not print secrets. Uses Streamable HTTP client only.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { REQUIRED_ACTION_IDS } from "../src/types.ts";

function parseUrl(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith("--url=")) return arg.slice("--url=".length);
  }
  const envUrl = process.env.MCP_PUBLIC_URL?.replace(/\/$/, "");
  if (envUrl) return `${envUrl}/mcp`;
  console.error("Usage: npm run validate:remote-mcp -- --url=https://HOST/mcp");
  process.exit(2);
}

const mcpUrl = parseUrl(process.argv.slice(2));
if (!mcpUrl.startsWith("https://") && !mcpUrl.startsWith("http://127.0.0.1")) {
  console.error("Refusing non-HTTPS remote URL (localhost http allowed for local checks).");
  process.exit(2);
}

const base = new URL(mcpUrl);
const healthUrl = `${base.origin}/health`;

console.log(JSON.stringify({ step: "health", url: healthUrl }, null, 2));
const health = await fetch(healthUrl);
console.log(JSON.stringify({ ok: health.ok, status: health.status }, null, 2));
if (!health.ok) process.exit(1);

const client = new Client({ name: "remote-mcp-validator", version: "0.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
await client.connect(transport);

try {
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  console.log(
    JSON.stringify(
      {
        step: "discover",
        count: listed.tools.length,
        tools: names,
        expected: [...REQUIRED_ACTION_IDS].sort(),
      },
      null,
      2,
    ),
  );
  if (listed.tools.length !== 5) process.exit(1);

  const read = await client.callTool({
    name: "drive.search_files",
    arguments: { q: "trashed = false", pageSize: 1 },
  });
  console.log(
    JSON.stringify(
      {
        step: "read_search",
        isError: read.isError === true,
      },
      null,
      2,
    ),
  );

  const unapproved = await client.callTool({
    name: "drive.upload_file",
    arguments: {
      name: "remote-unapproved.txt",
      mimeType: "text/plain",
      encoding: "utf-8",
      content: "should not upload",
    },
  });
  const text = unapproved.content
    .filter((part) => part.type === "text")
    .map((part) => ("text" in part ? part.text : ""))
    .join("");
  console.log(
    JSON.stringify(
      {
        step: "unapproved_upload",
        isError: unapproved.isError === true,
        approvalRequired: text.includes("approval_required"),
      },
      null,
      2,
    ),
  );
  if (!text.includes("approval_required")) process.exit(1);

  console.log(JSON.stringify({ ok: true, mcpUrl }, null, 2));
} finally {
  await client.close().catch(() => undefined);
  await transport.close().catch(() => undefined);
}
