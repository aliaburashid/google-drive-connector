# Google Drive Connector

Builders League (Cohort 01) — portable Google Drive connector for Alia Burashed.

**Status:** Milestone 5 — `testConnection` + search + list folder + read/export.  
Remaining actions, MCP adapter, and OpenAPI are not implemented yet.

## What works now

- Repository layout aligned with the league portable package
- `connector.yaml` manifest (provider, auth, scopes, risks)
- OAuth refresh-token helper
- `testConnection()` via Drive `about.get` (no side effects)
- `drive.search_files` through `execute()` with pagination and normalized errors
- `drive.list_folder` through `execute()` (direct children, `"root"` supported, trash excluded)
- `drive.read_or_export_file` through `execute()` (blob download or Workspace export)

## Setup

```bash
npm install
cp .env.example .env
# Fill GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
```

### Sandbox OAuth (once)

1. Create a Google Cloud project and enable **Google Drive API**.
2. Configure the OAuth consent screen (Testing + your sandbox user).
3. Create an OAuth client (Desktop or Web).
4. Complete the authorization-code flow with scope:

   `https://www.googleapis.com/auth/drive`

5. Store the refresh token in `.env` (never commit it).

## Scripts

```bash
npm run typecheck
npm run build
npm test
npm run test:connection
npm run test:search
npm run test:list-folder
npm run test:read
npm run test:read -- --fileId=FILE_ID --format=pdf
```

Sandbox scripts print redacted results and never log client secrets or refresh tokens.

## `drive.read_or_export_file`

Blob files (PDF, images, markdown, etc.) use `files.get?alt=media`.

Google Docs / Sheets / Slides / Drawings use `files.export` with connector-owned format aliases. `format` is only valid for those Workspace files; supplying it for a normal/blob file returns `invalid_input`.

| Source | Default | Also allowed |
|---|---|---|
| Google Doc | `pdf` | `docx`, `odt`, `rtf`, `txt`, `md`, `epub` |
| Google Sheet | `xlsx` | `pdf`, `ods`, `csv`, `tsv` |
| Google Slides | `pdf` | `pptx`, `odp`, `txt`, `png`, `jpeg`, `svg` |
| Google Drawing | `pdf` | `png`, `jpeg`, `svg` |

Binary content is returned as **base64**. Text-like MIME types (`text/*`, JSON, XML, SVG) are returned as **utf-8**. Oversized content fails with `content_too_large` (default cap 10 MiB, Google export limit). Folders, shortcuts, and `canDownload: false` are rejected.

## Required actions

| Action | Status |
|---|---|
| `drive.search_files` | Implemented |
| `drive.list_folder` | Implemented |
| `drive.read_or_export_file` | Implemented |
| `drive.upload_file` | Planned |
| `drive.share_file` | Planned |
