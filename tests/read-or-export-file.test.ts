import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { chooseDelivery, parseReadOrExportFileInput } from "../src/actions/read-or-export-file.js";
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

describe("drive.read_or_export_file input parsing", () => {
  it("requires fileId", () => {
    assert.throws(
      () => parseReadOrExportFileInput({ format: "pdf" }),
      (err: unknown) =>
        err instanceof ConnectorError && err.normalized.code === "invalid_input",
    );
  });

  it("rejects unknown fields including fields", () => {
    assert.throws(
      () => parseReadOrExportFileInput({ fileId: "abc", fields: "id" }),
      (err: unknown) =>
        err instanceof ConnectorError && err.normalized.code === "invalid_input",
    );
  });

  it("rejects unknown export format aliases", () => {
    assert.throws(
      () => parseReadOrExportFileInput({ fileId: "abc", format: "zip" }),
      (err: unknown) =>
        err instanceof ConnectorError && err.normalized.code === "invalid_input",
    );
  });

  it("routes blob vs Workspace MIME types", () => {
    assert.equal(chooseDelivery("text/plain"), "download");
    assert.equal(chooseDelivery("image/jpeg"), "download");
    assert.equal(chooseDelivery("application/vnd.google-apps.document"), "export");
    assert.equal(chooseDelivery("application/vnd.google-apps.spreadsheet"), "export");
    assert.equal(chooseDelivery("application/vnd.google-apps.presentation"), "export");
  });
});

