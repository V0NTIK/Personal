# Quadra Chess — controlled migration to Supabase and a dedicated GitHub repo

**Status:** PREPARED, NOT CUT OVER. Do not delete the original Render database yet.

## Architecture after migration

- **GitHub:** `V0NTIK/quadra-chess`, a dedicated repository with the contents of `four-player-chess/` at the new repository root.
- **Static frontend:** existing Render `quadra-chess` static site, same user-facing URL.
- **Node/WebSocket API:** existing Render `quadra-chess-api` service, same API URL.
- **Persistent database:** a new Supabase PostgreSQL project. Use `DATABASE_URL` **on the Render API only**.
- **Authentication:** existing Quadra accounts, password hashes, session hashes, recovery hashes and server-side auth logic are retained. Supabase Auth, Supabase Realtime and the public Data API are **not** used by the Quadra frontend.
- **Location:** Supabase `us-east-2` (Ohio) to match the Render API in Ohio.

A Supabase Free project has no arbitrary 30-day expiry, but **can pause after a week of low activity** and **has no included automatic backups**. Explicit exports/backup scheduling and recovery planning are required for public beta.

## 1. Create an empty GitHub repository

Create `V0NTIK/quadra-chess` with:
- Owner: `V0NTIK`.
- Repository name: `quadra-chess`.
- Visibility: **Private while preparing the beta**; change later if desired.
- Description: `Quadra Chess — four-player chess with multiplayer rooms, spectators, rankings and reviews.`
- Initialize with README: **Off**.
- Add .gitignore: **None** (included in source).
- Choose license: **None** until licensing is decided.

The connected GitHub action set cannot create a repository. Import existing folder history into that empty repo with Git:

```sh
git clone https://github.com/V0NTIK/Personal.git
cd Personal
git fetch origin quadra-supabase-cutover-prep
git subtree split --prefix=four-player-chess quadra-supabase-cutover-prep -b quadra-extracted
git remote add quadra https://github.com/V0NTIK/quadra-chess.git
git push -u quadra quadra-extracted:main
```

`git subtree split` includes only the Quadra folder and its related commit history. The prepared `.github/workflows/ci.yml` lands at the root of the new repo, and its test suite must pass there. No files from unrelated parts of the Personal repository are intentionally exported.

Do **not** delete the original folder or GitHub workflow before Render's two existing services deploy successfully from the dedicated repository.

## 2. Create a new Supabase project

- Organization: choose `V0NTIK's Org` (confirm in your account before creating).
- Project name: `quadra-chess`.
- Region: **Ohio / us-east-2**.
- Plan: **Free if your organization has remaining Free project capacity**, otherwise review the offered price first.
- Database password: generate a strong random password; store in a password manager and **do not commit or paste it in chat**.
- Use the standard managed PostgreSQL engine. No browser-side keys are required.

The fresh schema is in `supabase/migrations/20261110_000001_quadrachess_initial.sql`. Apply it once to the new Supabase database using a trusted SQL/migration tool. It creates the six application tables and indexes, enables RLS on all six tables, and revokes direct `anon`/`authenticated`/PUBLIC access.

Avoid exposing hashed passwords, account session hashes or room data through Supabase's Data API. The Node server retains responsibility for access checks.

## 3. Set up a maintenance window

The prepared API includes a dormant `MIGRATION_READ_ONLY` environment toggle. **Deploy this code before freezing database writes.**

1. Announce a brief interruption to beta testers and make sure no important match is running.
2. On Render's **quadra-chess-api** service, set `MIGRATION_READ_ONLY=1` **while DATABASE_URL still points to Render PostgreSQL**. The new deployment rejects API requests/WebSockets and pauses its clock and cleanup writes. `/health` still works and returns `"maintenance":true`.
3. Confirm the Render source database is no longer being written. The old database is the authoritative snapshot.
4. Save a secure full data backup **before importing**. Encrypt it and keep it off GitHub, especially because it includes password hashes and session hashes.

**Do not migrate live changing tables without a freeze**: account/session records, game clocks, ratings and room archives otherwise can diverge.

## 4. Transfer real rows, not just table structures

There are exactly six application tables:

1. `public.quadra_accounts`
2. `public.quadra_sessions`
3. `public.quadra_admin_bootstrap`
4. `public.quadra_player_stats`
5. `public.quadra_rated_results`
6. `public.quadra_rooms`

Import the account table **before** the sessions and stats tables because they reference account IDs. Preserve IDs, hashes, roles, `banned_at`, timestamps, room JSON, revision numbers, ratings and the `initial-superuser` bootstrap marker.

**Preferred:** Run the cross-connector, server-side data copy using the Render read-only Postgres query capability and Supabase SQL capability with the maintenance freeze active. Batch writes transactionally. Never echo credential hashes or sensitive records into the chat or logs.

