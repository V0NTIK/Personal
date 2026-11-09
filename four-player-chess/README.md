# Quadra Chess

**Playable website:** https://quadra-chess.onrender.com  
**API health:** https://quadra-chess-api.onrender.com/health  
**Current release:** 0.6 — custom game setup, readiness and private accounts

A mobile-friendly four-player chess beta with local pass-and-play and private online rooms. The platform uses GitHub, a free Render static site, a free Render Node.js API, and a free Render PostgreSQL database. There is currently no public matchmaking, paid subscription, advertising, or account requirement.

## Version 0.6 — Custom challenges and optional accounts

This release adapts useful chess game-creation features while staying independent of Chess.com:

- **Free, optional accounts:** pseudonymous username and password (minimum 12 characters); scrypt password hashes with a random salt. No email, real name, location, payment details or profile photo is required.
- **Recovery and deletion:** a one-time 256-bit recovery code is shown on registration and rotated after recovery. Sessions can be revoked, and accounts can be deleted with password confirmation.
- **Linked private rooms:** account-linked seats appear under Account → My private rooms; sign in from another device to reopen your seat. Guest play and existing seat-token reconnect remain available.
- **Game setup:** optional room name, requested seat color, bullet/blitz/rapid presets, and custom time controls from 1–180 minutes and 0–60 seconds increment.
- **Player readiness:** games do not start merely when a fourth seat is claimed. All four players must be online and explicitly confirm Ready before the match and clocks begin.
- **Casual-only beta:** all games remain unrated, invite-only and private. No public matchmaking, ratings, chat or player search.
- **Privacy:** player usernames are visible only to participants in the same room, not published in a public directory. Browser sessions do not store passwords; the database stores hashes, not raw session tokens.
- **Compatibility:** previously saved rooms keep their legacy started state when loaded.

**Storage warning:** Render's existing free PostgreSQL database expires **December 9, 2026**. Accounts, sessions and game data may disappear then. Treat accounts as beta identities, not permanent accounts, until migrated to long-lived storage.

**Chess.com:** Quadra is independently built and **not affiliated with or endorsed by Chess.com**. Its published-data API is read-only; Chess.com OAuth/login requires a separate official developer application and is not included.

## Version 0.5 features

- **Resignation:** authenticated online players may resign at any point in a started match. Local players can resign the active color from Play → More match actions. Normal game-elimination and victory rules apply.
- **Draws:** every currently active online player must agree. Votes are cleared after a move, resignation, or time forfeit. In a shared local game, participants can end the match by agreement.
- **Private lobby cleanup:** explicitly leaving an unstarted lobby releases the seat. Disconnected seats in unstarted lobbies are automatically reclaimable after 30 minutes. Started matches retain seats so friends can reconnect.
- **Online replay:** new online matches record compact, deterministic chess events. Move-by-move replay is supported while a match is in progress or after it ends. Matches started before recording was enabled may not support replay.
- **Previous-match archive:** when all four players vote for a rematch, the finished match is retained in that room's recent archive (up to eight finished games). Anyone holding a valid seat credential can download an archived game.
- **Game downloads and private viewer:** current and archived games can be exported as portable JSON with no seat credentials. Open saved records in the [browser-only replay viewer](https://quadra-chess.onrender.com/viewer.html), which does not upload the file.
- **Compatibility:** older PostgreSQL room snapshots load with safe defaults even when no move-event history exists.
- **Regression tests:** Node's built-in test runner checks rules, live multiplayer, local and online UI, clocks, archive persistence, and replay without introducing paid services.

## Core functionality

- Four-player, 14 × 14 board with 3 × 3 corners removed; 160 playable cells.
- Free-for-all and Red/Yellow vs Blue/Green teams.
- Deterministic shared rules engine: moves, checks, castling, en passant, promotion, elimination, game result.
- Responsive, accessible interface with four color palettes, move highlights, turn rotation, notation, undo, save, autosave, and local history.
- Online private room codes, authenticated seat tokens, reconnect, presence, server-authoritative turns/moves, stale revision rejection.
- Online time presets: untimed, 5+0, 10+0, 15+10, and 30+0. Time starts when four seats have been claimed, regardless of who is online. Flag fall is server-authoritative.
- PostgreSQL room recovery after normal server restarts; room snapshots store **SHA-256 hashes** of seat credentials, never raw credentials.

## Storage, costs and limits

**The currently connected free PostgreSQL database expires December 9, 2026.** This release does **not** provide permanent retention, automatic backups, or a guaranteed no-cost storage replacement. Export game records you want to keep before the database expires. See [PERSISTENCE.md](PERSISTENCE.md).

Online rooms currently hold the eight most recent completed matches, and room inactivity retention is limited (up to 29 days). A room's records will be lost when the free database expires unless migrated. Exported JSON files remain on your device.

The app is a beta: there are no account profiles, match ratings, online matchmaking, public chat, spectators, multiplayer bot opponents, automated anti-cheat, or rated tournament guarantees. Local gameplay does not use a chess clock. This ruleset does **not** aim to match Chess.com's scoring or dead-piece rules exactly. Automated tests pass, but cross-browser testing with four real devices and broader chess-edge-case testing are still recommended.

## Repository layout

```text
four-player-chess/
  index.html        UI markup
  styles.css        responsive design system
  app.js            browser interaction, WebSocket client, replay, downloads
  engine.js         deterministic four-player move and result engine
  variants.js       versioned four-player variant registry
  replay.js         deterministic event replay in browser and Node
  records.js        validated portable chess-record parser
  viewer.html       standalone local-file viewer
  viewer.js         offline replay and record navigation
  clock.js          server chess clocks and time presets
  store.js          Postgres-backed room snapshot storage
  auth.js           account authentication, recovery and sessions
  account-client.js signup, sign-in and linked private rooms
  server.js         HTTP and WebSocket multiplayer API
  tests/            engine, platform, server, UI and replay tests
  PERSISTENCE.md    operational database notes
```

## Development

Requirements: Node.js 20+. From `four-player-chess/`:

```sh
npm install
npm test
npm start
```

The `postinstall` script runs `npm test` to prevent deploying a server with failing regressions. When `DATABASE_URL` is present, the API initializes Postgres tables automatically and restores room snapshots at startup. CI tests isolate themselves from `DATABASE_URL`, so builds do not mutate the live database.

## Design and security considerations

- The online server validates all moves. The browser never determines authoritative game state.
- Each occupied seat is protected by a randomly generated 256-bit token, which is stored in `sessionStorage` in the player's browser tab and hashed in the database.
- WebSocket events are authenticated, and game actions are locked per room to prevent race conditions within the single Render instance.
- Raw seat credentials must never be added to public JSON game exports, logs, GitHub, or screenshots.
- Replay files are not standardized PGN; they use Quadra's own versioned JSON format.
- The current in-process room lock is **not sufficient for running multiple API instances** simultaneously; transactional Postgres locking would be needed.
- The current beta uses the Render free plan. A free web service may sleep and experience a slow initial request. Timed games continue to use server-wall-clock time during outages/restarts.

## Next free improvements

1. More extensive legal-move and adjudication tests, including four-player tactical fixtures.
2. Read-only game-record import and better offline archive viewing.
3. Database expiration reminders, and a migration strategy for the already-working free JSON exports, without purchasing services.
4. Browser-driven tests on desktop and mobile and improved reconnect/latency UX.
5. Additional variant engine packages and an extensible protocol for future board games.

More substantial milestones—permanent game history, reliable global matchmaking, account management, and rated tournaments—require additional infrastructure and operational planning.
