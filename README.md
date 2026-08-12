# Google Drive Connector

Builders League (Cohort 01) — portable Google Drive connector for Alia Burashed.

**Status:** Milestone 6 complete (DoD cleanup). All five required actions implemented.  
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

### drive.upload_file

Uploads are **not naturally idempotent**. Retries can create duplicate files.  
`idempotencyKey` on `execute()` is for caller-side correlation only — Google does not deduplicate with it.  
Provider/transient failures include `retryClass`; blind retries after an uncertain outcome may create duplicates.

### drive.share_file

Sharing is a consequential write and requires the same execute approval gate.

- **Idempotency:** `permissions.create` is not naturally idempotent. This connector does not coalesce repeats or guarantee a single permission. `idempotencyKey` is caller-side tracking only.
- **Duplicates / repeats:** repeating the same user/group share may create another permission, change an existing one, or fail with a provider error depending on Google’s ACL rules. Treat uncertain retries as potentially duplicate side effects.
- **Retry:** errors are normalized with `retryClass` (for example `retryable` or `rate_limited`). Do not blindly retry across an uncertain success/failure boundary.
- **sendNotificationEmail** (user/group only):
  - If omitted, the connector omits the query param and **Google defaults to sending** a notification email.
  - Explicit `false` disables the notification where Google permits.
  - Explicit `true` requests a notification (rejected for non user/group types).

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
