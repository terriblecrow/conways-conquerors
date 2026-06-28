# Changelog

All notable changes to Conway's Conquerors are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [6.8] — 2026-06-28

This release consolidates a large round of online-play fixes, a full
bilingual pass over the in-game client, a new static/offline build, and the
migration of the production domain to **conwayconquerors.com**.

### Added
- **Full Spanish/English localization of the game client.** Everything inside
  `/play` is now translated and switchable at any time from a language button:
  the lobby, the skippable tutorial (all five slides), the in-game rules modal,
  the HUD (cells remaining, zone access, bomb/skip buttons), every status
  message, the public-lobby strings, name/code validation, rematch prompts,
  chat system messages, and the end-of-game result screen (titles, subtitles,
  and the long explanations). Practice-mode coaching tips are translated too.
- **Mutual-consent rematch (online).** Both players must request a rematch
  before the room restarts. The button reflects state — "Request rematch",
  "Waiting for opponent…", "Accept rematch ✓" — and falls back cleanly when the
  opponent has already left.
- **"Back to menu" button in-game**, available in every mode; it cleanly tears
  down any online connection and returns to the lobby.
- **Client-side prediction for placements.** Cells render immediately on tap and
  reconcile against the authoritative server, removing the round-trip lag that
  was visible even on good connections. Rejected moves revert automatically.
- **Robust server-disconnect handling.** A dropped WebSocket or a stalled poll
  loop now locks the board, surfaces a centered "Connection lost" overlay, and
  offers a "Back to menu" button — the game no longer hangs or lets you keep
  placing cells after the server is gone.
- **Static / offline build** for itch.io. With `window.CC_STATIC = true` the
  client trims the menu to Practice + vs CPU, disables every network call, and
  drops the service worker, so the game runs from static files with no server.
- **Trailer section** and a hidden footer easter egg on the landing page.

### Changed
- **Production domain migrated** from `terriblecrow.com` to
  `conwayconquerors.com` (Discord lobby links, deployment and Android docs).
  All in-app API calls were already relative, so multiplayer and the
  leaderboard were unaffected by the move.
- **Restart button** is now shown only in vs-CPU games; it is hidden in online
  and local practice, where a unilateral restart makes no sense.
- The end-of-round counter is clamped so a finished game reads **12/12**
  instead of briefly showing 13/12.
- Top navigation no longer overflows on tablets and phones; the language toggle,
  mute, and PLAY controls stay on one line and the logo never wraps.
- The "rotate your device" prompt now also covers tablets in landscape (it was
  phone-only), and its copy is shown in the active language.
- `play/index.html` loads `game.min.js`; `play/game.js` is kept as the readable,
  formatted source of the same client, in sync version-for-version.

### Fixed
- Text-to-speech for the end-of-game announcement now reliably fires: the
  cancel-then-speak race is avoided and the synth is warmed up on the first user
  gesture (fixes silent TTS on mobile Safari/Chrome).
- The practice-mode zone-transition tips compared against English labels and so
  never appeared in Spanish; they now key off the zone itself and are localized.
- Service-worker cache versioning bumped so updated clients are never served
  stale code after a redeploy.

## [7.0] — 2026-06

- V2 ruleset: cells in enemy territory count double; three-zone invasion chain.
- AI rebuilt with full four-cell turn planning and one-generation lookahead.

## [5.9] — 2026-06

- Public rooms and in-game chat.

## [5.1] — 2026-06

- Initial public release of the browser game with local, vs-CPU, and online
  modes.

[6.8]: https://github.com/terriblecrow/conways-conquerors/releases
[7.0]: https://github.com/terriblecrow/conways-conquerors/releases
[5.9]: https://github.com/terriblecrow/conways-conquerors/releases
[5.1]: https://github.com/terriblecrow/conways-conquerors/releases
