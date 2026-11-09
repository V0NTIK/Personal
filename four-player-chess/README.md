# Quadra Chess

Live site: https://quadra-chess.onrender.com

## Status

Playable browser-based **local pass-and-play beta**. This is not yet live online multiplayer or a Chess.com-compatible implementation.

### Implemented
- 14×14 board, four missing 3×3 corners, 160 playable squares.
- Four armies (Red south, Blue west, Yellow north, Green east); 16 pieces per army.
- Free-for-all and Red/Yellow versus Blue/Green teams.
- Legal movement, check prevention, castling, en passant, pawn promotion, checkmate/stalemate-style elimination, allied capture protection and win detection.
- Responsive desktop/mobile layout, turn status, move highlights, notation log, rotate, undo, themes, local save/resume, copy record.
- Zero-backend hosting, no account required.
- Automatic deployment from GitHub main via Render.

### Defined local rules
- Turn order: Red → Blue → Yellow → Green, skipping eliminated players.
- A player without legal moves is eliminated; all their pieces are removed.
- Last remaining army, or remaining team, wins.
- No points leaderboard or Chess.com dead-piece and king-capture scoring rules.
- En passant is available only on the immediately following move (not a full 4-player orbit).
- Pawn promotion on the far boundary (south pawn on y=3, west on x=10, north on y=10, east on x=3).
- Material counts are informational, not score.
- No clocks, repetition or draw-by-agreement mechanics yet.

## Architecture evolution plan

The current entrypoint is intentionally self-contained for easy free static deployment. Before launching multiplayer, separate into:

```
apps/web                  # responsive client, game views, lobby, profile, analysis
apps/api                  # authenticated realtime gateway, matchmaking, presence
packages/game-core        # pure deterministic versioned chess rules engine
packages/variants         # variant interfaces and metadata
packages/protocol         # typed client/server events, versioning
packages/ui               # accessible boards, pieces, controls
packages/test-fixtures    # golden move generation/notation and regression games
infra                     # database migrations, RLS, deployments, observability
```

### Hard requirements for authoritative online play

1. Server validates every move and checks current player, revision, variant, game state and clock; never trust client legal moves.
2. Atomic versioned move transactions with idempotency keys to prevent double commits and race conditions.
3. Stable event log with snapshots for restoration, replay and audit.
4. Clock management using server timestamps and monotonic time, reconnect grace, per-move deadlines.
5. Presence and reconnection, spectators with optional delay, lobby privacy and invitation URLs.
6. Auth and robust authorization (row-level permissions), reporting, moderation, rate limiting and abuse prevention.
7. Profile data minimization, no publicly exposed emails, private matches by default for young users.
8. Game engine unit tests including pins, checks, cross-board slides, pawn diagonals, castling through attack, team attacks, en passant and elimination cascades.
9. CI with type checking, lint, engine property tests, UI integration tests and deployment checks.

### Future roadmap

**Next:** extract engine, implement formal move specification and broad automated tests, clocks, accessibility enhancements, rulebook, replay, importer/exporter.

**Then:** server-authoritative realtime rooms, invites, reconnect, spectators, game persistence, privacy settings, guest play, authenticated profiles and matchmaking.

**Later:** Chess960, standard two-player chess, atomic, crazyhouse, custom variant registry, tournaments, ratings by variant, training puzzles, bots, game explorer, API and other board games.

## Operational notes

Code lives in `V0NTIK/Personal/four-player-chess/`, isolated from other repositories and projects. Render static service `quadra-chess` publishes that folder on each commit to main. No Supabase project or cost-bearing backend has been created.
