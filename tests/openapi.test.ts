import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import SwaggerParser from "@apidevtools/swagger-parser";
import { parse as parseYaml } from "yaml";

import { REQUIRED_ACTION_IDS } from "../src/types.ts";

const OPENAPI_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../openapi/openapi.yaml",
);

describe("OpenAPI 3.1 connector contract", () => {
  it("is valid OpenAPI 3.1.x and documents the five action IDs", async () => {
    const raw = readFileSync(OPENAPI_PATH, "utf8");
    const doc = parseYaml(raw) as {
      openapi?: string;
      paths?: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };

    assert.ok(doc.openapi?.startsWith("3.1"), `expected OpenAPI 3.1.x, got ${doc.openapi}`);
    assert.ok(doc.paths?.["/v1/execute"]);
    assert.ok(doc.paths?.["/v1/test-connection"]);
    assert.ok(doc.paths?.["/v1/actions"]);

    const actionEnum = (
      doc.components?.schemas?.ConnectorExecuteRequest as {
        properties?: { actionId?: { enum?: string[] } };
      }
    )?.properties?.actionId?.enum;
    assert.deepEqual(actionEnum, [...REQUIRED_ACTION_IDS]);

    const api = await SwaggerParser.validate(OPENAPI_PATH);
    assert.ok(api);
  });

  it("documents approval, errors, pagination, and rate-limit schemas", () => {
    const doc = parseYaml(readFileSync(OPENAPI_PATH, "utf8")) as {
      components?: { schemas?: Record<string, unknown> };
    };
    const schemas = doc.components?.schemas ?? {};
    for (const name of [
      "Approval",
      "NormalizedConnectorError",
      "RateLimitMetadata",
      "FileListOutput",
      "UploadFileInput",
      "ShareFileInput",
      "ReadOrExportFileOutput",
    ]) {
      assert.ok(schemas[name], `missing schema ${name}`);
    }
  });
});