**Alternative:** Use PostgreSQL native tools from a secure machine with network access. For a source database at Postgres 18, use a `pg_dump` client compatible with version 18. Because target versions may differ, precreate the schema from the migration file and perform a **data-only** restore to avoid importing incompatible Postgres internals.

An example (URLs passed via secure environment, never written to the repository):

```sh
# RENDER_DB_URL: Render External Database URL, for this secure migration machine.
# SUPABASE_DB_URL: Supabase Session Pooler connection string from Dashboard > Connect.
# Avoid shell history, screenshots and logs containing these secret URLs.
pg_dump --dbname="$RENDER_DB_URL" --data-only --format=custom \
  --no-owner --no-privileges \
  --table=public.quadra_accounts \
  --table=public.quadra_sessions \
  --table=public.quadra_admin_bootstrap \
  --table=public.quadra_player_stats \
  --table=public.quadra_rated_results \
  --table=public.quadra_rooms \
  --file=quadra-sensitive-data.dump

pg_restore --dbname="$SUPABASE_DB_URL" --data-only \
  --no-owner --no-privileges --single-transaction \
  --exit-on-error quadra-sensitive-data.dump
```

**Important:** `quadra-sensitive-data.dump` is confidential. Delete local temporary copies securely after a verified encrypted backup is made. Never commit it. Some environments restrict migration network access; if so, use the connected read-only/SQL actions instead.

## 5. Validate the destination before cutover

Run the SQL in `supabase/verify/counts.sql` on both source and target; every per-table count must match, including the bootstrap and ratings tables. Then run `supabase/verify/permissions.sql` only on the Supabase target; all six must have RLS enabled and no direct `anon` or `authenticated` SELECT privileges.

Also confirm:
- Existing accounts still have their original IDs and exact role values; the current `orlandowyman` superuser assignment is preserved if present.
- Game room JSON, seat token hashes, revision numbers, and archived games match.
- Valid, still-unexpired sessions were copied. Do not create a new empty bootstrap marker before importing the original accounts.
- No plain-text database password was committed to GitHub or delivered to a browser.

## 6. Reconnect Render to the new backend and repository

For **quadra-chess-api**, change the connected repository to `V0NTIK/quadra-chess`, branch `main`, and set its root directory to the **repository root** (not `four-player-chess`). Its commands remain `npm install` and `npm start`.

For **quadra-chess**, change the connected repository to `V0NTIK/quadra-chess`, branch `main`, root directory **repository root**, and static publish directory **`.`** if Render accepts that setting for your static site.

For **quadra-chess-api**, update `DATABASE_URL` to the Supabase **Session Pooler** URI (port 5432). Supabase's direct endpoint is IPv6-only without an IPv4 add-on; the session pooler works with Render's IPv4-capable environment. Copy the exact host, username, port and password from Supabase's **Connect** dialog. Do not construct the host by guessing the region.

Set `MIGRATION_READ_ONLY=0` **in the same cutover deployment**. Keep the previous Render DB connection recoverable for rollback. The existing static frontend keeps communicating with the same `quadra-chess-api.onrender.com` URL.

## 7. Release acceptance and rollback

Check:
- `GET https://quadra-chess-api.onrender.com/health`: `"ok":true`, `"storage":"postgres"`, `"maintenance":false`.
- Supabase SQL: new records appear after account creation and room creation.
- Log into existing accounts, verify the superuser role, ratings and leaderboards.
- Create a public and private room, join them, spectate, send a chat message as a signed-in player, play moves and verify persistence across a controlled API restart.
- Test restoring concurrent rooms after a browser refresh.
- Compare all six table counts or perform a reconciled source/target snapshot check. Destination may have NEW rows after opening; these should be explainable.
- Verify RLS stays enabled, privileges denied to Data API roles, and secrets remain exclusively on the server.

If any acceptance test fails, set maintenance on, restore Render's original `DATABASE_URL`, reconnect the previous code if needed, and redeploy. **Reconcile any new writes on Supabase before rolling back** rather than blindly discarding users' activity.

Only after sustained live verification and a tested backup/restore path should you remove the Render PostgreSQL database and delete Quadra from the Personal GitHub repository.

## Warnings and scope

- No source data has been copied until the connector-driven migration step is run and counts are verified.
- No database credentials may be placed in `.env.example`, static HTML/JS, version control, chat, or log output.
- Supabase does not eliminate PostgreSQL: it **hosts** PostgreSQL. Quadra's existing `pg` SQL queries still run server-side, against Supabase rather than Render.
- Supabase Free projects can pause due to inactivity and lack included automated backups. For a fully public beta, budget for reliable backups, monitoring and optionally a paid database tier.
