import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { startMcpHttpServer } from "../src/mcp/http.ts";
import type {
  ConnectorExecuteRequest,
  ConnectorExecutionResult,
  OAuthCredentials,
} from "../src/types.ts";
import { REQUIRED_ACTION_IDS } from "../src/types.ts";

const FAKE_CREDENTIALS: OAuthCredentials = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  refreshToken: "test-refresh-token",
};

async function withMcpHttpClient(
  options: {
    execute?: (request: ConnectorExecuteRequest) => Promise<ConnectorExecutionResult>;
  },
  run: (client: Client, baseUrl: string) => Promise<void>,
): Promise<void> {
  const started = await startMcpHttpServer({
    host: "127.0.0.1",
    port: 0,
    getCredentials: () => FAKE_CREDENTIALS,
    ...(options.execute !== undefined ? { execute: options.execute } : {}),
  });

  const client = new Client({ name: "mcp-http-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(started.url));

  try {
    await client.connect(transport);
    await run(client, started.url);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await started.close();
  }
}

describe("local Streamable HTTP MCP (/mcp)", () => {
  it("starts and exposes /mcp and /health", async () => {
    const started = await startMcpHttpServer({
      host: "127.0.0.1",
      port: 0,
      getCredentials: () => FAKE_CREDENTIALS,
      execute: async (request) => ({ ok: true, actionId: request.actionId, data: {} }),
    });

    try {
      assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      const health = await fetch(
        `http://127.0.0.1:${started.port}/health`,
      );
      assert.equal(health.status, 200);
      const body = (await health.json()) as { ok?: boolean };
      assert.equal(body.ok, true);

      const response = await fetch(started.url, { method: "GET" });
      // Stateless server rejects GET with 405 Method Not Allowed (SDK pattern).
      assert.equal(response.status, 405);
    } finally {
      await started.close();
    }
  });

  it("discovers exactly five MCP tools", async () => {
    await withMcpHttpClient(
      {
        execute: async (request) => ({ ok: true, actionId: request.actionId, data: {} }),
      },
      async (client) => {
        const listed = await client.listTools();
        const names = listed.tools.map((tool) => tool.name).sort();
        assert.deepEqual(names, [...REQUIRED_ACTION_IDS].sort());
        assert.equal(listed.tools.length, 5);
      },
    );
  });

  it("routes a read tool through connector.execute()", async () => {
    const seen: ConnectorExecuteRequest[] = [];
    await withMcpHttpClient(
      {
        execute: async (request) => {
          seen.push(request);
          return {
            ok: true,
            actionId: request.actionId,
            data: {
              files: [{ id: "file_sanitized_001", name: "Notes" }],
            },
            requestId: "req-http-search",
          };
        },
      },
      async (client) => {
        const result = await client.callTool({
          name: "drive.search_files",
          arguments: { q: "name contains 'Notes'", pageSize: 5 },
        });
        assert.equal(result.isError, false);
        assert.equal(seen.length, 1);
        assert.equal(seen[0]?.actionId, "drive.search_files");
        assert.equal(seen[0]?.input.q, "name contains 'Notes'");
        assert.equal(seen[0]?.credentials.clientId, FAKE_CREDENTIALS.clientId);
        assert.equal("approval" in (seen[0]?.input ?? {}), false);
      },
    );
  });

  it("returns approval_required for unapproved writes via connector core", async () => {
    let executeCalls = 0;
    await withMcpHttpClient(
      {
        execute: async (request) => {
          executeCalls += 1;
          assert.notEqual(request.approval?.approved, true);
          return {
            ok: false,
            actionId: request.actionId,
            error: {
              code: "approval_required",
              message: "approval required",
              retryClass: "fatal",
            },
          };
        },
      },
      async (client) => {
        const result = await client.callTool({
          name: "drive.share_file",
          arguments: {
            fileId: "file_sanitized_001",
            type: "user",
            role: "reader",
            emailAddress: "sandbox.reader@example.com",
          },
        });
        assert.equal(result.isError, true);
        assert.equal(executeCalls, 1);
        const text = result.content
          .filter((part) => part.type === "text")
          .map((part) => ("text" in part ? part.text : ""))
          .join("");
        assert.match(text, /approval_required/);
      },
    );
  });

  it("rejects unapproved write via real connector.execute with zero Google API fetches", async () => {
    const originalFetch = globalThis.fetch;
    let googleFetchCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("googleapis.com") || url.includes("oauth2.googleapis.com")) {
        googleFetchCalls += 1;
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      await withMcpHttpClient({}, async (client) => {
        const result = await client.callTool({
          name: "drive.upload_file",
          arguments: {
            name: "unapproved.txt",
            mimeType: "text/plain",
            encoding: "utf-8",
            content: "should not upload",
          },
        });
        assert.equal(result.isError, true);
        const text = result.content
          .filter((part) => part.type === "text")
          .map((part) => ("text" in part ? part.text : ""))
          .join("");
        assert.match(text, /approval_required/);
        assert.equal(googleFetchCalls, 0);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
