/**
 * Local sandbox check for drive.read_or_export_file via connector.execute().
 *
 * Usage:
 *   npm run test:read
 *   npm run test:read -- --fileId=1abc...
 *   npm run test:read -- --fileId=1abc... --format=pdf
 *
 * If --fileId is omitted, lists My Drive root and picks a small readable file.
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
  fileId?: string;
  format?: string;
  maxBytes?: number;
} {
  const out: { fileId?: string; format?: string; maxBytes?: number } = {};
  for (const arg of argv) {
    if (arg.startsWith("--fileId=")) out.fileId = arg.slice("--fileId=".length);
    else if (arg.startsWith("--format=")) out.format = arg.slice("--format=".length);
    else if (arg.startsWith("--maxBytes=")) {
      out.maxBytes = Number(arg.slice("--maxBytes=".length));
    }
  }
  return out;
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

let fileId = args.fileId;
if (!fileId) {
  const listed = await execute({
    actionId: "drive.list_folder",
    input: { folderId: "root", pageSize: 20 },
    credentials,
  });
  if (!listed.ok) {
    console.error(JSON.stringify({ ok: false, stage: "discover", error: listed.error }, null, 2));
    process.exit(1);
  }
  const files = (listed.data as { files: Array<{ id: string; mimeType?: string; name: string }> })
    .files;
  const workspace = files.find((f) =>
    [
      "application/vnd.google-apps.document",
      "application/vnd.google-apps.spreadsheet",
      "application/vnd.google-apps.presentation",
    ].includes(f.mimeType ?? ""),
  );
  const blob = files.find(
    (f) => f.mimeType && !f.mimeType.startsWith("application/vnd.google-apps."),
  );
  const chosen = workspace ?? blob;
  if (!chosen) {
    console.error("No readable file found in My Drive root. Pass --fileId explicitly.");
    process.exit(1);
  }
  fileId = chosen.id;
  console.error(`Auto-selected sandbox file: ${chosen.name} (${chosen.mimeType})`);
}

const result = await execute({
  actionId: "drive.read_or_export_file",
  input: {
    fileId,
    ...(args.format !== undefined ? { format: args.format } : {}),
    ...(args.maxBytes !== undefined ? { maxBytes: args.maxBytes } : {}),
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
  fileId: string;
  name: string;
  sourceMimeType: string;
  delivery: string;
  mimeType: string;
  encoding: string;
  content: string;
  sizeBytes: number;
  truncated: boolean;
  exportFormat?: string;
};

console.log(
  JSON.stringify(
    {
      ok: true,
      actionId: result.actionId,
      fileId: data.fileId,
      name: data.name,
      sourceMimeType: data.sourceMimeType,
      delivery: data.delivery,
      mimeType: data.mimeType,
      encoding: data.encoding,
      exportFormat: data.exportFormat,
      sizeBytes: data.sizeBytes,
      truncated: data.truncated,
      contentPreview:
        data.encoding === "utf-8"
          ? data.content.slice(0, 120)
          : `${data.content.slice(0, 48)}…`,
      requestId: result.requestId,
    },
    null,
    2,
  ),
);
