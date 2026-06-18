<div align="center">

# Conway's Conquerors

**A 1v1 strategy game built on Conway's Game of Life.**

Place four cells per turn. The board evolves by its own rules between turns.
Win by extinction or majority after twelve rounds.

[Play now](https://terriblecrow.com/play/) ·
[Game page](https://terriblecrow.com/conquerors/) ·
[Studio](https://terriblecrow.com/) ·
[itch.io](https://terriblecrow.itch.io/conways-conquerors) ·
[Research paper](RESEARCH-PAPER.md)

A [Terrible Crow](https://terriblecrow.com/) game · Zero dependencies · Node.js ≥ 18

</div>

---

## What is this

Conway's Conquerors turns the classic zero-player cellular automaton into a competitive two-player game. Two colonies share one 26×28 board. Each turn you seed four cells; then the board advances one generation of Conway's Game of Life (B3/S23 with majority-color births). Cells die from isolation or overcrowding; new ones are born where exactly three neighbours meet. The same move that builds your colony can overcrowd and kill it one generation later — so you have to read the board two steps ahead.

Modes: a **practice sandbox** with an animated tutorial and coaching tips, **vs CPU** at three difficulty levels, and **online multiplayer** — private rooms by code or public rooms in a live lobby.

## Highlights

- **Zero dependencies.** The entire backend is one Node.js file using only built-in modules. The WebSocket protocol (RFC 6455) is implemented by hand.
- **Transparent transport fallback.** When a hosting proxy silently breaks the WebSocket, the client detects it and switches to HTTP long-polling — same game, different wire format, no user-visible change.
- **Authoritative server.** Every move (placements, bombs, cooldowns, territory) is validated server-side.
- **Heuristic AI** with three tiers, built around one-step local simulation so even Easy never suicides. See the [research paper](RESEARCH-PAPER.md) for the full balance study.
- **In-game chat**, a **persistent leaderboard** with anti-impersonation player codes, and a **public lobby** with host-country flags — all dependency-free.
- **PWA / installable**, bilingual (English / Spanish) across the whole site.

## Run it locally

No build step, no `npm install` — there are no dependencies.

```bash
git clone https://github.com/YOUR_USERNAME/conways-conquerors.git
cd conways-conquerors
node server.js
```

Then open <http://localhost:3000>. The server picks up `PORT` from the environment if set (managed hosts inject it).

Requires Node.js 18 or newer.

## Project structure

```
.
├── server.js              # the entire backend: static serving, rooms,
│                          # hand-written WebSocket + polling, leaderboard, lobby
├── index.html             # Terrible Crow studio landing page
├── conquerors/
│   └── index.html         # Conway's Conquerors game landing page (bilingual)
├── play/
│   ├── index.html         # the game shell
│   ├── game.js            # all game logic, rendering, AI, online client
│   ├── sw.js              # service worker (PWA, network-first)
│   ├── manifest.webmanifest
│   └── icons/             # PWA / maskable icons
├── .well-known/
│   └── assetlinks.json    # Android TWA asset links
├── favicon.svg
├── RESEARCH-PAPER.md      # RR-001: formal spec, theory, AI balance study
├── TECHNICAL-PAPER.md     # architecture deep-dive
├── README-DEPLOY.md       # generic deployment notes
├── README-HOSTINGER.md    # Hostinger-specific deployment
├── README-ANDROID.md      # packaging as an Android app (TWA)
├── conways.service        # example systemd unit
└── nginx.conf.example     # example reverse-proxy config
```

## Deployment

The app is a single Node process that serves both the static site and the game API. It runs behind any reverse proxy or managed Node host. See [`README-DEPLOY.md`](README-DEPLOY.md) for the generic path, [`README-HOSTINGER.md`](README-HOSTINGER.md) for the current production setup, and [`README-ANDROID.md`](README-ANDROID.md) for Android packaging.

**One important note on persistence:** the leaderboard is written to `../cc-data/leaderboard.json` — *outside* the deploy directory on purpose, so a redeploy (which replaces the app folder) doesn't wipe it. Override the location with the `LEADERBOARD_PATH` environment variable if needed.

## The game, briefly

- **Board:** 26×28, three zones — your home, neutral, enemy home.
- **Turn:** place 4 cells, *or* use the bomb (clears a 3×3, unlocks round 7, ends your turn), *or* skip (once per game). Then one generation runs.
- **Territory:** you can only place in neutral once you hold a home cell, and in enemy territory only once one of your cells has been *born* there by the evolution — invasion is something the dynamics achieve, not something you buy.
- **Win:** wipe out the opponent (extinction) or hold more cells after round 12.

A full formal specification — state space, transition function, the relationship to classical Life theory, and an empirical AI balance study from self-play simulation — is in [`RESEARCH-PAPER.md`](RESEARCH-PAPER.md).

## Contributing

Issues and pull requests are welcome. The codebase is deliberately dependency-free; please keep it that way unless there's a compelling reason not to.

## License

[MIT](LICENSE) © 2026 Agustin Mattioli / Terrible Crow
