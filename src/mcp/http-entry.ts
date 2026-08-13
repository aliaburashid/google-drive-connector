/**
 * MCP Streamable HTTP process entry (compiled to dist/mcp/http-entry.js).
 *
 * Local:  npm run start:mcp-http
 * Render: npm start  →  node dist/mcp/http-entry.js
 *
 * Credentials come from environment variables only. Never log secret values.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { credentialsFromEnv } from "../connector.js";
import {
  DEFAULT_MCP_HTTP_PORT,
  startMcpHttpServer,
} from "./http.js";
import {
  resolveAllowedHosts,
  resolveListenHost,
  resolveListenPort,
} from "./listen-env.js";

function loadDotEnv(path = resolve(process.cwd(), ".env")): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const credentials = credentialsFromEnv();
const missing = [
  !credentials.clientId && "GOOGLE_CLIENT_ID",
  !credentials.clientSecret && "GOOGLE_CLIENT_SECRET",
  !credentials.refreshToken && "GOOGLE_REFRESH_TOKEN",
].filter(Boolean);
if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const port = resolveListenPort(process.env, DEFAULT_MCP_HTTP_PORT);
const host = resolveListenHost();
const allowedHosts = resolveAllowedHosts();

const started = await startMcpHttpServer({
  port,
  host,
  ...(allowedHosts !== undefined ? { allowedHosts } : {}),
  getCredentials: () => credentialsFromEnv(),
});

console.log(`Google Drive MCP (Streamable HTTP) listening on ${host}:${started.port}`);
console.log(`MCP endpoint path: /mcp`);
if (process.env.MCP_PUBLIC_URL) {
  console.log(`Public MCP URL: ${started.url}`);
}
console.log("Credentials loaded from environment (values not logged).");

async function shutdown(): Promise<void> {
  console.log("Shutting down MCP HTTP server...");
  await started.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
