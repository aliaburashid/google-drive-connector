/**
 * Safe sandbox share for drive.share_file.
 *
 * Refuses type=anyone / domain and requires an explicit recipient email.
 *
 * Usage:
 *   npm run test:share -- --fileId=FILE_ID --email=you@example.com --approve
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
  fileId?: string;
  email?: string;
  role: "reader" | "commenter";
} {
  let approve = false;
  let fileId: string | undefined;
  let email: string | undefined;
  let role: "reader" | "commenter" = "reader";
  for (const arg of argv) {
    if (arg === "--approve") approve = true;
    else if (arg.startsWith("--fileId=")) fileId = arg.slice("--fileId=".length);
    else if (arg.startsWith("--email=")) email = arg.slice("--email=".length);
    else if (arg.startsWith("--role=")) {
      const value = arg.slice("--role=".length);
      if (value === "reader" || value === "commenter") role = value;
      else throw new Error("Sandbox share only allows role=reader|commenter");
    }
  }
  return { approve, fileId, email, role };
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

console.error(
  JSON.stringify(
    {
      plannedWrite: "drive.share_file",
      fileId: args.fileId ?? null,
      type: "user",
      role: args.role,
      emailAddress: args.email ?? null,
      sendNotificationEmail: false,
      forbiddenInThisScript: ["anyone", "domain", "writer"],
      approvalProvided: args.approve,
    },
    null,
    2,
  ),
);

if (!args.fileId || !args.email) {
  console.error(
    "Sandbox share requires --fileId=... and --email=... for a user reader/commenter share. Not running.",
  );
  process.exit(2);
}

if (!args.approve) {
  console.error("Refusing to share without --approve");
  process.exit(2);
}

const result = await execute({
  actionId: "drive.share_file",
  input: {
    fileId: args.fileId,
    type: "user",
    role: args.role,
    emailAddress: args.email,
    sendNotificationEmail: false,
  },
  credentials,
  approval: {
    approved: true,
    note: `Local sandbox share of ${args.fileId} to ${args.email} as ${args.role}`,
  },
});

if (!result.ok) {
  console.error(JSON.stringify({ ok: false, error: result.error }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      actionId: result.actionId,
      data: result.data,
      requestId: result.requestId,
    },
    null,
    2,
  ),
);
