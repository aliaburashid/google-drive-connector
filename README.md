# Google Drive Connector

Builders League (Cohort 01) — portable Google Drive connector for Alia Burashed.

**Status:** Milestone 7 — thin MCP adapter + OpenAPI 3.1.x.  
Not deployed. No `v1.0.0` release yet.

## Architecture

```
MCP tool / OpenAPI caller
        ↓
connector.execute()
        ↓
action (search / list / read / upload / share)
        ↓
DriveClient
        ↓
Google Drive API
```

**Golden rule:** No provider calls or duplicated business logic inside the MCP adapter.

| Layer | Role |
|---|---|
| **Connector core** (`src/connector.ts`) | Source of truth: OAuth, validation, approval, errors, actions |
| **Thin MCP adapter** (`src/mcp/`) | Discovers tools and forwards calls to `connector.execute()` only |
| **OpenAPI** (`openapi/openapi.yaml`) | Documents the existing connector contract (does not invent behavior) |

## What works now

- `testConnection`
- Five actions via `connector.execute()`
- Thin MCP tools for the same five actions
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
npm run test:connection
npm run test:search
npm run test:list-folder
npm run test:read
npm run test:upload -- --approve
npm run test:share -- --fileId=FILE_ID --email=you@example.com --approve
```

## Required actions

| Action | Status |
|---|---|
| `drive.search_files` | Implemented |
| `drive.list_folder` | Implemented |
| `drive.read_or_export_file` | Implemented |
| `drive.upload_file` | Implemented (approval required) |
| `drive.share_file` | Implemented (approval required) |
| Thin MCP adapter | Implemented (not deployed) |
| OpenAPI 3.1.x | Implemented |
| v1.0.0 / production host | Not started |
