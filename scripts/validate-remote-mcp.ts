/**
 * Check a remote Render MCP URL from your own laptop.
 *
 * Usage:
 *   npm run validate:remote-mcp -- --url=https://YOUR-SERVICE.onrender.com/mcp
 *
 * Prints step results only — never prints secrets or file contents.
 */

// MCP client used to talk to the remote server.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// Transport that speaks Streamable HTTP over the public /mcp URL.
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// The five required action IDs we expect to discover.
import { REQUIRED_ACTION_IDS } from "../src/types.ts";

/** Read --url=... from the CLI, or fall back to MCP_PUBLIC_URL + /mcp. */
function parseUrl(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith("--url=")) return arg.slice("--url=".length);
  }
  // Allow MCP_PUBLIC_URL=https://host (without /mcp) as a convenience.
  const envUrl = process.env.MCP_PUBLIC_URL?.replace(/\/$/, "");
  if (envUrl) return `${envUrl}/mcp`;
  console.error("Usage: npm run validate:remote-mcp -- --url=https://HOST/mcp");
  process.exit(2);
}

// The MCP endpoint we will test.
const mcpUrl = parseUrl(process.argv.slice(2));
// Remote must be HTTPS; localhost http is still allowed for local checks.
if (!mcpUrl.startsWith("https://") && !mcpUrl.startsWith("http://127.0.0.1")) {
  console.error("Refusing non-HTTPS remote URL (localhost http allowed for local checks).");
  process.exit(2);
}

// Parse origin so we can build /health on the same host.
const base = new URL(mcpUrl);
const healthUrl = `${base.origin}/health`;

// Step 1: is the Render service publicly reachable?
console.log(JSON.stringify({ step: "health", url: healthUrl }, null, 2));
const health = await fetch(healthUrl);
console.log(JSON.stringify({ ok: health.ok, status: health.status }, null, 2));
if (!health.ok) process.exit(1);

// Step 2: open an MCP client over Streamable HTTP.
const client = new Client({ name: "remote-mcp-validator", version: "0.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
await client.connect(transport);

try {
  // Step 3: discover tools — must be exactly the five Drive actions.
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

  // Step 4: safe read through remote MCP (search only).
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

  // Step 5: unapproved upload must be blocked by connector core.
  const unapproved = await client.callTool({
    name: "drive.upload_file",
    arguments: {
      name: "remote-unapproved.txt",
      mimeType: "text/plain",
      encoding: "utf-8",
      content: "should not upload",
    },
  });
  // Collect text parts from the MCP response so we can look for approval_required.
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

  // All checks passed.
  console.log(JSON.stringify({ ok: true, mcpUrl }, null, 2));
} finally {
  // Always close client/transport, even if a check failed.
  await client.close().catch(() => undefined);
  await transport.close().catch(() => undefined);
}
