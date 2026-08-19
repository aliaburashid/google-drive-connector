# Google Drive Connector

A portable Google Drive connector built for Builders League Cohort 01. It exposes five Google Drive actions through a reusable connector core and a thin MCP adapter, with a remotely accessible MCP endpoint using Streamable HTTP.

**Status:** Released as **v1.0.0**, with a validated HTTPS Streamable HTTP MCP deployment on Render.

## At a glance

| | |
|---|---|
| **Provider** | Google Drive |
| **Actions** | 5 |
| **MCP transport** | Streamable HTTP |
| **Deployment** | Render HTTPS |
| **API contract** | OpenAPI 3.1.0 |
| **Release** | v1.0.0 |

## Actions

| Action | What it does |
|---|---|
| `drive.search_files` | Search Google Drive files |
| `drive.list_folder` | List files and folders inside a Drive folder |
| `drive.read_or_export_file` | Download normal files or export Google Workspace files |
| `drive.upload_file` | Upload a file to Google Drive |
| `drive.share_file` | Create a Drive sharing permission |

`drive.upload_file` and `drive.share_file` are write actions and require explicit approval before Google is contacted.

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

The connector core is the source of truth. MCP does not contain Google Drive business logic; it only exposes the existing connector actions to AI clients and forwards calls to `connector.execute()`.

**Golden rule:** No provider calls or duplicated business logic inside the MCP adapter or HTTP layer.

| Layer | Role |
|---|---|
| **Connector core** (`src/connector.ts`) | Source of truth: OAuth, validation, approval, errors, and actions |
| **Thin MCP adapter** (`src/mcp/`) | Discovers tools and forwards calls to `connector.execute()` |
| **HTTP host** (`src/mcp/http.ts`) | Serves Streamable HTTP at `/mcp` — no Google logic |
| **OpenAPI** (`openapi/openapi.yaml`) | Documents the existing connector contract |

## Deployed MCP

- Base: `https://google-drive-mcp-hhd6.onrender.com`
- Health: `https://google-drive-mcp-hhd6.onrender.com/health`
- MCP: `https://google-drive-mcp-hhd6.onrender.com/mcp`

An MCP-capable AI client can connect to the `/mcp` endpoint and discover the five Google Drive tools.

Free Render instances may cold-start after idle time, so the first request can be slow.

## Write safety

- Search, list, and read are read operations.
- Upload and share are write operations.
- Writes require `approval: { approved: true }`.
- Without approval, the connector returns `approval_required`.
- Google is not contacted until approval succeeds.

Public sharing (`type=anyone`) also requires `allowPublicShare: true`.  
`anyone` + `writer` additionally requires `allowDangerousPublicWrite: true`.

Uploads and shares are **not naturally idempotent**. Retries can duplicate files or permissions depending on Google’s rules. `idempotencyKey` is for caller-side correlation only.

If `sendNotificationEmail` is omitted for a user or group share, Google defaults to sending a notification. Set it to `false` to disable the email where Google allows that.

## Validation

v1.0.0 was validated at three levels.

### Automated

- 77/77 project tests passed
- 11/11 MCP tests passed
- 2/2 OpenAPI tests passed
- 5/5 MCP HTTP tests passed
- TypeScript typecheck passed
- Production build passed

### Remote MCP

Validated against the deployed Render endpoint:

- `/health` returned HTTP 200
- exactly five MCP tools discovered
- remote read/search succeeded
- unapproved upload returned `approval_required`

### Real AI client

The deployed MCP was also tested through Cursor as an MCP-capable AI client using natural-language requests.

- list folder — PASS
- search files — PASS
- read/export Google Doc — PASS
- unapproved upload — correctly blocked
- approved upload — PASS
- safe reader-only share — PASS

This validated the complete path: AI client → remote MCP → connector.execute() → Google Drive → result returned to the AI client.

## Local development

```bash
npm install
npm run typecheck
npm run build
npm test
npm run start:mcp-http
```

- MCP: `http://127.0.0.1:8787/mcp`
- Health: `http://127.0.0.1:8787/health`

Locally the process defaults to `127.0.0.1:8787`. On Render it binds to `PORT` and `0.0.0.0`.

### Useful test commands

```bash
npm run test:mcp
npm run test:openapi
npm run test:mcp-http
npm run test:connection
npm run test:search
npm run test:list-folder
npm run test:read
npm run test:upload -- --approve
npm run test:share -- --approve
npm run validate:remote-mcp -- --url=https://google-drive-mcp-hhd6.onrender.com/mcp
```

## Environment variables

Never commit `.env` or real credentials. Runtime OAuth uses the existing refresh-token flow (no browser callback during normal server operation).

**Required**

| Name | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | User-delegated refresh token |

**Optional**

| Name | Purpose |
|---|---|
| `GOOGLE_TOKEN_URL` | Override the Google token endpoint |
| `MCP_PUBLIC_URL` | Public HTTPS base URL (no `/mcp`); recommended on Render |
| `LOG_LEVEL` | Optional log level |
| `NODE_ENV` | Use `production` on Render |

Keep secrets in local `.env` or the Render dashboard only. Do not put real credentials in `render.yaml` or this README.

## OpenAPI

- OpenAPI **3.1.0**
- Location: [`openapi/openapi.yaml`](openapi/openapi.yaml)
- Documents the existing connector contract
- Does not define new connector behavior

OpenAPI documents the connector HTTP contract, while `/mcp` is the MCP Streamable HTTP transport used by AI clients.

## Known limitations

- Google Drive OAuth scope may require verification for broad or public distribution.
- Testing-mode OAuth only permits configured test users.
- Testing-mode Drive OAuth refresh tokens may have limited lifetimes and may need refreshing during extended sandbox testing.
- Shared-drive behavior depends on the Google account or Workspace domain; personal Gmail accounts cannot fully exercise shared-drive scenarios.
- Organization policies can block sharing, especially external shares.
- Large payloads are constrained by Google and hosting limits.
- Google Workspace export is limited to about **10 MB**; this connector fails with `content_too_large` instead of truncating silently.
