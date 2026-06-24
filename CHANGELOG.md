# Changelog

All notable changes to Conway's Conquerors. This project loosely follows
[Semantic Versioning](https://semver.org/).

## [7.0.0] — V2 territorial rules & full-turn AI

- **Enemy territory counts double.** Each of a player's cells inside the rival's
  home zone is now worth x2 toward their score. The final-majority win is decided
  on this weighted score; extinction still wins outright. HUD bars and the
  end-of-game result use the weighted score, while raw cell count still drives
  the extinction check.
- **Invasion now requires a full chain of presence.** Placing in the enemy zone
  is legal only while the player simultaneously holds cells at home **and** in
  neutral **and** already inside the enemy zone. Losing the home anchor re-locks
  neutral and the enemy zone, as before. (Previously only neutral + enemy
  presence were required.)
- **Reworked the Hard AI around the new rules:**
  - **Full-turn planning.** Instead of greedily committing four cells one at a
    time, Hard now builds a shortlist of strong candidates and searches for the
    set of four whose board, after one simulated generation, scores best —
    weighting surviving rival-zone cells x2.
  - **Home-anchor defense.** The scorer reinforces the home zone when it runs
    thin (≤2 cells), since losing it locks the CPU out of neutral and the x2
    enemy zone. Across thousands of self-play turns the AI never lost its anchor
    while alive, even against a rival invading its zone every turn.
  - **Invasion-chain pursuit & weighted invasion.** The AI seeds neutral to
    unlock the enemy zone and values surviving cells there at x2.
  - **Smarter bomb.** Now values destroying enemy cells squatting in the CPU's
    own zone (worth x2 to them) and hard-penalizes blasting its own anchor.
- Result (self-play): a steep, monotone ladder — Hard beats Normal 92–5 and Easy
  99–1 — and markedly more decisive games (Easy-vs-Hard ends by extinction 66% of
  the time). See `RESEARCH-PAPER.md` §6 for the full V2 campaign.
- Devlog/landing and research paper updated for the V2 rules and AI.

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
