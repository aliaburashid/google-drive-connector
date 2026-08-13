import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveAllowedHosts,
  resolveListenHost,
  resolveListenPort,
} from "../src/mcp/listen-env.ts";

describe("listen-env (local vs Render)", () => {
  it("defaults to localhost for local development", () => {
    assert.equal(resolveListenHost({}), "127.0.0.1");
    assert.equal(resolveListenPort({}, 8787), 8787);
    assert.equal(resolveAllowedHosts({}), undefined);
  });

  it("binds 0.0.0.0 when RENDER or production", () => {
    assert.equal(resolveListenHost({ RENDER: "true" }), "0.0.0.0");
    assert.equal(resolveListenHost({ NODE_ENV: "production" }), "0.0.0.0");
  });

  it("honors PORT and MCP_HTTP_HOST overrides", () => {
    assert.equal(resolveListenPort({ PORT: "10000" }, 8787), 10000);
    assert.equal(
      resolveListenHost({ MCP_HTTP_HOST: "0.0.0.0", NODE_ENV: "development" }),
      "0.0.0.0",
    );
  });

  it("derives allowedHosts from MCP_PUBLIC_URL", () => {
    assert.deepEqual(
      resolveAllowedHosts({
        MCP_PUBLIC_URL: "https://google-drive-mcp.onrender.com",
      }),
      ["google-drive-mcp.onrender.com"],
    );
  });

  it("honors MCP_ALLOWED_HOSTS list", () => {
    assert.deepEqual(
      resolveAllowedHosts({
        MCP_ALLOWED_HOSTS: "a.onrender.com, b.onrender.com",
      }),
      ["a.onrender.com", "b.onrender.com"],
    );
  });
});
