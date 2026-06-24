<div align="center">

# Conway's Conquerors

**A 1v1 strategy game built on Conway's Game of Life.**

Place four cells per turn. The board evolves by its own rules between turns.
Cells you hold in enemy territory count double. Win by extinction or by the
higher score after twelve rounds.

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

## The V2 rules

Two rules give the territorial game its shape:

- **Enemy territory counts double.** Each of your cells sitting inside the rival's home zone is worth **x2** toward your score. Final-majority wins are decided on this weighted score, not raw cell count.
- **Invasion needs a chain of presence.** You can place in neutral only while you hold a live cell at home; you can place in enemy territory only while you simultaneously hold cells at home **and** in neutral **and** already inside the enemy zone. Lose every cell in your home zone and you are re-locked out of neutral and the enemy zone until you rebuild that anchor. The first cell inside enemy territory can't be placed — it must be *born* there by the evolution.

Extinction still wins outright at any point: wipe the opponent off the board and the game ends regardless of score.

## Highlights

- **Zero dependencies.** The entire backend is one Node.js file using only built-in modules. The WebSocket protocol (RFC 6455) is implemented by hand.
- **Transparent transport fallback.** When a hosting proxy silently breaks the WebSocket, the client detects it and switches to HTTP long-polling — same game, different wire format, no user-visible change.
- **Authoritative server.** Every move (placements, bombs, cooldowns, territory) is validated server-side.
- **Heuristic AI** with three tiers, built around one-step local simulation so even Easy never suicides. Hard plans the whole four-cell turn with one-generation lookahead, defends its home anchor, and pursues the x2 invasion. See the [research paper](RESEARCH-PAPER.md) for the full balance study.
- **In-game chat**, a **persistent leaderboard** with anti-impersonation player codes, and a **public lobby** with host-country flags — all dependency-free.
- **PWA / installable**, bilingual (English / Spanish) across the whole site.

## Run it locally

No build step, no `npm install` — there are no dependencies.

```bash
git clone https://github.com/terriblecrow/conways-conquerors.git
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
├── play/
│   ├── index.html         # the game shell
│   ├── game.js            # all game logic, rendering, AI, online client
│   ├── sw.js              # service worker (PWA, network-first)
│   ├── manifest.webmanifest
│   ├── favicon.svg
│   └── icons/             # PWA / maskable icons
├── favicon.svg
├── package.json
├── CHANGELOG.md           # version history
├── RESEARCH-PAPER.md      # RR-001: formal spec, theory, AI balance study
├── conways.service        # example systemd unit
├── nginx.conf.example     # example reverse-proxy config
└── LICENSE
```

The studio landing page and the Conway's Conquerors game page live on the main [terriblecrow.com](https://terriblecrow.com/) site, not in this repository, which contains the playable game and its server.

## Deployment

The app is a single Node process that serves both the static game shell and the game API. It runs behind any reverse proxy or managed Node host. An example systemd unit (`conways.service`) and reverse-proxy config (`nginx.conf.example`) are included as starting points.

**One important note on persistence:** the leaderboard is written to `../cc-data/leaderboard.json` — *outside* the deploy directory on purpose, so a redeploy (which replaces the app folder) doesn't wipe it. Override the location with the `LEADERBOARD_PATH` environment variable if needed.

## The game, briefly

- **Board:** 26×28, three zones — your home, neutral, enemy home.
- **Turn:** place 4 cells, *or* use the bomb (clears a 3×3, unlocks round 7, ends your turn), *or* skip (once per game). Then one generation runs.
- **Territory:** you can only place in neutral while you hold a home cell, and in enemy territory only while you hold cells at home, in neutral, and one already *born* inside the enemy zone — invasion is something the dynamics achieve, not something you buy.
- **Scoring:** cells in enemy territory count x2.
- **Win:** wipe out the opponent (extinction) or hold the higher score after round 12.

A full formal specification — state space, transition function, the relationship to classical Life theory, and an empirical AI balance study from self-play simulation — is in [`RESEARCH-PAPER.md`](RESEARCH-PAPER.md).

## Contributing

Issues and pull requests are welcome. The codebase is deliberately dependency-free; please keep it that way unless there's a compelling reason not to.

## License

[MIT](LICENSE) © 2026 Agustin Mattioli / Terrible Crow
