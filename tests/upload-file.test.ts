import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseUploadFileInput,
  selectUploadStrategy,
} from "../src/actions/upload-file.js";
import { execute, listActions, manifest } from "../src/connector.js";
import { ConnectorError } from "../src/errors/normalize.js";
import { MULTIPART_MAX_BYTES } from "../src/schemas/upload-file.js";
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

describe("drive.upload_file input and strategy", () => {
  it("requires name/mimeType/content/encoding", () => {
    assert.throws(
      () => parseUploadFileInput({ name: "a.txt" }),
      (err: unknown) =>
        err instanceof ConnectorError && err.normalized.code === "invalid_input",
    );
  });

  it("selects multipart for small files and resumable for large", () => {
    assert.equal(selectUploadStrategy(100, "auto"), "multipart");
    assert.equal(selectUploadStrategy(MULTIPART_MAX_BYTES + 1, "auto"), "resumable");
    assert.equal(selectUploadStrategy(100, "resumable"), "resumable");
  });

  it("rejects forced multipart when content is too large", () => {
    assert.throws(
      () => selectUploadStrategy(MULTIPART_MAX_BYTES + 1, "multipart"),
      (err: unknown) =>
        err instanceof ConnectorError && err.normalized.code === "invalid_input",
    );
  });
});

describe("drive.upload_file via execute()", () => {
  it("marks upload_file as implemented with approvalRequired", () => {
    const action = listActions().find((a) => a.id === "drive.upload_file");
    assert.ok(action);
    assert.equal(action.status, "implemented");
    assert.equal(action.approvalRequired, true);
    assert.ok(manifest.implementedActions.includes("drive.upload_file"));
  });

  it("does not call Google when approval is missing", async () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };

    try {
      const result = await execute({
        actionId: "drive.upload_file",
        input: {
          name: "a.txt",
          mimeType: "text/plain",
          encoding: "utf-8",
          content: "hi",
        },
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error?.code, "approval_required");
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uploads successfully with multipart when approved", async () => {
    const fixture = loadFixture("upload-file-success.json") as {
      request: {
        input: Record<string, unknown>;
        approval: { approved: boolean };
      };
      providerResponse: unknown;
    };

    let seenUploadType: string | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      (url) => {
        seenUploadType = url.searchParams.get("uploadType");
        return new Response(JSON.stringify(fixture.providerResponse), {
          status: 200,
          headers: { "Content-Type": "application/json", "x-request-id": "req-up-1" },
        });
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.upload_file",
        input: fixture.request.input,
        credentials: fakeCredentials,
        approval: fixture.request.approval,
        idempotencyKey: "upload-key-1",
      });

      assert.equal(result.ok, true);
      assert.equal(seenUploadType, "multipart");
      const data = result.data as {
        file: { id: string; name: string };
        uploadStrategy: string;
        idempotency: { naturallyIdempotent: boolean; key?: string };
      };
      assert.equal(data.file.id, "file_sanitized_upload_001");
      assert.equal(data.uploadStrategy, "multipart");
      assert.equal(data.idempotency.naturallyIdempotent, false);
      assert.equal(data.idempotency.key, "upload-key-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("passes parent folder and uses multipart", async () => {
    const fixture = loadFixture("upload-file-with-parent.json") as {
      request: {
        input: Record<string, unknown>;
        approval: { approved: boolean };
      };
      providerResponse: unknown;
    };

    let bodyText = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      async (_url, init) => {
        const body = init?.body;
        if (body instanceof Uint8Array) {
          bodyText = new TextDecoder().decode(body);
        }
        return new Response(JSON.stringify(fixture.providerResponse), { status: 200 });
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.upload_file",
        input: fixture.request.input,
        credentials: fakeCredentials,
        approval: fixture.request.approval,
      });

      assert.equal(result.ok, true);
      assert.match(bodyText, /folder_sanitized_projects/);
      const data = result.data as { file: { parents?: string[] } };
      assert.deepEqual(data.file.parents, ["folder_sanitized_projects"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses resumable strategy for large content", async () => {
    const large = "a".repeat(MULTIPART_MAX_BYTES + 10);
    const originalFetch = globalThis.fetch;
    let firstUploadType: string | null = null;
    let secondMethod: string | null = null;

    globalThis.fetch = mockFetchSequence([
      (url) => {
        firstUploadType = url.searchParams.get("uploadType");
        return new Response(null, {
          status: 200,
          headers: {
            Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=session1",
          },
        });
      },
      (url, init) => {
        secondMethod = init?.method ?? "GET";
        assert.match(url.toString(), /upload_id=session1/);
        return new Response(
          JSON.stringify({
            id: "file_large",
            name: "large.txt",
            mimeType: "text/plain",
            size: String(large.length),
          }),
          { status: 200 },
        );
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.upload_file",
        input: {
          name: "large.txt",
          mimeType: "text/plain",
          encoding: "utf-8",
          content: large,
          uploadStrategy: "auto",
        },
        credentials: fakeCredentials,
        approval: { approved: true },
      });

      assert.equal(result.ok, true);
      assert.equal(firstUploadType, "resumable");
      assert.equal(secondMethod, "PUT");
      const data = result.data as { uploadStrategy: string };
      assert.equal(data.uploadStrategy, "resumable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes provider upload failures", async () => {
    const fixture = loadFixture("upload-file-forbidden.json") as {
      request: {
        input: Record<string, unknown>;
        approval: { approved: boolean };
      };
      providerHttpStatus: number;
      providerResponse: unknown;
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      () =>
        new Response(JSON.stringify(fixture.providerResponse), {
          status: fixture.providerHttpStatus,
          headers: { "Content-Type": "application/json" },
        }),
    ]);

    try {
      const result = await execute({
        actionId: "drive.upload_file",
        input: fixture.request.input,
        credentials: fakeCredentials,
        approval: fixture.request.approval,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error?.httpStatus, 403);
      assert.equal(result.error?.retryClass, "fatal");
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
      const result = await execute({
        actionId: "drive.upload_file",
        input: { name: "a.txt" },
        credentials: fakeCredentials,
        approval: { approved: true },
      });

      assert.equal(result.ok, false);
      assert.equal(result.error?.code, "invalid_input");
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
