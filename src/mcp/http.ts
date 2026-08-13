/**
 * Thin HTTP host for the Google Drive MCP server (local or Render).
 *
 * Request path:
 *   HTTPS/HTTP /mcp
 *     → Streamable HTTP transport
 *     → MCP adapter
 *     → connector.execute()
 *     → action → DriveClient → Google Drive API
 *
 * This file only does HTTP + MCP wiring. It does not call Google itself.
 */

// Type for the Node HTTP server returned by app.listen().
import type { Server as HttpServer } from "node:http";

// Official MCP Streamable HTTP server transport.
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// Helper that creates an Express app with MCP-friendly defaults.
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
// Shared transport type used when connecting the MCP server.
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
// Express types for the app and request handlers.
import type { Express, Request, Response } from "express";

// Credential shape only — OAuth logic stays in connector/auth.
import type { OAuthCredentials } from "../types.js";
// Thin adapter: every tool call becomes connector.execute(...).
import { createMcpAdapter, type McpExecuteFn } from "./adapter.js";
// Host/allowlist helpers for laptop vs Render.
import { resolveAllowedHosts, resolveListenHost } from "./listen-env.js";
// Registers the five Drive tools on an MCP server instance.
import { createGoogleDriveMcpServer } from "./server.js";

// Local default port when PORT is not set.
export const DEFAULT_MCP_HTTP_PORT = 8787;
// Local default host (private to this machine).
export const DEFAULT_MCP_HTTP_HOST = "127.0.0.1";

/** Options needed to build the Express MCP app. */
export interface McpHttpAppOptions {
  /** How to load OAuth credentials (entrypoint reads them from env). */
  getCredentials: () => OAuthCredentials | Promise<OAuthCredentials>;
  /** Optional fake execute() for tests (skips real Google calls). */
  execute?: McpExecuteFn;
  /** Bind host; affects DNS-rebinding defaults in the MCP Express helper. */
  host?: string;
  /** Allowed Host header values when binding on 0.0.0.0 (Render). */
  allowedHosts?: string[];
}

/** Send a generic JSON-RPC error without leaking request details. */
function sendJsonRpcError(res: Response): void {
  // If we already started writing the response, do not write again.
  if (res.headersSent) return;
  res.status(500).json({
    jsonrpc: "2.0",
    error: {
      code: -32603,
      message: "Internal server error",
    },
    id: null,
  });
}

/** Reject methods that this stateless /mcp endpoint does not support. */
function methodNotAllowed(res: Response): void {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    }),
  );
}

/**
 * Build the Express app:
 * - GET  /health → simple alive check
 * - POST /mcp    → Streamable HTTP MCP
 */
export function createMcpHttpApp(options: McpHttpAppOptions): Express {
  // Use the caller's host, or fall back to localhost.
  const host = options.host ?? DEFAULT_MCP_HTTP_HOST;
  // Options object passed into the MCP Express helper.
  const appOptions: { host: string; allowedHosts?: string[] } = { host };
  // On Render we usually pass allowedHosts so only our public hostname is accepted.
  if (options.allowedHosts !== undefined && options.allowedHosts.length > 0) {
    appOptions.allowedHosts = options.allowedHosts;
  }
  // Create Express + JSON body parsing (from the MCP SDK helper).
  const app = createMcpExpressApp(appOptions);

  // Health endpoint for Render and for curl from your laptop.
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, service: "google-drive-mcp" });
  });

  // Main MCP endpoint: clients POST Streamable HTTP here.
  app.post("/mcp", async (req: Request, res: Response) => {
    // Fresh thin adapter for this request (still calls connector.execute).
    const adapter = createMcpAdapter({
      getCredentials: options.getCredentials,
      // Tests can inject a fake execute function here.
      ...(options.execute !== undefined ? { execute: options.execute } : {}),
    });
    // MCP server that exposes the five Drive tools.
    const server = createGoogleDriveMcpServer(adapter);
    try {
      // No sessionIdGenerator ⇒ stateless mode (SDK 1.30).
      const transport = new StreamableHTTPServerTransport();
      // Wire the MCP server to the HTTP transport.
      await server.connect(transport as unknown as Transport);
      // Let the transport read this HTTP request and write the HTTP response.
      await transport.handleRequest(req, res, req.body);
      // When the client disconnects, close transport + server to free memory.
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch {
      // Short log only — never print tokens, file bytes, or tool argument bodies.
      console.error("MCP HTTP POST /mcp failed");
      sendJsonRpcError(res);
    }
  });

  // Stateless server: GET /mcp is not used.
  app.get("/mcp", (_req: Request, res: Response) => {
    methodNotAllowed(res);
  });

  // Stateless server: DELETE /mcp is not used.
  app.delete("/mcp", (_req: Request, res: Response) => {
    methodNotAllowed(res);
  });

  return app;
}

/** startMcpHttpServer options = app options + optional port. */
export interface StartMcpHttpServerOptions extends McpHttpAppOptions {
  port?: number;
}

/** What you get back after the server is listening. */
export interface StartedMcpHttpServer {
  app: Express;
  server: HttpServer;
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/** Create the app and start listening (works for local and Render). */
export async function startMcpHttpServer(
  options: StartMcpHttpServerOptions,
): Promise<StartedMcpHttpServer> {
  // Resolve 127.0.0.1 locally or 0.0.0.0 in production/Render.
  const host = options.host ?? resolveListenHost();
  // Resolve PORT from the environment, or use the local default.
  const port = options.port ?? DEFAULT_MCP_HTTP_PORT;
  // Resolve Host allowlist from MCP_PUBLIC_URL when set.
  const allowedHosts = options.allowedHosts ?? resolveAllowedHosts();

  // Build the Express app with those settings.
  const app = createMcpHttpApp({
    getCredentials: options.getCredentials,
    host,
    ...(allowedHosts !== undefined ? { allowedHosts } : {}),
    ...(options.execute !== undefined ? { execute: options.execute } : {}),
  });

  // Wait until the TCP port is actually open.
  const server = await new Promise<HttpServer>((resolve, reject) => {
    // Bind host:port so clients (or Render's proxy) can reach us.
    const httpServer = app.listen(port, host, () => resolve(httpServer));
    // Surface listen errors (port busy, permission denied, etc.).
    httpServer.on("error", reject);
  });

  // Read the real bound address (important when tests use port 0).
  const address = server.address();
  const resolvedPort =
    address && typeof address === "object" ? address.port : port;

  // If MCP_PUBLIC_URL is set, prefer that for the logged/public MCP URL.
  const publicBase = process.env.MCP_PUBLIC_URL?.replace(/\/$/, "");
  const url =
    publicBase !== undefined && publicBase !== ""
      ? `${publicBase}/mcp`
      // When bound to 0.0.0.0, show 127.0.0.1 in local URLs for convenience.
      : `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${resolvedPort}/mcp`;

  return {
    app,
    server,
    host,
    port: resolvedPort,
    url,
    // Helper so callers can shut the listener down cleanly.
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
