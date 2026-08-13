# Google Drive Connector

Builders League (Cohort 01) — portable Google Drive connector for Alia Burashed.

**Status:** Milestone 8B — remote HTTPS Streamable HTTP MCP on Render.  
No `v1.0.0` release yet. No Builders League submission yet.

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

## What works now

- `testConnection`
- Five actions via `connector.execute()`
- Thin MCP tools for the same five actions
- Local and production Streamable HTTP at `/mcp`
- OpenAPI 3.1.x contract at `openapi/openapi.yaml`

## MCP tools (exact action IDs)

- `drive.search_files`
- `drive.list_folder`
- `drive.read_or_export_file`
- `drive.upload_file`
- `drive.share_file`

Import the adapter from `google-drive-connector/mcp`:

```ts
import { createMcpAdapter, createGoogleDriveMcpServer } from "google-drive-connector/mcp";
```

Write approval remains enforced by **connector core**. MCP does not approve writes itself.  
Pass `approval: { approved: true }` on write tool args (same as `execute()`).

## Local MCP HTTP

```bash
npm run start:mcp-http
```

- Endpoint: `http://127.0.0.1:8787/mcp` (or `PORT` / `MCP_HTTP_HOST`)
- Transport: official MCP **Streamable HTTP** (stateless)
- Credentials: environment only (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`)

```bash
npm run test:mcp-http
```

## Deploy to Render (Milestone 8B)

Render hosts a **Node Web Service**. Render provides public **HTTPS**. Secrets stay in the Render dashboard — never in Git.

### Production commands

| Step | Command |
|---|---|
| **Build** | `npm ci && npm run build` |
| **Start** | `npm start` → `node dist/mcp/http-entry.js` |

The process binds to Render’s `PORT` and `0.0.0.0` in production. Locally it still defaults to `127.0.0.1:8787`.

### Required environment variables (Render Environment only)

| Name | Required |
|---|---|
| `GOOGLE_CLIENT_ID` | Yes |
| `GOOGLE_CLIENT_SECRET` | Yes |
| `GOOGLE_REFRESH_TOKEN` | Yes |
| `MCP_PUBLIC_URL` | Strongly recommended (`https://YOUR-SERVICE.onrender.com`) |
| `NODE_ENV` | Set to `production` on Render |
| `GOOGLE_TOKEN_URL` | Optional (only if you override Google’s token URL) |
| `LOG_LEVEL` | Optional (not required by this project today) |

Do **not** commit secrets. Do **not** put real credentials in `render.yaml`. Keep `.env` local and untracked.

OAuth uses the existing **refresh-token** flow at runtime (no browser callback during normal server operation).

### MCP endpoint

- Path: `/mcp`
- Health: `/health`
- Full URL shape: `https://YOUR-SERVICE.onrender.com/mcp`

Optional blueprint: [`render.yaml`](render.yaml) (env values marked `sync: false` must be filled in the dashboard).

### Validate from your own device

After deploy:

```bash
# Health
curl -sS https://YOUR-SERVICE.onrender.com/health

# MCP discovery + safe read + unapproved write check
npm run validate:remote-mcp -- --url=https://YOUR-SERVICE.onrender.com/mcp
```

Do not use the Builders League console for this validation.

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

## OpenAPI

- File: [`openapi/openapi.yaml`](openapi/openapi.yaml)
- Version: **OpenAPI 3.1.0**
- Documents `/v1/execute`, the five action IDs, approval, normalized errors, pagination, rate-limit metadata, and encoding/safety notes.

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
npm run validate:remote-mcp -- --url=https://HOST/mcp
```

## Required actions

| Action | Status |
|---|---|
| `drive.search_files` | Implemented |
| `drive.list_folder` | Implemented |
| `drive.read_or_export_file` | Implemented |
| `drive.upload_file` | Implemented (approval required) |
| `drive.share_file` | Implemented (approval required) |
| Thin MCP adapter | Implemented |
| Local Streamable HTTP `/mcp` | Implemented |
| OpenAPI 3.1.x | Implemented |
| Remote HTTPS on Render | Milestone 8B (deploy via Render dashboard) |
| v1.0.0 / handoff / submission | Not started |
