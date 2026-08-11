import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseSearchFilesInput } from "../src/actions/search-files.js";
import { execute, listActions, manifest } from "../src/connector.js";
import { ConnectorError } from "../src/errors/normalize.js";
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

describe("drive.search_files input parsing", () => {
  it("accepts a valid query and pageSize", () => {
    const input = parseSearchFilesInput({
      q: "name contains 'report'",
      pageSize: 10,
    });
    assert.equal(input.q, "name contains 'report'");
    assert.equal(input.pageSize, 10);
  });

  it("rejects unknown fields", () => {
    assert.throws(
      () => parseSearchFilesInput({ q: "trashed = false", unexpected: true }),
      (err: unknown) =>
        err instanceof ConnectorError && err.normalized.code === "invalid_input",
    );
  });

  it("rejects out-of-range pageSize", () => {
    assert.throws(
      () => parseSearchFilesInput({ pageSize: 0 }),
      (err: unknown) =>
        err instanceof ConnectorError && err.normalized.code === "invalid_input",
    );
  });
});

describe("drive.search_files via execute()", () => {
  it("marks search_files as implemented in listActions/manifest", () => {
    const action = listActions().find((a) => a.id === "drive.search_files");
    assert.ok(action);
    assert.equal(action.status, "implemented");
    assert.deepEqual(manifest.implementedActions, ["drive.search_files"]);
  });

  it("returns sanitized fixture files and nextPageToken", async () => {
    const fixture = loadFixture("search-files-success.json") as {
      request: { input: Record<string, unknown> };
      providerResponse: unknown;
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      () =>
        new Response(JSON.stringify(fixture.providerResponse), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-request-id": "req-sanitized-001",
          },
        }),
    ]);

    try {
      const result = await execute({
        actionId: "drive.search_files",
        input: fixture.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, true);
      assert.equal(result.actionId, "drive.search_files");
      assert.equal(result.requestId, "req-sanitized-001");

      const data = result.data as {
        files: Array<{ id: string; name: string }>;
        nextPageToken?: string;
      };
      assert.equal(data.files.length, 2);
      assert.equal(data.files[0]?.id, "file_sanitized_001");
      assert.equal(data.nextPageToken, "sanitized-next-page-token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("passes pageToken through for pagination", async () => {
    const page2 = loadFixture("search-files-page-2.json") as {
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
        actionId: "drive.search_files",
        input: page2.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, true);
      assert.equal(seenPageToken, "sanitized-next-page-token");
      const data = result.data as { files: unknown[]; nextPageToken?: string };
      assert.equal(data.files.length, 1);
      assert.equal(data.nextPageToken, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes provider errors", async () => {
    const fixture = loadFixture("search-files-invalid-query.json") as {
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
            "x-request-id": "req-sanitized-err",
          },
        }),
    ]);

    try {
      const result = await execute({
        actionId: "drive.search_files",
        input: fixture.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error?.retryClass, "fatal");
      assert.equal(result.error?.httpStatus, 400);
      assert.equal(result.requestId, "req-sanitized-err");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns invalid_input without calling Drive", async () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };

    try {
      const result = await execute({
        actionId: "drive.search_files",
        input: { pageSize: 99999 },
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error?.code, "invalid_input");
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
