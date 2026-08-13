/**
 * Process entrypoint for the MCP HTTP server.
 *
 * Local:  npm run start:mcp-http  (runs this TypeScript file with tsx)
 * Render: npm start               (runs the compiled dist/mcp/http-entry.js)
 *
 * Reads Google credentials from environment variables. Never logs secret values.
 */

// File helpers: check if .env exists and read its text.
import { existsSync, readFileSync } from "node:fs";
// Build an absolute path to .env from the current working directory.
import { resolve } from "node:path";

// Reads GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN from process.env.
import { credentialsFromEnv } from "../connector.js";
// Starts the thin Express + Streamable HTTP /mcp host.
import {
  DEFAULT_MCP_HTTP_PORT,
  startMcpHttpServer,
} from "./http.js";
// Chooses host/port/allowlist for laptop vs Render.
import {
  resolveAllowedHosts,
  resolveListenHost,
  resolveListenPort,
} from "./listen-env.js";

/**
 * Load KEY=VALUE pairs from a local .env file into process.env.
 * On Render there is usually no .env file — dashboard env vars are used instead.
 */
function loadDotEnv(path = resolve(process.cwd(), ".env")): void {
  // Nothing to do if the file is missing (normal on Render).
  if (!existsSync(path)) return;
  // Read the whole file as one string.
  const text = readFileSync(path, "utf8");
  // Walk line by line.
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    // Skip blank lines and comments.
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Find the first "=" separating name and value.
    const eq = trimmed.indexOf("=");
    // Skip lines that are not KEY=VALUE.
    if (eq <= 0) continue;
    // Left side = variable name.
    const key = trimmed.slice(0, eq).trim();
    // Right side = variable value.
    let value = trimmed.slice(eq + 1).trim();
    // If the value is wrapped in quotes, strip them.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Never overwrite a value already set by the shell or Render.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Load local .env first (no-op when the file does not exist).
loadDotEnv();

// Pull OAuth credentials out of the environment.
const credentials = credentialsFromEnv();
// Build a list of missing required variable NAMES (not values).
const missing = [
  !credentials.clientId && "GOOGLE_CLIENT_ID",
  !credentials.clientSecret && "GOOGLE_CLIENT_SECRET",
  !credentials.refreshToken && "GOOGLE_REFRESH_TOKEN",
].filter(Boolean);
// Fail immediately with a clear message if anything is missing.
if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

// PORT from Render, or 8787 locally.
const port = resolveListenPort(process.env, DEFAULT_MCP_HTTP_PORT);
// 0.0.0.0 on Render, 127.0.0.1 on your laptop.
const host = resolveListenHost();
// Host allowlist from MCP_PUBLIC_URL / MCP_ALLOWED_HOSTS (may be undefined).
const allowedHosts = resolveAllowedHosts();

// Start Express + Streamable HTTP. Tool calls still go through connector.execute().
const started = await startMcpHttpServer({
  port,
  host,
  // Only pass allowedHosts when we actually resolved a list.
  ...(allowedHosts !== undefined ? { allowedHosts } : {}),
  // Adapter asks for credentials when a tool runs.
  getCredentials: () => credentialsFromEnv(),
});

// Safe startup logs (no secrets).
console.log(`Google Drive MCP (Streamable HTTP) listening on ${host}:${started.port}`);
console.log(`MCP endpoint path: /mcp`);
if (process.env.MCP_PUBLIC_URL) {
  console.log(`Public MCP URL: ${started.url}`);
}
console.log("Credentials loaded from environment (values not logged).");

/** Close the HTTP server cleanly when the process is asked to stop. */
async function shutdown(): Promise<void> {
  console.log("Shutting down MCP HTTP server...");
  await started.close();
  process.exit(0);
}

// Ctrl+C on your laptop.
process.on("SIGINT", () => {
  void shutdown();
});
// Render sends SIGTERM when it stops or redeploys the service.
process.on("SIGTERM", () => {
  void shutdown();
});
