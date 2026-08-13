# Google Drive Connector

Builders League (Cohort 01) — portable Google Drive connector for Alia Burashed.

**Status:** Production-ready **v1.0.0** connector with remote HTTPS Streamable HTTP MCP on Render.

## Architecture

```
HTTPS /mcp (Streamable HTTP, local or Render)
        ↓
MCP adapter
        ↓
connector.execute()
        ↓
action (search / list / read / upload / share)
        ↓
DriveClient
        ↓
Google Drive API
```

**Golden rule:** No provider calls or duplicated business logic inside the MCP adapter or HTTP layer.

| Layer | Role |
|---|---|
| **Connector core** (`src/connector.ts`) | Source of truth: OAuth, validation, approval, errors, actions |
| **Thin MCP adapter** (`src/mcp/`) | Discovers tools and forwards calls to `connector.execute()` only |
| **HTTP host** (`src/mcp/http.ts`) | Streamable HTTP at `/mcp` only — no Google logic |
| **OpenAPI** (`openapi/openapi.yaml`) | Documents the existing connector contract (does not invent behavior) |

## What this connector provides

- Reusable connector core with `testConnection`, `listActions`, and `execute`
- Five required Drive actions through `connector.execute()`
- Thin MCP tools for the same five actions
- Streamable HTTP MCP at `/mcp` (local and Render)
- Health probe at `/health`
- OpenAPI 3.1.x contract at [`openapi/openapi.yaml`](openapi/openapi.yaml)

## Required actions (exact IDs)

- `drive.search_files`
- `drive.list_folder`
- `drive.read_or_export_file`
- `drive.upload_file`
- `drive.share_file`

Import the adapter from `google-drive-connector/mcp`:

```ts
import { createMcpAdapter, createGoogleDriveMcpServer } from "google-drive-connector/mcp";
```

## Local MCP HTTP

```bash
npm run start:mcp-http
```

- MCP: `http://127.0.0.1:8787/mcp`
- Health: `http://127.0.0.1:8787/health`
- Transport: official MCP **Streamable HTTP** (stateless)
- Credentials: environment only (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`)

```bash
npm run test:mcp-http
```

## Deployed MCP (Render)

Public HTTPS service (example):

- Base: `https://google-drive-mcp-hhd6.onrender.com`
- Health: `https://google-drive-mcp-hhd6.onrender.com/health`
- MCP: `https://google-drive-mcp-hhd6.onrender.com/mcp`

| Step | Command |
|---|---|
| **Build** | `npm ci --include=dev && npm run build` |
| **Start** | `npm start` → `node dist/mcp/http-entry.js` |

Use `--include=dev` on the build so TypeScript is installed even when `NODE_ENV=production`.

The process binds to Render’s `PORT` and `0.0.0.0` in production. Locally it defaults to `127.0.0.1:8787`.

### Environment variables (Render Environment / local `.env` only)

| Name | Required |
|---|---|
| `GOOGLE_CLIENT_ID` | Yes |
| `GOOGLE_CLIENT_SECRET` | Yes |
| `GOOGLE_REFRESH_TOKEN` | Yes |
| `MCP_PUBLIC_URL` | Strongly recommended (public HTTPS base URL, no `/mcp`) |
| `NODE_ENV` | `production` on Render |
| `GOOGLE_TOKEN_URL` | Optional |
| `LOG_LEVEL` | Optional (not required by this project today) |

Do **not** commit secrets. Do **not** put real credentials in `render.yaml` or README. Keep `.env` local and untracked.

OAuth uses the existing **refresh-token** flow at runtime (no browser callback during normal server operation).

Optional blueprint: [`render.yaml`](render.yaml) (secret env values marked `sync: false` must be filled in the dashboard).

### Validate from your own device

```bash
# Health
curl -sS https://google-drive-mcp-hhd6.onrender.com/health

# MCP discovery + safe read + unapproved write check
npm run validate:remote-mcp -- --url=https://google-drive-mcp-hhd6.onrender.com/mcp
```

Free Render instances may cold-start after idle (first request can be slow).

## Write approval

Consequential writes must pass `approval: { approved: true }` on `execute()` / MCP write tools.  
If approval is missing, the connector returns `approval_required` and **does not call Google**.

Public sharing (`type=anyone`) also requires `allowPublicShare: true`.  
`anyone` + `writer` additionally requires `allowDangerousPublicWrite: true`.

### drive.upload_file

Uploads are **not naturally idempotent**. Retries can create duplicate files.  
`idempotencyKey` is for caller-side correlation only.

### drive.share_file

- Not naturally idempotent; repeats may duplicate, update, or fail depending on Google ACL rules.
- If `sendNotificationEmail` is omitted for user/group, **Google defaults to sending** a notification.
- Explicit `false` disables the notification where Google permits.

## Known Limitations / Access Blockers

- Google Drive OAuth scope `https://www.googleapis.com/auth/drive` is **restricted** and may require Google verification for broader/public distribution.
- An OAuth consent app in **Testing** mode only allows configured test users.
- Shared-drive behavior may depend on the Google Workspace account/domain; personal Gmail accounts cannot fully exercise shared-drive scenarios.
- Organization/domain policies may block certain sharing operations (especially external shares).
- Large binary/base64 responses may be constrained by hosting or request/response size limits.
- Google Workspace `files.export` is limited to about **10MB**; this connector fails with `content_too_large` instead of silent truncation.
- Upload retries may create **duplicate files** because uploads are not naturally idempotent (`idempotencyKey` is client-side only).
- Share permission creates are not naturally idempotent; repeats may duplicate, update, or fail depending on Google ACL rules.

See also `connector.yaml` (`risks`, `access_blockers`) and the OpenAPI description.

## OpenAPI

- File: [`openapi/openapi.yaml`](openapi/openapi.yaml)
- Version: **OpenAPI 3.1.0**
- Documents `/v1/execute`, `/health`, the five action IDs, approval, normalized errors, pagination, rate-limit metadata, and encoding/safety notes.

## Scripts

```bash
npm run typecheck
npm run build
npm test
npm run test:mcp
npm run test:openapi
npm run test:mcp-http
npm run test:connection
npm run test:search
npm run test:list-folder
npm run test:read
npm run test:upload -- --approve
npm run test:share -- --fileId=FILE_ID --email=you@example.com --approve
npm run validate:remote-mcp -- --url=https://google-drive-mcp-hhd6.onrender.com/mcp
```
