import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildListFolderQuery,
  parseListFolderInput,
} from "../src/actions/list-folder.js";
import { execute, listActions, manifest } from "../src/connector.js";
import { ConnectorError } from "../src/errors/normalize.js";
import { DEFAULT_SEARCH_FIELDS } from "../src/schemas/search-files.js";
import type { OAuthCredentials } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

const fakeCredentials: OAuthCredentials = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  refreshToken: "test-refresh-token",
  accessToken: "test-access-token",
};

function mockFetchSequence(
  handlers: Array<(url: URL, init?: RequestInit) => Promise<Response> | Response>,
): typeof fetch {
  let index = 0;
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    const handler = handlers[index++];
    if (!handler) {
      throw new Error(`Unexpected fetch call to ${url.toString()}`);
    }
    return handler(url, init);
  };
}

describe("drive.list_folder input parsing", () => {
  it("requires folderId", () => {
    assert.throws(
      () => parseListFolderInput({ pageSize: 10 }),
      (err: unknown) =>
        err instanceof ConnectorError && err.normalized.code === "invalid_input",
    );
  });

  it("rejects empty folderId", () => {
    assert.throws(
      () => parseListFolderInput({ folderId: "   " }),
      (err: unknown) =>
        err instanceof ConnectorError && err.normalized.code === "invalid_input",
    );
  });

  it("rejects unknown fields including fields", () => {
    assert.throws(
      () => parseListFolderInput({ folderId: "root", fields: "files(id)" }),
      (err: unknown) =>
        err instanceof ConnectorError && err.normalized.code === "invalid_input",
    );
  });

  it("accepts root and pageSize", () => {
    const input = parseListFolderInput({ folderId: "root", pageSize: 5 });
    assert.equal(input.folderId, "root");
    assert.equal(input.pageSize, 5);
  });

  it("builds a direct-children query that excludes trash", () => {
    assert.equal(
      buildListFolderQuery("root"),
      "'root' in parents and trashed = false",
    );
    assert.equal(
      buildListFolderQuery("folder_sanitized_projects"),
      "'folder_sanitized_projects' in parents and trashed = false",
    );
  });
});

describe("drive.list_folder via execute()", () => {
  it("marks list_folder as implemented", () => {
    const action = listActions().find((a) => a.id === "drive.list_folder");
    assert.ok(action);
    assert.equal(action.status, "implemented");
    assert.ok(manifest.implementedActions.includes("drive.list_folder"));
  });

  it("lists direct children and returns nextPageToken", async () => {
    const fixture = loadFixture("list-folder-success.json") as {
      request: { input: Record<string, unknown> };
      providerResponse: unknown;
    };

    let seenQ: string | null = null;
    let seenFields: string | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      (url) => {
        seenQ = url.searchParams.get("q");
        seenFields = url.searchParams.get("fields");
        return new Response(JSON.stringify(fixture.providerResponse), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-request-id": "req-list-001",
          },
        });
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.list_folder",
        input: fixture.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, true);
      assert.equal(result.requestId, "req-list-001");
      assert.equal(
        seenQ,
        "'folder_sanitized_projects' in parents and trashed = false",
      );
      assert.equal(seenFields, DEFAULT_SEARCH_FIELDS);

      const data = result.data as {
        folderId: string;
        files: Array<{ id: string; name: string }>;
        nextPageToken?: string;
      };
      assert.equal(data.folderId, "folder_sanitized_projects");
      assert.equal(data.files.length, 2);
      assert.equal(data.files[0]?.id, "file_sanitized_notes");
      assert.equal(data.nextPageToken, "sanitized-folder-next-page");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("lists My Drive root when folderId is root", async () => {
    const fixture = loadFixture("list-folder-root.json") as {
      request: { input: Record<string, unknown> };
      providerResponse: unknown;
    };

    let seenQ: string | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      (url) => {
        seenQ = url.searchParams.get("q");
        return new Response(JSON.stringify(fixture.providerResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.list_folder",
        input: fixture.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, true);
      assert.equal(seenQ, "'root' in parents and trashed = false");
      const data = result.data as { folderId: string; files: unknown[] };
      assert.equal(data.folderId, "root");
      assert.equal(data.files.length, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("passes pageToken through for pagination", async () => {
    const page2 = loadFixture("list-folder-page-2.json") as {
      request: { input: Record<string, unknown> };
      providerResponse: unknown;
    };

    let seenPageToken: string | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      (url) => {
        seenPageToken = url.searchParams.get("pageToken");
        return new Response(JSON.stringify(page2.providerResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.list_folder",
        input: page2.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, true);
      assert.equal(seenPageToken, "sanitized-folder-next-page");
      const data = result.data as { files: unknown[]; nextPageToken?: string };
      assert.equal(data.files.length, 1);
      assert.equal(data.nextPageToken, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes provider errors", async () => {
    const fixture = loadFixture("list-folder-not-found.json") as {
      request: { input: Record<string, unknown> };
      providerHttpStatus: number;
      providerResponse: unknown;
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      () =>
        new Response(JSON.stringify(fixture.providerResponse), {
          status: fixture.providerHttpStatus,
          headers: {
            "Content-Type": "application/json",
            "x-request-id": "req-list-err",
          },
        }),
    ]);

    try {
      const result = await execute({
        actionId: "drive.list_folder",
        input: fixture.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error?.retryClass, "fatal");
      assert.equal(result.error?.httpStatus, 404);
      assert.equal(result.requestId, "req-list-err");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns invalid_input without calling Google", async () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };

    try {
      const missing = await execute({
        actionId: "drive.list_folder",
        input: { pageSize: 10 },
        credentials: fakeCredentials,
      });
      const badFields = await execute({
        actionId: "drive.list_folder",
        input: { folderId: "root", fields: "files(id)" },
        credentials: fakeCredentials,
      });

      assert.equal(missing.ok, false);
      assert.equal(missing.error?.code, "invalid_input");
      assert.equal(badFields.ok, false);
      assert.equal(badFields.error?.code, "invalid_input");
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
