# Quadra Chess — persistence operations

**Provisioned database:** [quadra-chess-beta-db in Render](https://dashboard.render.com/d/dpg-dboivujl550s739t2meg-a)

**Multiplayer server:** [quadra-chess-api in Render](https://dashboard.render.com/web/srv-dboiemjl550s739re1i0)

**Database plan:** Render Postgres Free, PostgreSQL 18, Ohio (same region as the API).

**Expiration:** December 9, 2026 at 02:29 UTC. Render Free databases expire after 30 days, and there are no built-in backups. Upgrade or migrate before expiration to keep game records.

## Connection status and recovery

**Connected and verified on November 9, 2026.** The production API startup log reported `storage: postgres`, and later deployments continued using PostgreSQL. The following private setup steps are needed only if the database connection is replaced or lost. The current connector does not expose sensitive connection strings.

1. Open the **database** dashboard above and choose **Connect**.
2. Copy the **Internal Database URL**, **not** the External URL. Keep this URL private; it contains credentials.
3. Open the **quadra-chess-api** service dashboard above. Under **Environment**, add a **secret environment variable** called \`DATABASE_URL\`, whose value is the Internal Database URL from step 2. The secret belongs on the web service only, never in the static frontend, GitHub, README, or chat.
4. Save the environment change and allow Render to redeploy the service.
5. Open [API health](https://quadra-chess-api.onrender.com/health). Successful connection shows \`"storage":"postgres"\` rather than \`"storage":"memory"\`. Startup should initialize the \`quadra_rooms\` table. If the service does not come up, inspect build/runtime logs and verify the URL is Internal and both resources are in Ohio.

Do not put a database password in chat or commit one to the public repository.

## Verification

Create a private four-player room and note its invitation code. Join a second seat, then restart/redeploy the API via Render. Reconnect to the same room from the original browser tab using **Reconnect to my room**. The seat roster and position should survive a restart when \`storage=postgres\`. To test actual move recovery, join all four seats and make a move before restarting.

Rooms inactive for more than 29 days expire automatically. Free database expiry (30 days after provisioning) overrides this retention and can delete all rooms. The current release stores up to eight earlier matches per room after rematches, but these archives share the room and database expiration limitations. Download them before expiration.

## Clock semantics

- Online room creators can select unlimited, 5+0, 10+0, 15+10, or 30+0.
- Each player has an independent clock; only the active player's clock runs.
- Time starts once all four seats are **claimed**. A missing/offline player does not pause the clock.
- The backend uses server timestamps, validates moves and timeout flags, and may eliminate a player whose clock has expired.
- For 15+10, a 10-second increment is added **after** a successful move.
- A server restart does not reset an active clock. Because time is based on wall-clock elapsed time, an interrupted game can expire while the server is unavailable. The site is a beta, not intended for rated or high-stakes tournament play.
- Client timers are estimates displayed between authenticated server updates; server time is authoritative.
- Timed games reset their clocks when all four seats vote for a rematch.

## Storage model

\`store.js\` initializes \`quadra_rooms\` automatically when \`DATABASE_URL\` is provided. The table stores a room ID, revision, game snapshot, time control, and four hashed seat credentials.

The raw 256-bit credentials are returned only on room creation/join and kept in each participant's browser session. The database stores SHA-256 hashes, never the raw tokens or WebSocket connection objects.

Without \`DATABASE_URL\`, the application deliberately continues in in-memory beta mode. The frontend displays the actual backend storage status. Never claim that rooms survive restarts until health reports PostgreSQL.

## Future durability work

Migrate to nonexpiring managed PostgreSQL; add periodic encrypted backups, schema migrations and restore drills, transactional revision locks for multi-instance deployments, and a long-term independent archive. Version 0.5 includes compact event logs and short-lived per-room archives, not permanent backups.

## Free backup option (version 0.5)

From the game's **Moves** panel, choose **Download game record (.json)**. For earlier completed games from the same private room, select **Export** next to the archived match. The downloaded file contains no seat token or database credential. Open it on the [game replay viewer](https://quadra-chess.onrender.com/viewer.html); the file is processed locally in the browser. Do this before December 9, 2026 for any game you want to keep.
