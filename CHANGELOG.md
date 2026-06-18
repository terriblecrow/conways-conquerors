# Changelog

All notable changes to Conway's Conquerors. This project loosely follows
[Semantic Versioning](https://semver.org/).

## [6.0.0] — Competitive AI tuning

- Reworked the Hard AI to be more competitive and decisive, based on a self-play
  balance study (see `RESEARCH-PAPER.md`):
  - **Difficulty-scaled bomb:** Hard now fires on smaller enemy clusters and a
    thinner margin, and evaluates the bomb more often. Exclusive to Hard, so it
    widens the Normal–Hard gap rather than lifting all tiers.
  - **Killer-instinct term:** from round 7, when the opponent colony is small,
    Hard prioritises moves that finish it by extinction instead of coasting to a
    count win.
- Result: a steep, monotone difficulty ladder (Hard beats Normal 64–35 and Easy
  89–10 in self-play) and far more decisive games against weaker play.
- Practice mode: reordered coaching tips so fundamentals come first, added two
  strategic tips.
- Updated RR-001 research paper with baseline-vs-tuned data for verification.

## [5.9.0] — In-game chat & public rooms

- **In-game chat** between the two players in any online match (public or
  private), over the same transport as the game, with spam protection, length
  limit and text sanitising. Messages are ephemeral and per-match.
- Devlog/landing updated to document public rooms and chat.

## [5.8.0] — Persistent leaderboard fix

- **Leaderboard now survives redeploys:** persisted to `../cc-data/` (outside the
  deploy dir) instead of `data/` inside it, with automatic migration from the old
  location and atomic writes. Overridable via `LEADERBOARD_PATH`.
- **Fixed win-rate calculation:** vs-CPU losses are now recorded, so players are
  no longer shown a permanent 100% win rate.
- "How to play" / "Cómo se juega" renamed to "Rules" / "Reglas".

## [5.7.0] — Public lobby

- **Public rooms** listed in a live lobby with a host-country flag (resolved from
  IP with a dependency-free coarse table). Browse open games and join with one
  tap, or keep hosting private code-only rooms.
- Anti-abuse: global room caps, public-room cap, per-IP lobby rate limiting, and
  a reaper for abandoned public rooms.

## [5.6.0] — Player codes (anti-impersonation)

- Leaderboard keyed by a secret per-browser **player code**, not by name, so a
  score under a given name only counts with that name's code. Name claim/verify
  endpoint and backup/restore UI.

## [5.5.0] — Leaderboard & scoring

- **Persistent leaderboard** (JSON on disk, no database) with a four-factor score:
  opponent strength, victory mode, speed, and margin.
- Research paper (RR-001) added, plus a Research/Investigación tab on the game
  landing.

## Earlier

- Online multiplayer with hand-written WebSocket and transparent HTTP long-polling
  fallback; authoritative server-side move validation.
- CPU opponent rewrite around one-step local simulation (eliminates suicidal
  play); three difficulty tiers.
- Touch input, FX, bilingual EN/ES site, PWA / Android packaging.
