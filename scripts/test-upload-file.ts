/**
 * Safe sandbox upload for drive.upload_file.
 *
 * Always requires --approve to send the write.
 *
 * Usage:
 *   npm run test:upload -- --approve
 *   npm run test:upload -- --approve --name=my-test.txt --parent=FOLDER_ID
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseArgs(argv: string[]): {
  approve: boolean;
  name: string;
  parent?: string;
} {
  let approve = false;
  let name = `connector-sandbox-upload-${Date.now()}.txt`;
  let parent: string | undefined;
  for (const arg of argv) {
    if (arg === "--approve") approve = true;
    else if (arg.startsWith("--name=")) name = arg.slice("--name=".length);
    else if (arg.startsWith("--parent=")) parent = arg.slice("--parent=".length);
  }
  return { approve, name, ...(parent !== undefined ? { parent } : {}) };
}

loadDotEnv();
const credentials = credentialsFromEnv();
const missing = [
  !credentials.clientId && "GOOGLE_CLIENT_ID",
  !credentials.clientSecret && "GOOGLE_CLIENT_SECRET",
  !credentials.refreshToken && "GOOGLE_REFRESH_TOKEN",
].filter(Boolean);
if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const content = `Builders League sandbox upload\ncreatedAt=${new Date().toISOString()}\n`;

console.error(
  JSON.stringify(
    {
      plannedWrite: "drive.upload_file",
      name: args.name,
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(content, "utf8"),
      parent: args.parent ?? null,
      approvalProvided: args.approve,
    },
    null,
    2,
  ),
);

if (!args.approve) {
  console.error("Refusing to upload without --approve");
  process.exit(2);
}

const result = await execute({
  actionId: "drive.upload_file",
  input: {
    name: args.name,
    mimeType: "text/plain",
    encoding: "utf-8",
    content,
    ...(args.parent !== undefined ? { parents: [args.parent] } : {}),
    uploadStrategy: "auto",
  },
  credentials,
  approval: {
    approved: true,
    note: "Local sandbox upload of a harmless text file",
  },
  idempotencyKey: `sandbox-upload-${args.name}`,
});

if (!result.ok) {
  console.error(JSON.stringify({ ok: false, error: result.error }, null, 2));
  process.exit(1);
}

const data = result.data as {
  file: { id: string; name: string; webViewLink?: string; parents?: string[] };
  uploadStrategy: string;
  sizeBytes: number;
};

console.log(
  JSON.stringify(
    {
      ok: true,
      actionId: result.actionId,
      fileId: data.file.id,
      name: data.file.name,
      parents: data.file.parents,
      webViewLink: data.file.webViewLink,
      uploadStrategy: data.uploadStrategy,
      sizeBytes: data.sizeBytes,
      requestId: result.requestId,
    },
    null,
    2,
  ),
);
