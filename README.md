# Google Drive Connector

Builders League (Cohort 01) — portable Google Drive connector for Alia Burashed.

**Status:** Milestone 2 — scaffold + OAuth + `testConnection` only.  
Actions, MCP adapter, and OpenAPI are intentionally not implemented yet.

## What works now

- Repository layout aligned with the league portable package
- `connector.yaml` manifest (provider, auth, scopes, risks)
- OAuth refresh-token helper
- `testConnection()` via Drive `about.get` (no side effects)
- Stub `listActions()` / `execute()` (actions marked planned)

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
npm run test:connection
```

`test:connection` prints a redacted success/failure result. It never logs client secrets or refresh tokens.

## Required actions (next milestones)

1. `drive.search_files`
2. `drive.list_folder`
3. `drive.read_or_export_file`
4. `drive.upload_file`
5. `drive.share_file`
