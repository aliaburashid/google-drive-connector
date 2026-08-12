import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseShareFileInput } from "../src/actions/share-file.js";
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

describe("drive.share_file input validation", () => {
  it("requires emailAddress for user shares", () => {
    assert.throws(
      () =>
        parseShareFileInput({
          fileId: "file1",
          type: "user",
          role: "reader",
        }),
      (err: unknown) =>
        err instanceof ConnectorError && err.normalized.code === "invalid_input",
    );
  });

  it("requires allowPublicShare for anyone", () => {
    assert.throws(
      () =>
        parseShareFileInput({
          fileId: "file1",
          type: "anyone",
          role: "reader",
        }),
      (err: unknown) =>
        err instanceof ConnectorError &&
        err.normalized.code === "public_share_not_allowed",
    );
  });

  it("requires allowDangerousPublicWrite for anyone+writer", () => {
    assert.throws(
      () =>
        parseShareFileInput({
          fileId: "file1",
          type: "anyone",
          role: "writer",
          allowPublicShare: true,
        }),
      (err: unknown) =>
        err instanceof ConnectorError &&
        err.normalized.code === "dangerous_public_write_not_allowed",
    );
  });

  it("accepts a safe user reader share", () => {
    const parsed = parseShareFileInput({
      fileId: "file1",
      type: "user",
      role: "reader",
      emailAddress: "sandbox.reader@example.com",
      sendNotificationEmail: false,
    });
    assert.equal(parsed.type, "user");
    assert.equal(parsed.role, "reader");
  });
});

describe("drive.share_file via execute()", () => {
  it("marks share_file as implemented with approvalRequired", () => {
    const action = listActions().find((a) => a.id === "drive.share_file");
    assert.ok(action);
    assert.equal(action.status, "implemented");
    assert.equal(action.approvalRequired, true);
    assert.ok(manifest.implementedActions.includes("drive.share_file"));
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
        actionId: "drive.share_file",
        input: {
          fileId: "file1",
          type: "user",
          role: "reader",
          emailAddress: "sandbox.reader@example.com",
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

  it("shares with a user as reader when approved", async () => {
    const fixture = loadFixture("share-file-user-reader.json") as {
      request: {
        input: Record<string, unknown>;
        approval: { approved: boolean };
      };
      providerResponse: unknown;
    };

    let pathname = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      (url) => {
        pathname = url.pathname;
        return new Response(JSON.stringify(fixture.providerResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.share_file",
        input: fixture.request.input,
        credentials: fakeCredentials,
        approval: fixture.request.approval,
      });

      assert.equal(result.ok, true);
      assert.match(pathname, /\/permissions$/);
      const data = result.data as {
        permission: { type: string; role: string; emailAddress?: string };
      };
      assert.equal(data.permission.type, "user");
      assert.equal(data.permission.role, "reader");
      assert.equal(data.permission.emailAddress, "sandbox.reader@example.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects missing email without calling Google", async () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };

    try {
      const result = await execute({
        actionId: "drive.share_file",
        input: { fileId: "file1", type: "user", role: "reader" },
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

  it("rejects public share without allowPublicShare and does not call Google", async () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };

    try {
      const result = await execute({
        actionId: "drive.share_file",
        input: { fileId: "file1", type: "anyone", role: "reader" },
        credentials: fakeCredentials,
        approval: { approved: true },
      });

      assert.equal(result.ok, false);
      assert.equal(result.error?.code, "public_share_not_allowed");
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes provider share failures", async () => {
    const fixture = loadFixture("share-file-not-found.json") as {
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
        }),
    ]);

    try {
      const result = await execute({
        actionId: "drive.share_file",
        input: fixture.request.input,
        credentials: fakeCredentials,
        approval: fixture.request.approval,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error?.httpStatus, 404);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