describe("drive.read_or_export_file via execute()", () => {
  it("marks read_or_export_file as implemented", () => {
    const action = listActions().find((a) => a.id === "drive.read_or_export_file");
    assert.ok(action);
    assert.equal(action.status, "implemented");
    assert.ok(manifest.implementedActions.includes("drive.read_or_export_file"));
  });

  it("downloads a normal blob/text file with alt=media", async () => {
    const fixture = loadFixture("read-blob-text.json") as {
      request: { input: Record<string, unknown> };
      metadata: unknown;
      mediaText: string;
    };

    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      (url) => {
        seen.push(url.pathname + url.search);
        return new Response(JSON.stringify(fixture.metadata), {
          status: 200,
          headers: { "Content-Type": "application/json", "x-request-id": "req-meta-blob" },
        });
      },
      (url) => {
        seen.push(url.pathname + url.search);
        return new Response(fixture.mediaText, {
          status: 200,
          headers: { "Content-Type": "text/plain", "x-request-id": "req-media-blob" },
        });
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.read_or_export_file",
        input: fixture.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, true);
      assert.match(seen[0] ?? "", /\/files\/file_sanitized_readme/);
      assert.doesNotMatch(seen[0] ?? "", /alt=media/);
      assert.match(seen[1] ?? "", /alt=media/);
      assert.doesNotMatch(seen[1] ?? "", /\/export/);

      const data = result.data as {
        delivery: string;
        encoding: string;
        content: string;
        truncated: boolean;
      };
      assert.equal(data.delivery, "download");
      assert.equal(data.encoding, "utf-8");
      assert.equal(data.content, "hello world\n");
      assert.equal(data.truncated, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("exports a Google Doc as PDF", async () => {
    const fixture = loadFixture("read-gdoc-export.json") as {
      request: { input: Record<string, unknown> };
      metadata: unknown;
      exportMimeType: string;
      mediaBase64: string;
    };

    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      (url) => {
        seen.push(url.pathname + url.search);
        return new Response(JSON.stringify(fixture.metadata), { status: 200 });
      },
      (url) => {
        seen.push(url.pathname + "?" + url.searchParams.toString());
        return new Response(Buffer.from(fixture.mediaBase64, "base64"), {
          status: 200,
          headers: { "Content-Type": fixture.exportMimeType },
        });
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.read_or_export_file",
        input: fixture.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, true);
      assert.match(seen[1] ?? "", /\/export/);
      assert.match(seen[1] ?? "", /mimeType=application%2Fpdf/);
      const data = result.data as {
        delivery: string;
        encoding: string;
        content: string;
        exportFormat: string;
      };
      assert.equal(data.delivery, "export");
      assert.equal(data.encoding, "base64");
      assert.equal(data.exportFormat, "pdf");
      assert.equal(data.content, fixture.mediaBase64);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("exports a Google Sheet as CSV", async () => {
    const fixture = loadFixture("read-gsheet-export.json") as {
      request: { input: Record<string, unknown> };
      metadata: unknown;
      exportMimeType: string;
      mediaText: string;
    };

    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      () => new Response(JSON.stringify(fixture.metadata), { status: 200 }),
      (url) => {
        seen.push(url.pathname + "?" + url.searchParams.toString());
        return new Response(fixture.mediaText, {
          status: 200,
          headers: { "Content-Type": fixture.exportMimeType },
        });
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.read_or_export_file",
        input: fixture.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, true);
      assert.match(seen[0] ?? "", /\/export/);
      assert.match(seen[0] ?? "", /mimeType=text%2Fcsv/);
      const data = result.data as { delivery: string; encoding: string; content: string };
      assert.equal(data.delivery, "export");
      assert.equal(data.encoding, "utf-8");
      assert.equal(data.content, fixture.mediaText);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("exports Google Slides using the default PDF format", async () => {
    const fixture = loadFixture("read-gslides-export.json") as {
      request: { input: Record<string, unknown> };
      metadata: unknown;
      exportMimeType: string;
      mediaBase64: string;
    };

    let exportMime: string | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      () => new Response(JSON.stringify(fixture.metadata), { status: 200 }),
      (url) => {
        exportMime = url.searchParams.get("mimeType");
        return new Response(Buffer.from(fixture.mediaBase64, "base64"), {
          status: 200,
          headers: { "Content-Type": fixture.exportMimeType },
        });
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.read_or_export_file",
        input: fixture.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, true);
      assert.equal(exportMime, "application/pdf");
      const data = result.data as { delivery: string; exportFormat?: string };
      assert.equal(data.delivery, "export");
      assert.equal(data.exportFormat, "pdf");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects unsupported export format without calling export", async () => {
    let secondCall = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      () =>
        new Response(
          JSON.stringify({
            id: "file_sanitized_gdoc",
            name: "Notes",
            mimeType: "application/vnd.google-apps.document",
            capabilities: { canDownload: true },
          }),
          { status: 200 },
        ),
      () => {
        secondCall = true;
        return new Response("should-not-run", { status: 200 });
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.read_or_export_file",
        input: { fileId: "file_sanitized_gdoc", format: "csv" },
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error?.code, "unsupported_export_type");
      assert.equal(secondCall, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects folders as unsupported file types", async () => {
    const fixture = loadFixture("read-unsupported-folder.json") as {
      request: { input: Record<string, unknown> };
      metadata: unknown;
    };

    let secondCall = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      () => new Response(JSON.stringify(fixture.metadata), { status: 200 }),
      () => {
        secondCall = true;
        return new Response("should-not-run", { status: 200 });
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.read_or_export_file",
        input: fixture.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error?.code, "unsupported_file_type");
      assert.equal(secondCall, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails when Google says the file cannot be downloaded", async () => {
    const fixture = loadFixture("read-cannot-download.json") as {
      request: { input: Record<string, unknown> };
      metadata: unknown;
    };

    let secondCall = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      () => new Response(JSON.stringify(fixture.metadata), { status: 200 }),
      () => {
        secondCall = true;
        return new Response("should-not-run", { status: 200 });
      },
    ]);

    try {
      const result = await execute({
        actionId: "drive.read_or_export_file",
        input: fixture.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error?.code, "download_not_allowed");
      assert.equal(secondCall, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes provider errors", async () => {
    const fixture = loadFixture("read-not-found.json") as {
      request: { input: Record<string, unknown> };
      providerHttpStatus: number;
      providerResponse: unknown;
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchSequence([
      () =>
        new Response(JSON.stringify(fixture.providerResponse), {
          status: fixture.providerHttpStatus,
          headers: { "Content-Type": "application/json", "x-request-id": "req-read-err" },
        }),
    ]);

    try {
      const result = await execute({
        actionId: "drive.read_or_export_file",
        input: fixture.request.input,
        credentials: fakeCredentials,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error?.retryClass, "fatal");
      assert.equal(result.error?.httpStatus, 404);
      assert.equal(result.requestId, "req-read-err");
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
        actionId: "drive.read_or_export_file",
        input: { format: "pdf" },
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
