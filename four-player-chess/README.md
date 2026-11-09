# Quadra Chess — Multiplayer Beta

Public game: https://quadra-chess.onrender.com
API health: https://quadra-chess-api.onrender.com/health

## Version 0.4: Timed games and persistence-ready infrastructure

- **Server-authoritative clocks** with unlimited, 5+0, 10+0, 15+10, and 30+0 presets. Wall-clock elapsed time deducts from the active player; a flagged player is eliminated.
- **Live per-player clocks** render on the board; remaining time is estimated between server snapshots, and only the server can accept moves and declare time forfeits.
- **Variant registry** (`variants.js`) names two explicit, versioned four-player variants with stable IDs and a reusable factory.
- **Restart-recoverable room storage** (`store.js`) supports PostgreSQL. Room snapshots include game, clock, revision, seats and rematch votes; raw seat tokens are not stored in PostgreSQL.
- **Postgres Free beta resource provisioned** in Ohio, expiring December 9, 2026. The live API still needs its `DATABASE_URL` environment variable set in the Render dashboard to enable durable mode. Without it, rooms remain in memory.
- **Testing** now covers timed game startup and timeout elimination, clock increments, variant registration, UI clock selection and simulated persistence recovery.

See **[PERSISTENCE.md](./PERSISTENCE.md)** for the secure one-time Render configuration, verification and important expiration limitations.

## Release: Streamlined UI + multiplayer improvements

- New board-first, responsive dark interface with a compact tabbed control sidebar for Play, Moves, Settings, and Rules.
- Dedicated local/online switch, private-room seat roster, copyable invites, and explicit free-for-all/team format selection for room creation.
- Four board palettes, legal-move indicators, optional coordinates, automatic local turn-follow orientation, keyboard movement between board squares, and more descriptive accessibility labels.
- Local games automatically save on each move and restore on page reload. Manual save and restore remain available.
- Local replay through move-by-move navigation with first, previous, next, and live controls.
- Four-player authenticated vote for rematch after an online game finishes. All four must agree to restart the room.
- Browser-level regression tests (no headless browser dependency) now run in the same CI test suite as game-engine and WebSocket integration tests.

## Current features

**Local play**
- Four-player 14×14 board with blocked 3×3 corners, all four armies.
- Free-for-all and Red/Yellow vs Blue/Green teams.
- Deterministic game engine: legal movement, king safety, captures, en passant, castling, promotion, elimination and victory.
- Move history, move highlights, undo, board rotation, themes, local game save/resume and export.

**Online private rooms**
- Create an invite-only room with a 7-character code; invite three friends, each on their own browser.
- First player claims Red; next three become Blue, Yellow, Green.
- WebSocket transport, full-state sync, reconnect using credentials stored in the browser tab, connection indicators.
- Server-authoritative move validation, revision checks against stale actions, turn ownership and result calculation.
- Unauthenticated by design: no account or chat, no public matchmaking, and no personal profiles.
- Per-IP API rate limiting, random room identifiers and 256-bit seat secrets; payload caps, WebSocket heartbeat.
- Server manages at most 200 simultaneous in-memory rooms; old rooms expire after twelve hours without activity.

## Limitations and important rules

- **Online games are ephemeral.** Render free web services spin down or restart. Rooms and game positions held only in server memory disappear on restarts/redeployments. Local saves are unaffected.
- The four-player rules are the site's own explicit variant, not guaranteed to match Chess.com's score, dead-piece or elimination rules.
- En passant lasts only until the next move (not a four-turn orbit).
- Players with no legal moves are eliminated and their pieces removed. The last surviving color/team wins.
- An online game starts once four seats are claimed, even if a seat later goes offline. Friends may reconnect from the same tab; no automated forfeit yet.
- No clocks, rated games, online persistence, anti-cheat, public chat, moderation portal, spectators or custom games yet.
- No sensitive user credentials or private messages are collected.
- Other production limitations include lack of rate limiting across instances and no durable match history. Do not use for tournaments with prizes or important matches.

## Architecture

```
four-player-chess/
  index.html                browser UI, local and room controls
  app.js                    client board and WebSocket UX
  engine.js                 UMD module, shared Node/browser rules engine
  server.js                 Node HTTP + WebSocket, authoritative moves
  package.json              pinned dependency + predeploy tests
  tests/
    ui.test.cjs             browser UI and interaction tests with deterministic DOM doubles
    engine.test.cjs         deterministic movement and variant regression tests
    server.test.cjs         API and WebSocket integration tests
```

The frontend is a Render **static site**. The backend is a separate Render **free Node web service** in Ohio. Both services deploy automatically from GitHub main. Static content is served from this folder; server starts with `node four-player-chess/server.js`.

### Development

Node.js 20+ required:

```sh
cd four-player-chess
npm install
npm test
npm start
```

The `postinstall` hook runs tests after dependency installation. The local test server listens on a random port; production HTTP listens to `PORT` or 3001. Configure `WEB_ORIGIN` to the public frontend origin. For local client development, localhost origins are permitted in the server's CORS and WebSocket Origin checks. The frontend's API URL is currently fixed in app.js.

### Variant expansion

A long-term architecture should separate dedicated packages for `game-core`, `variants`, `protocol`, `ui`, and `test-fixtures`. Each variant will specify initial state, legal move generation, turn order, time controls, result evaluation and game record serialization. The current engine is the first standalone core module.

### Next major steps

1. Validate visual design and interactions in real browsers and on four physical devices; harden all chess edge cases with property-based tests and formal four-player rulebook.
2. Move browser API endpoints to environment-based configuration, improve network resilience and add deployment smoke tests.
3. Durable online games with a real database; game event log, authoritative online replay, snapshots and server-side clocks.
4. Presence/forfeits, flexible seat assignments, game-room settings, spectators and private tournaments.
5. Secure optional accounts, friends, matchmaking, ratings and moderation before public social features.
6. Chess960, classic chess, additional variants, then games beyond chess.

See current deployed app and Render dashboards for real deployment status. Live match behavior should be tested with four browsers before inviting broad groups.
