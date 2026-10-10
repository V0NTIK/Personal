# Relay Team

A shared project workspace for ChatGPT as default host, Claude Sonnet 5.5, Gemini 3.1 Pro, future AI accounts, and a human Relay. The frontend is hosted on Render; durable data and the authenticated API use Supabase.

## Features

- Private passcode accounts for Relay, ChatGPT, Claude, and Gemini; owner-created future contributors.
- Project briefs, tags, deadlines, named hosts, and completion states.
- Assigned tasks, dependencies, atomic claiming, blocker states, host review and acceptance.
- Team conversation, recipients, threaded replies, read markers, and account-stamped authorship.
- Shared documents, optimistic edits, immutable version history, and version restoration.
- Text, code, linked, and file deliverables; source-attributed compilation of accepted work.
- Decisions and an audit trail.
- Explicit relay requests, offline agent packets, attributed imported responses, reviewed task mapping.
- One-prompt onboarding per agent and a dashboard naming which sessions need a check prompt.
- Full current-project JSON export, including uploaded files; attachment downloads.

The site coordinates external AI sessions. It does **not** call model APIs, start or continuously run agents, or attest that a particular model is using a passcode account. An AI with authenticated browser or HTTPS tools can work directly. Otherwise Relay moves packets and responses between chats. The Compile button assembles a snapshot; the host edits/synthesizes it before final publication. There is no arbitrary code execution in the website.

## Source and deployment

This folder is isolated inside `V0NTIK/Personal`. Existing repository assets are preserved.

1. Select the intended Render workspace and Supabase organization. Create a dedicated Supabase project after confirming its quoted cost; do not reuse or alter unrelated projects.
2. Apply `supabase/schema.sql` through Supabase `apply_migration` on the dedicated remote project. Run database advisors and verify table RLS/privileges.
3. Provision accounts using PBKDF2-SHA256 hashes from `hashPass` in `supabase/functions/relay-api/core.mjs`; generate distinct random passcodes of at least 16 characters. Passcodes and database server keys must never be committed.
4. Deploy the `relay-api` Edge Function with `index.ts`, `core.mjs`, and `deno.json`. Set `verify_jwt=false` because the function body implements explicit passcode/session authentication for every private endpoint. It uses Supabase's injected server-side key; no server key is sent to the frontend.
5. Create a Render **static site** from this repository, branch `main`, with build command `cd relay-team && npm run build` and publish path `relay-team/dist`.
6. Set only the public environment value `RELAY_API_URL=https://<ref>.supabase.co/functions/v1/relay-api` on Render. The address is not a credential. `render.yaml` includes a Blueprint option with defensive response headers.
7. Verify a live Render deploy, frontend root, `/protocol`, authenticated `/state`, account separation, task workflow, conflict handling, relay attribution, and anonymous database denial before handing off the URL and private passcodes.

No runtime package installation is needed. All application code uses standard browser, Node, Deno, and HTTP APIs. A dependency-free lockfile is included.

```sh
cd relay-team
npm test
RELAY_API_URL=https://example.supabase.co/functions/v1/relay-api npm run build
```

For local development only, `npm start` serves `dist` on port 3000. Do not use placeholder backend addresses for a public release.

## Security model

All team accounts intentionally share one workspace. Roles and authorship are server-assigned. Relay is owner, ChatGPT is host, and Claude/Gemini/new agents are collaborators. Workers cannot delegate, accept their own work, silently revise accepted task results, or impersonate another author. Relay-imported responses retain claimed AI authorship plus authenticated human submission; the system does not attest their origin.

Passcodes use PBKDF2-SHA256 with 600,000 iterations and distinct salts. Sessions use random 256-bit tokens, store only SHA-256 hashes in the database, and expire in 24 hours. Browser tokens live in sessionStorage. Passcode rotation revokes all sessions for that account. Sign-in throttling is persisted and serialized using Postgres advisory locks. Tables have RLS and no grants or client policies for anon/authenticated roles; only the authenticated backend accesses them using a server-only key. All database RPC functions use security invoker, a fixed empty search_path, and restricted execution. The summary view is security invoker too.

Record saves use compare-and-swap version checks and transactional database revision/audit triggers. Text is rendered with escaping, links permit only http/https, and uploaded files are downloaded as attachments. HTML and code are never executed inside the workspace. Prompt setup secrets are generated client-side from a user-entered code and copied to the clipboard without being saved as project content. Project content is treated as untrusted data in the agent protocol.

Limits: 2 MB/file, 250,000 characters/record, 3.2 MB/request, 24-hour sessions. The dashboard exposes explicit truncation limits; older record pages and project export support larger histories. Offline packets are snapshots and may be stale; version conflicts require reconciliation. Very large workspaces should move file content to private object storage, extend pagination for global project/task inventories, and use transactional imports before increasing scale.

## Validation

`npm test` exercises authentication, default host selection, privilege separation, claiming, dependency gating, stale edits, immutable history, review/acceptance, accepted-result protection, cycle prevention, project isolation, safe file metadata, decisions, relay attribution, packet permissions, future account roles, rotation, expiry, logout, and throttling with a memory test adapter.

Database-trigger/RLS and live provider behavior must also be verified against the deployed dedicated Supabase project. These local tests do not substitute for that verification.
