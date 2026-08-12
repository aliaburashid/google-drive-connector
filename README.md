# Google Drive Connector

Builders League (Cohort 01) — portable Google Drive connector for Alia Burashed.

**Status:** Milestone 6 — all five required actions implemented.  
MCP adapter and OpenAPI are not implemented yet.

## What works now

- `testConnection`
- `drive.search_files`
- `drive.list_folder`
- `drive.read_or_export_file`
- `drive.upload_file` (explicit approval required)
- `drive.share_file` (explicit approval required)

## Write approval

Consequential writes must pass `approval: { approved: true }` on `execute()`.  
If approval is missing, the connector returns `approval_required` and **does not call Google**.

Public sharing (`type=anyone`) also requires `allowPublicShare: true`.  
`anyone` + `writer` additionally requires `allowDangerousPublicWrite: true`.

Uploads are **not naturally idempotent**. Retries can create duplicate files; pass `idempotencyKey` for client-side tracking.

## Scripts

```bash
npm run typecheck
npm run build
npm test
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
