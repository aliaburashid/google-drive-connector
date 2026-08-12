/**
 * Local sandbox check for drive.list_folder via connector.execute().
 * Loads credentials from .env — never prints secrets.
 *
 * Usage:
 *   npm run test:list-folder
 *   npm run test:list-folder -- --folderId=root
 *   npm run test:list-folder -- --folderId=1abc... --pageSize=5
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { credentialsFromEnv, execute } from "../src/connector.ts";

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

function parseArgs(argv: string[]): {
  folderId: string;
  pageSize: number;
  pageToken?: string;
} {
  let folderId = "root";
  let pageSize = 5;
  let pageToken: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--folderId=")) folderId = arg.slice("--folderId=".length);
    else if (arg.startsWith("--pageSize=")) {
      pageSize = Number(arg.slice("--pageSize=".length));
    } else if (arg.startsWith("--pageToken=")) {
      pageToken = arg.slice("--pageToken=".length);
    }
  }

  return {
    folderId,
    pageSize,
    ...(pageToken !== undefined ? { pageToken } : {}),
  };
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

const args = parseArgs(process.argv.slice(2));

const result = await execute({
  actionId: "drive.list_folder",
  input: {
    folderId: args.folderId,
    pageSize: args.pageSize,
    ...(args.pageToken !== undefined ? { pageToken: args.pageToken } : {}),
  },
  credentials,
});

if (!result.ok) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        actionId: result.actionId,
        error: {
          code: result.error?.code,
          message: result.error?.message,
          retryClass: result.error?.retryClass,
          httpStatus: result.error?.httpStatus,
        },
        requestId: result.requestId,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const data = result.data as {
  folderId: string;
  files: Array<{ id: string; name: string; mimeType?: string; modifiedTime?: string }>;
  nextPageToken?: string;
  incompleteSearch?: boolean;
};

console.log(
  JSON.stringify(
    {
      ok: true,
      actionId: result.actionId,
      folderId: data.folderId,
      fileCount: data.files.length,
      files: data.files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
      })),
      nextPageToken: data.nextPageToken ? "[present]" : undefined,
      incompleteSearch: data.incompleteSearch,
      requestId: result.requestId,
    },
    null,
    2,
  ),
);
