import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createGoogleDriveMcpServer,
  createMcpAdapter,
  listMcpTools,
  zodObjectFromJsonSchema,
} from "../src/mcp/index.ts";
import type {
  ConnectorExecuteRequest,
  ConnectorExecutionResult,
  OAuthCredentials,
} from "../src/types.ts";
import { REQUIRED_ACTION_IDS } from "../src/types.ts";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), "../src/mcp");

const FAKE_CREDENTIALS: OAuthCredentials = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  refreshToken: "test-refresh-token",
};

/** Adapter/host library sources — excludes process entry (`http-entry.ts`). */
function readMcpLibrarySources(): string {
  return readdirSync(MCP_DIR)
    .filter((name) => name.endsWith(".ts") && name !== "http-entry.ts")
    .map((name) => readFileSync(join(MCP_DIR, name), "utf8"))
    .join("\n");
}

function readAllMcpSources(): string {
  return readdirSync(MCP_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(join(MCP_DIR, name), "utf8"))
    .join("\n");
}

describe("thin MCP adapter", () => {
  it("exposes exactly the five required MCP tools", () => {
    const tools = listMcpTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [...REQUIRED_ACTION_IDS],
    );
    assert.equal(tools.length, 5);
    for (const tool of tools) {
      assert.ok(tool.inputSchema);
      assert.equal(typeof tool.description, "string");
    }
  });

  it("exposes field-level action schemas for MCP discovery (not a free-form record)", () => {
    const tools = Object.fromEntries(listMcpTools().map((tool) => [tool.name, tool]));

    const searchProps = tools["drive.search_files"]?.inputSchema.properties as Record<
      string,
      unknown
    >;
    assert.ok(searchProps?.q);
    assert.ok(searchProps?.pageSize);
    assert.equal(searchProps?.fields, undefined);

    const listProps = tools["drive.list_folder"]?.inputSchema.properties as Record<
      string,
      unknown
    >;
    assert.ok(listProps?.folderId);

    const readProps = tools["drive.read_or_export_file"]?.inputSchema.properties as Record<
      string,
      unknown
    >;
    assert.ok(readProps?.fileId);

    const uploadProps = tools["drive.upload_file"]?.inputSchema.properties as Record<
      string,
      unknown
    >;
    assert.ok(uploadProps?.name);
    assert.ok(uploadProps?.mimeType);
    assert.ok(uploadProps?.content);
    assert.ok(uploadProps?.encoding);
    assert.ok(uploadProps?.approval);
    assert.ok(uploadProps?.idempotencyKey);

    const shareProps = tools["drive.share_file"]?.inputSchema.properties as Record<
      string,
      unknown
    >;
    assert.ok(shareProps?.fileId);
    assert.ok(shareProps?.type);
    assert.ok(shareProps?.role);
    assert.ok(shareProps?.approval);
    assert.ok(shareProps?.idempotencyKey);
  });

  it("registers MCP SDK tools with typed Zod schemas derived from action JSON Schemas", () => {
    const adapter = createMcpAdapter({
      getCredentials: () => FAKE_CREDENTIALS,
      execute: async (request) => ({ ok: true, actionId: request.actionId, data: {} }),
    });
    createGoogleDriveMcpServer(adapter);

    for (const tool of adapter.listTools()) {
      const zodSchema = zodObjectFromJsonSchema(tool.inputSchema);
      const json = toJsonSchemaCompat(zodSchema) as {
        type?: string;
        properties?: Record<string, unknown>;
      };
      assert.equal(json.type, "object");
      assert.ok(json.properties);
      const keys = Object.keys(json.properties);
      assert.ok(keys.length >= 1, `${tool.name} should expose field-level properties`);
      // Must not be an empty/generic additionalProperties-only schema.
      assert.ok(
        !keys.every((key) => key.startsWith("$")),
        `${tool.name} schema must include real input fields`,
      );

      if (tool.approvalRequired) {
        assert.ok(json.properties.approval, `${tool.name} must expose approval`);
        assert.ok(json.properties.idempotencyKey, `${tool.name} must expose idempotencyKey`);
      }
    }

    const searchJson = toJsonSchemaCompat(
      zodObjectFromJsonSchema(adapter.listTools().find((t) => t.name === "drive.search_files")!
        .inputSchema),
    ) as { properties?: Record<string, unknown> };
    assert.ok(searchJson.properties?.q);
    assert.ok(searchJson.properties?.pageSize);
    assert.equal(searchJson.properties?.fields, undefined);
  });

  it("marks write tools as approvalRequired", () => {
    const byName = new Map(listMcpTools().map((tool) => [tool.name, tool]));
    assert.equal(byName.get("drive.search_files")?.approvalRequired, false);
    assert.equal(byName.get("drive.list_folder")?.approvalRequired, false);
    assert.equal(byName.get("drive.read_or_export_file")?.approvalRequired, false);
    assert.equal(byName.get("drive.upload_file")?.approvalRequired, true);
    assert.equal(byName.get("drive.share_file")?.approvalRequired, true);
  });

  it("routes every tool call through connector.execute()", async () => {
    const seen: ConnectorExecuteRequest[] = [];
    const adapter = createMcpAdapter({
      getCredentials: () => FAKE_CREDENTIALS,
      execute: async (request) => {
        seen.push(request);
        return {
          ok: true,
          actionId: request.actionId,
          data: { routed: true, actionId: request.actionId },
        };
      },
    });

    for (const actionId of REQUIRED_ACTION_IDS) {
      const result = await adapter.callTool(actionId, {
        probe: true,
        ...(actionId === "drive.upload_file" || actionId === "drive.share_file"
          ? { approval: { approved: true, note: "test" } }
          : {}),
      });
      assert.equal(result.ok, true);
      assert.equal(result.actionId, actionId);
    }

    assert.equal(seen.length, 5);
    assert.deepEqual(
      seen.map((request) => request.actionId),
      [...REQUIRED_ACTION_IDS],
    );
    for (const request of seen) {
      assert.equal(request.credentials.clientId, FAKE_CREDENTIALS.clientId);
      assert.equal(request.input.probe, true);
      assert.equal("approval" in request.input, false);
    }
  });

  it("preserves connector outputs for read actions", async () => {
    const payload = {
      files: [{ id: "file_1", name: "Notes" }],
      nextPageToken: "page-2",
    };
    const adapter = createMcpAdapter({
      getCredentials: () => FAKE_CREDENTIALS,
      execute: async () =>
        ({
          ok: true,
          actionId: "drive.search_files",
          data: payload,
          requestId: "req-search-1",
        }) satisfies ConnectorExecutionResult,
    });

    const result = await adapter.callTool("drive.search_files", {
      q: "name contains 'Notes'",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, payload);
    assert.equal(result.requestId, "req-search-1");
  });

  it("preserves connector-core approval rejection for unapproved writes", async () => {
    let executeCalls = 0;
    const adapter = createMcpAdapter({
      getCredentials: () => FAKE_CREDENTIALS,
      execute: async (request) => {
        executeCalls += 1;
        if (request.approval?.approved !== true) {
          return {
            ok: false,
            actionId: request.actionId,
            error: {
              code: "approval_required",
              message: "approval required",
              retryClass: "fatal",
            },
          };
        }
        return { ok: true, actionId: request.actionId, data: { shared: true } };
      },
    });

    const denied = await adapter.callTool("drive.share_file", {
      fileId: "file_sanitized_001",
      type: "user",
      role: "reader",
      emailAddress: "sandbox.reader@example.com",
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.error?.code, "approval_required");
    assert.equal(executeCalls, 1);
    assert.equal(denied.error?.retryClass, "fatal");
  });

  it("rejects unapproved writes via real connector.execute without calling Google", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCalls += 1;
      return originalFetch(...args);
    }) as typeof fetch;

    try {
      const adapter = createMcpAdapter({
        getCredentials: () => FAKE_CREDENTIALS,
      });
      const result = await adapter.callTool("drive.upload_file", {
        name: "unapproved.txt",
        mimeType: "text/plain",
        encoding: "utf-8",
        content: "should not upload",
      });
      assert.equal(result.ok, false);
      assert.equal(result.error?.code, "approval_required");
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("forwards explicit approval to connector.execute for writes", async () => {
    let seen: ConnectorExecuteRequest | undefined;
    const adapter = createMcpAdapter({
      getCredentials: () => FAKE_CREDENTIALS,
      execute: async (request) => {
        seen = request;
        return { ok: true, actionId: request.actionId, data: { uploaded: true } };
      },
    });

    const result = await adapter.callTool("drive.upload_file", {
      name: "a.txt",
      mimeType: "text/plain",
      encoding: "utf-8",
      content: "hi",
      approval: { approved: true, note: "ok" },
      idempotencyKey: "upload-1",
    });

    assert.equal(result.ok, true);
    assert.equal(seen?.approval?.approved, true);
    assert.equal(seen?.approval?.note, "ok");
    assert.equal(seen?.idempotencyKey, "upload-1");
    assert.equal(seen?.input.name, "a.txt");
    assert.equal("approval" in (seen?.input ?? {}), false);
  });

  it("does not import DriveClient, OAuth helpers, or Google provider modules", () => {
    // Process entry may call credentialsFromEnv(); adapter/HTTP host must not.
    const source = readMcpLibrarySources();
    const importLines = source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("import "));

    const forbiddenImportSubstrings = [
      "../client",
      "../../client",
      "../auth/oauth",
      "../../auth/oauth",
      "../auth/approval",
      "googleapis",
      "DriveClient",
      "google-auth-library",
    ];
    for (const line of importLines) {
      for (const pattern of forbiddenImportSubstrings) {
        assert.equal(
          line.includes(pattern),
          false,
          `Forbidden MCP import pattern ${JSON.stringify(pattern)} in: ${line}`,
        );
      }
    }

    assert.equal(source.includes("fetch("), false, "MCP must not call fetch directly");
    assert.equal(source.includes("refreshAccessToken"), false);
    assert.equal(source.includes("credentialsFromEnv"), false);

    // Allowed: connector execute surface + schemas + MCP SDK + types
    assert.match(source, /from "\.\.\/connector\.js"/);
    assert.match(source, /@modelcontextprotocol\/sdk/);
  });

  it("reports MCP import surface for review", () => {
    const imports = [...readAllMcpSources().matchAll(/from\s+["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    const unique = [...new Set(imports)].sort();
    // Stable expected set — fail loudly if MCP gains provider imports.
    assert.deepEqual(unique, [
      "../connector.js",
      "../schemas/list-folder.js",
      "../schemas/read-or-export-file.js",
      "../schemas/search-files.js",
      "../schemas/share-file.js",
      "../schemas/upload-file.js",
      "../types.js",
      "./adapter.js",
      "./http.js",
      "./json-schema-to-zod.js",
      "./listen-env.js",
      "./server.js",
      "./tools.js",
      "@modelcontextprotocol/sdk/server/express.js",
      "@modelcontextprotocol/sdk/server/mcp.js",
      "@modelcontextprotocol/sdk/server/streamableHttp.js",
      "@modelcontextprotocol/sdk/shared/transport.js",
      "express",
      "node:fs",
      "node:http",
      "node:path",
      "zod",
    ]);
  });
});
