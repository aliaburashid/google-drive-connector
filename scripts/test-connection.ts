/**
 * Local sandbox check for testConnection().
 * Loads credentials from .env / environment — never prints secrets.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  credentialsFromEnv,
  testConnection,
} from "../src/connector.ts";

function loadDotEnv(path = resolve(process.cwd(), ".env")): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const credentials = credentialsFromEnv();
const missing = [
  !credentials.clientId && "GOOGLE_CLIENT_ID",
  !credentials.clientSecret && "GOOGLE_CLIENT_SECRET",
  !credentials.refreshToken && "GOOGLE_REFRESH_TOKEN",
].filter(Boolean);

if (missing.length > 0) {
  console.error(
    `Missing env vars: ${missing.join(", ")}. Copy .env.example to .env and fill sandbox credentials.`,
  );
  process.exit(1);
}

const result = await testConnection(credentials);

if (result.ok) {
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        message: result.message,
        user: result.user
          ? {
              displayName: result.user.displayName,
              emailAddress: result.user.emailAddress,
            }
          : undefined,
        storageQuota: result.storageQuota,
        checkedAt: result.checkedAt,
        requestId: result.requestId,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.error(
  JSON.stringify(
    {
      ok: result.ok,
      message: result.message,
      checkedAt: result.checkedAt,
      requestId: result.requestId,
    },
    null,
    2,
  ),
);
process.exit(1);
