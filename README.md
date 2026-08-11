# Google Drive Connector

Builders League (Cohort 01) — portable Google Drive connector for Alia Burashed.

**Status:** Milestone 3 — `testConnection` + `drive.search_files`.  
Remaining actions, MCP adapter, and OpenAPI are not implemented yet.

## What works now

- Repository layout aligned with the league portable package
- `connector.yaml` manifest (provider, auth, scopes, risks)
- OAuth refresh-token helper
- `testConnection()` via Drive `about.get` (no side effects)
- `drive.search_files` through `execute()` with pagination and normalized errors

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
npm run test:search -- --q="name contains 'report' and trashed = false" --pageSize=5
```

Sandbox scripts print redacted results and never log client secrets or refresh tokens.

## Required actions

| Action | Status |
|---|---|
| `drive.search_files` | Implemented |
| `drive.list_folder` | Planned |
| `drive.read_or_export_file` | Planned |
| `drive.upload_file` | Planned |
| `drive.share_file` | Planned |
