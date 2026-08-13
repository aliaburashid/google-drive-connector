/**
 * Thin local/production Streamable HTTP host for the Google Drive MCP server.
 *
 * HTTP /mcp → StreamableHTTPServerTransport → MCP server/adapter → connector.execute()
 *
 * No provider calls or duplicated business logic in this layer.
 */

import type { Server as HttpServer } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Express, Request, Response } from "express";

import type { OAuthCredentials } from "../types.js";
import { createMcpAdapter, type McpExecuteFn } from "./adapter.js";
import { resolveAllowedHosts, resolveListenHost } from "./listen-env.js";
import { createGoogleDriveMcpServer } from "./server.js";

export const DEFAULT_MCP_HTTP_PORT = 8787;
export const DEFAULT_MCP_HTTP_HOST = "127.0.0.1";

export interface McpHttpAppOptions {
  /** Credentials for connector.execute(). Loaded from env by the entrypoint. */
  getCredentials: () => OAuthCredentials | Promise<OAuthCredentials>;
  /** Injectable execute for tests. Defaults to connector.execute via the adapter. */
  execute?: McpExecuteFn;
  /** Bind host used for DNS-rebinding protection defaults (localhost). */
  host?: string;
  /** Explicit Host allowlist when binding beyond localhost (e.g. Render). */
  allowedHosts?: string[];
}

function sendJsonRpcError(res: Response): void {
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
 * Build an Express app exposing MCP at POST /mcp (stateless Streamable HTTP).
 */
export function createMcpHttpApp(options: McpHttpAppOptions): Express {
  const host = options.host ?? DEFAULT_MCP_HTTP_HOST;
  const appOptions: { host: string; allowedHosts?: string[] } = { host };
  if (options.allowedHosts !== undefined && options.allowedHosts.length > 0) {
    appOptions.allowedHosts = options.allowedHosts;
  }
  const app = createMcpExpressApp(appOptions);

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, service: "google-drive-mcp" });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const adapter = createMcpAdapter({
      getCredentials: options.getCredentials,
      ...(options.execute !== undefined ? { execute: options.execute } : {}),
    });
    const server = createGoogleDriveMcpServer(adapter);
    try {
      // Omit sessionIdGenerator → stateless mode (SDK 1.30).
      const transport = new StreamableHTTPServerTransport();
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch {
      // Do not log request bodies, tokens, or tool arguments.
      console.error("MCP HTTP POST /mcp failed");
      sendJsonRpcError(res);
    }
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    methodNotAllowed(res);
  });

  app.delete("/mcp", (_req: Request, res: Response) => {
    methodNotAllowed(res);
  });

  return app;
}

export interface StartMcpHttpServerOptions extends McpHttpAppOptions {
  port?: number;
}

export interface StartedMcpHttpServer {
  app: Express;
  server: HttpServer;
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/**
 * Start the MCP HTTP server (local or Render).
 */
export async function startMcpHttpServer(
  options: StartMcpHttpServerOptions,
): Promise<StartedMcpHttpServer> {
  const host = options.host ?? resolveListenHost();
  const port = options.port ?? DEFAULT_MCP_HTTP_PORT;
  const allowedHosts = options.allowedHosts ?? resolveAllowedHosts();

  const app = createMcpHttpApp({
    getCredentials: options.getCredentials,
    host,
    ...(allowedHosts !== undefined ? { allowedHosts } : {}),
    ...(options.execute !== undefined ? { execute: options.execute } : {}),
  });

  const server = await new Promise<HttpServer>((resolve, reject) => {
    const httpServer = app.listen(port, host, () => resolve(httpServer));
    httpServer.on("error", reject);
  });

  const address = server.address();
  const resolvedPort =
    address && typeof address === "object" ? address.port : port;

  const publicBase = process.env.MCP_PUBLIC_URL?.replace(/\/$/, "");
  const url =
    publicBase !== undefined && publicBase !== ""
      ? `${publicBase}/mcp`
      : `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${resolvedPort}/mcp`;

  return {
    app,
    server,
    host,
    port: resolvedPort,
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
