# Conway's Conquerors: Specification and Analysis of a Two-Color Life Variant with an Authoritative Dual-Transport Server

**Terrible Crow — Technical Report TR-001, rev. 3 (v7.0 / "V2", 2026)**

*Revision note.* Rev. 2 corrected two errors in rev. 1 — a misapplication of undecidability results to a bounded grid (§1.4) and a confused treatment of the birth tie-break, which is in fact unreachable (§1.2) — and documented the v5.4 two-phase AI policy. Rev. 3 updates the report to the **V2 ruleset**: rival-zone cells now score at double weight (§2.4), invasion requires a three-zone presence chain rather than neutral-plus-enemy presence (§2.2), and the Hard AI plans its whole four-cell turn under one-generation lookahead with explicit home-anchor defense (§3.4). All mechanical claims below were checked against the v7.0 source, client and server.

---

## Abstract

Conway's Conquerors is a two-player, perfect-information, deterministic strategy game built on the two-color *Immigration* variant of Conway's Game of Life. Players alternate placing cells into a bounded 26×28 grid; after each turn the grid advances one generation under B3/S23 rules with majority-color births. This report specifies the automaton and the game layer — including the **V2 territorial rules**, where a player's cells inside the rival home zone score double and invasion is gated behind a three-zone presence chain — analyzes which classical Life results do and do not transfer to a bounded board, documents the dependency-free networking stack (a hand-written RFC 6455 WebSocket path and an HTTP long-polling fallback sharing one server-side code path), and describes the heuristic policy of the artificial opponent: a greedy-myopia pathology found in earlier versions and the measures that removed it, and the V2 Hard tier that plans a whole four-cell turn under one-generation lookahead while defending its home anchor.

---

## 1. The automaton

### 1.1 State space

The board is the bounded grid

$$
G = \{0,\dots,R-1\} \times \{0,\dots,C-1\}, \qquad R = 26,\; C = 28, \qquad |G| = 728
$$

Each cell holds a state in $\Sigma = \{0,1,2\}$ (*empty*, *blue*, *red*); a configuration is a map $B : G \to \Sigma$, giving $3^{728} \approx 10^{347.3}$ configurations.

Two qualifications keep this number honest. First, it counts *configurations*, not *reachable game states*: a game performs at most $2K = 24$ generations and at most $96$ placements, so the set of positions reachable through legal play is enormously smaller (though still far beyond enumeration). Second, the figure says nothing about game difficulty by itself; it only establishes that transposition tables and endgame databases are not viable approaches.

Storage: one `Int8Array(28)` per row, 728 bytes of cell data per board. Per-room state (board, cooldowns, names, socket references) is on the order of a few kilobytes; room capacity in practice is bounded by sockets and event-loop load, not memory.

### 1.2 Transition function

The automaton uses the radius-1 Moore neighborhood with **bounded (non-toroidal) edges**: cells outside $G$ contribute nothing, so border cells have 5 neighbors and corners have 3. For $x = (r,c)$ let $n_1(x), n_2(x)$ count live blue and red neighbors and $n = n_1 + n_2$. The synchronous update $B \mapsto F(B)$ is:

**Survival (S23).** If $B(x) \neq 0$: the cell keeps its color iff $n \in \{2,3\}$, else dies. Color never affects survival.

**Birth (B3, majority color).** If $B(x) = 0$ and $n = 3$: a cell is born with the majority color among the three parents.

**Proposition (no birth ties).** Under B3 with two colors, $n_1 = n_2$ is impossible at a birth site: $n_1 + n_2 = 3$ is odd. Every birth therefore has a strict 2–1 or 3–0 majority.

The implementation nevertheless contains a parity tie-break (`(r+c) mod 2`) on the equal-counts branch, in both client and server. By the proposition this branch is unreachable during evolution; it is defensive code, retained so that client and server remain bit-identical even if the birth threshold were ever changed to an even value. Determinism of the system does **not** depend on it.

A historical note on determinism: an early server build resolved the (unreachable) tie branch with `Math.random()`. It was replaced by the parity expression not because it ever fired, but to make the determinism of the codebase auditable by inspection rather than by the proposition above.

### 1.3 Cost per generation

One generation scans all cells and their neighbors:

$$
26 \cdot 28 \cdot 8 \le 6{,}552 \text{ neighbor reads (fewer at borders)}
$$

into a freshly allocated successor grid. Double-buffering is required for correctness, not speed: in-place updates would let early writes corrupt later neighbor counts within the same generation. At this size a generation takes microseconds in both Node and the browser; no sparse representation or Hashlife is justified, and none is used.

### 1.4 What transfers from classical Life — and what does not

Because the underlying rule is exactly B3/S23 and color is a label that never alters live/die decisions, every *local* structure of standard Life exists here: still lifes (block, beehive), oscillators (blinker, period 2), and spaceships (the glider moves diagonally at $c/4$, where $c$ = 1 cell/generation is the maximum propagation speed of any influence). The speed bound has direct game meaning: a placement cannot affect cells at Chebyshev distance $d$ until $d$ further generations have run, which is what makes home zones defensible at all.

Two famous global results, however, do **not** carry over as commonly stated, and rev. 1 of this report misapplied both:

- **Turing completeness / undecidability.** Life is Turing-complete *on the unbounded grid*; consequently, reachability there is undecidable. A 26×28 bounded board is a finite-state system: every question about it is decidable in principle (the transition function is a fixed map on $3^{728}$ states), merely infeasible. Moreover the standard universality constructions do not even fit: a Gosper glider gun spans roughly 36×9 cells and its output requires unbounded room to travel. The correct statement is about *complexity*, not *computability*: exact play requires search over a game tree whose size (§2.4) rules out exhaustive methods, so all play — human and machine — is heuristic.
- **Gardens of Eden.** The Moore–Myhill theorem (1962–63) concerns infinite grids. For the bounded board the existence of configurations with no predecessor follows from elementary counting: $F : S \to S$ on the finite set $S$ ($|S| = 3^{728}$) is not injective — e.g., every configuration consisting of a single live cell maps to the empty board, as does the empty board itself — hence not surjective, hence orphan configurations exist. The same argument shows irreversibility: distinct boards can share a successor, so positions cannot be "rewound"; reconstruction requires the move log.

---

## 2. The game layer

### 2.1 Turn structure

Players $p \in \{1,2\}$ alternate, blue first. A turn is exactly $M = 4$ placements, or one of two full-turn actions (§2.3), followed by **one** generation. A *round* is one turn by each player (the round counter increments when player 2's turn ends, matching the implementation); the game lasts at most $K = 12$ rounds, i.e., 24 generations.

### 2.2 Territory as a reachability predicate

Columns split into three zones of width $w = 8$: blue home ($c < 8$), red home ($c \ge 20$), neutral between. Player $p$'s legal placement zones are re-derived from the live board at every turn:

1. own home — always legal;
2. neutral — legal iff $p$ has at least one live cell in its home zone;
3. enemy home — legal iff $p$ **simultaneously** has a live cell in its home zone, a live cell in neutral, **and** at least one live cell already inside the enemy zone.

Condition (3) is the **V2 presence chain**: invasion access requires holding all three zones at once, where rev. 2 required only neutral-plus-enemy presence. It cannot be satisfied by placement, since placing in enemy territory is illegal until the condition already holds; the first cell inside enemy territory must be *born* there by the evolution (carried by a growing edge or a glider). Access is also revocable, and the home anchor is its keystone: losing all home-zone cells re-locks neutral **and** the enemy zone in the same turn. Both properties are consequences of re-evaluating the predicate against the live board rather than latching unlocks. The same predicate runs verbatim on client and server, so online legality is identical on both ends.

### 2.3 Full-turn actions

- **Bomb.** Clears the 3×3 Moore neighborhood of a target (states set to 0). Available from round $K/2 + 1 = 7$; using it consumes the entire turn (the generation still runs, then play passes); cooldown of 3 *turn-ends* — the counters decrement at every player's turn end, so 3 turn-ends ≈ 1.5 rounds, not 3 rounds. The turn cost prices the bomb in tempo; in earlier versions it was free alongside 4 placements and dominated play.
- **Skip.** Forfeits the 4 placements; the generation still runs. Once per player per game. Skip can be strictly optimal because placements can have negative value: any new cell perturbs neighbor counts and can push friendly cells over $n > 3$.

### 2.4 Scoring, termination and outcome

**Weighted score (V2).** A player's score weights each live cell by location: a cell inside the *enemy* home zone counts double, while cells in the player's own zone or in neutral count once. With $z(x)$ the zone of $x$ and $\bar p$ the opponent of $p$,

$$
\mathrm{sc}(p, B) = \sum_{x : B(x) = p} \big(1 + [\,z(x) = \text{home}(\bar p)\,]\big).
$$

The doubling is the strategic centre of V2: a held invasion is worth twice the material of the same cells at home, which makes the costly presence-chain push into enemy territory rational rather than merely aggressive, and is what gives the territory predicate of §2.2 its teeth.

**Termination.** Let $\#p(B)$ be the raw cell count and $\mathrm{sc}(p,B)$ the weighted score above. Both are evaluated after each post-turn generation, suppressed until both players have completed at least one turn (so an opening cannot be "won" before the opponent has played). The two metrics serve different roles:

- **extinction** is checked on the *raw count*: $\#\bar p = 0 \wedge \#p > 0 \Rightarrow p$ wins; $\#1 = \#2 = 0 \Rightarrow$ draw. A player with zero cells loses regardless of any prior score.
- **majority** (after round $K$, no extinction) is decided on the *weighted score*: higher $\mathrm{sc}$ wins, equal scores draw.

Extinction asks *who is still alive*; majority asks *who controls more weighted territory*. The game is finite, perfect-information, and deterministic, so optimal strategies exist and could in principle be computed by backward induction. The obstacle is size. An upper bound on one turn's placement choices is $\binom{728}{4} \approx 1.16 \times 10^{10}$, but legality makes this loose: with home-only access the choice set is $\binom{208}{4} \approx 7.6 \times 10^{7}$, and intermediate access states lie between, minus occupied cells, plus the bomb (up to 728 targets) and skip branches. Across up to 24 turns, exact search is out of reach at any depth beyond 1–2 plies, which motivates the heuristic opponent of §3.

---

## 3. The artificial opponent

### 3.1 Evaluation by one-step local simulation

For a legal candidate $x$, the CPU places it tentatively and simulates one generation restricted to the 5×5 window $W(x)$ around it (reading the 7×7 neighborhood, which by the speed bound determines $W$'s successor exactly). The primary feature is the own-cell delta

$$
\Delta_{\text{own}}(x) = \#p\!\big(F(B + x)\!\restriction_W\big) - \#p\!\big((B + x)\!\restriction_W\big)
$$

which captures the two standard one-step failure modes: an isolated placement that dies ($\Delta = -1$) and a placement that overcrowds adjacent friendly cells past $n > 3$ (strongly negative $\Delta$ even though the placed cell survives).

### 3.2 A greedy-myopia pathology and its fix

Versions up to 5.3 selected the 4 placements greedily, one at a time, by the score of §3.3 — and the Normal CPU reliably destroyed itself on its first turn. The cause is structural, not a tuning error. Call it the **pair valley**: starting from no support, every stable shape must pass through a two-cell intermediate, and a pair dies entirely ($\Delta_{\text{own}} = -2$), which scores *worse* than a second isolated cell ($\Delta_{\text{own}} = -1$). A strictly greedy one-step optimizer therefore prefers scattering four isolated cells — all of which die — over building anything. Local one-step optimality is globally suicidal here.

Two measures remove the pathology in v5.4:

1. **Formation stamping.** If the CPU has fewer than 3 standing cells at turn start (opening, or after a wipe), it skips per-cell scoring and stamps a 2×2 block — a still life, using exactly the turn's 4 placements — at the best legal location (own home zone preferred, vertically centered, away from walls and from enemy cells within distance 2–3, plus difficulty-scaled noise).
2. **Intra-turn adjacency term.** During greedy placement, candidates adjacent to cells placed *this turn* receive +12 (one such neighbor) or +16 (two, i.e., completing an L or a line). This makes the half-built intermediate states score well enough to bridge the valley, so multi-cell shapes complete instead of being abandoned after the first cell.

Empirical check (harness extracting the shipped functions, not a reimplementation): over 50 simulated Normal first turns against a standard opening, the CPU retained ≥3 cells after evolution in 50/50 trials (mean 4.0 — the intact block); over 30 second turns with a standing block, net own cells were maintained or grown in 30/30.

### 3.3 Scoring and difficulty parameters

$$
\text{score}(x) = w_z(x) + w_s(x) + a(x) + \lambda\,\Delta_{\text{own}}(x) + \mu \max(0, -\Delta_{\text{enemy}}(x)) + \varepsilon
$$

with zone term $w_z$ (neutral +5; enemy zone rewarded heavily *only when the presence chain is open*, since the move is otherwise illegal), shape prior $w_s$ (+4 for 1–2 own neighbors, −2 for none, −4 for ≥4), intra-turn adjacency $a$ as above, and noise $\varepsilon \sim U[0, \nu]$. Under V2 the simulated own-delta $\Delta_{\text{own}}$ is additionally weighted ×2 for rival-zone placements, mirroring the doubled material value of a held invasion (§2.4), and a chain-builder bonus rewards seeding neutral when the player already holds home and enemy cells but lacks a neutral foothold — the single placement that unlocks the lucrative enemy zone next turn.

| difficulty | $\lambda$ | $\mu$ | $\nu$ | candidate pool |
|---|---|---|---|---|
| easy | 5 | 0 | 8 | top 25 % |
| normal | 9 | 0 | 3 | top 10 % |
| hard | 10 | 4 | 1.2 | top 2 |

Easy differs from Normal by weight and noise, not by skipping evaluation; it plays sloppily but does not place certainly-dead cells, which the pre-5.x Easy did.

**Bomb policy.** From round 7, with cooldown clear, the CPU considers bombing with probability 0.8 (hard) / 0.35 (otherwise) per turn — stochastic because bombing now costs the whole turn. The target maximizes a trade score over the 3×3 that, under V2, weights enemy cells **squatting in the CPU's own zone double** (they are worth ×2 to the opponent) and charges extra for the CPU's own home-anchor cells so the blast never self-locks its presence chain. The firing threshold is difficulty-scaled: Hard fires on $e \ge 5$ and trade score $\ge 3$; Normal and Easy keep the conservative $e \ge 6$, score $\ge 4$. The asymmetric weight makes friendly collateral — and especially anchor collateral — more expensive than a smaller hit.

### 3.4 Full-turn planning and anchor defense (Hard, V2)

The scoring of §3.3 is greedy: it commits the four placements one at a time, blind to how they interact after the next generation. Adequate for Easy and Normal, this leaves value unrealised for Hard under V2, where a coordinated four-cell push can establish or hold an invasion no single cell could. The V2 Hard tier therefore plans the **whole turn**:

1. score every legal candidate with §3.3 and take the top ~14 as a shortlist;
2. build the four-cell set greedily *under full-board lookahead* — at each step add the shortlist cell that most improves a one-generation simulation of the **entire** board (not the 5×5 window of §3.1), evaluated by the weighted material balance (rival cells ×2) plus a presence-chain term;
3. if the planner returns fewer than four cells, fill the remainder with greedy picks so no placement is wasted.

The whole-board evaluator captures whole-shape survival and zone transitions the local window cannot. Its presence-chain term hard-penalizes the near-fatal state of losing the home anchor (which under §2.2 re-locks neutral and the enemy zone) and rewards completing the home→neutral→rival chain that keeps the ×2 zone open. The result is an **anchor-defense** behaviour that holds under pressure: across the V2 self-play campaign and an adversarial stress test in which the opponent invades the CPU's home zone every turn, the Hard AI never lost its anchor while still alive (0 occurrences over several thousand turns). Easy and Normal keep the per-cell greedy path with their existing noise, preserving their feel; only Hard plans.

**Limitations.** Even with full-turn planning, the policy looks only **one generation** ahead: it has no multi-turn search, no learning, and no opponent model beyond $\Delta_{\text{enemy}}$ and the bomb evaluator. Hard now coordinates a four-cell turn and actively pursues the ×2 invasion, but it does not plan gliders or multi-turn campaigns; longer-horizon invasions still emerge from the dynamics rather than from search. These are accepted trade-offs for a policy that runs in single-digit-to-low-tens of milliseconds per turn on a phone.

---

## 4. Networking

### 4.1 Authoritative server, transport-agnostic rooms

One dependency-free Node.js process (built-in `http`, `crypto`, `fs`, `path`, `os` modules only) serves static assets and owns all online game state. Clients are views: `move` is validated against the same zone-reachability predicate of §2.2 — including the V2 presence chain — `bomb` against the round gate and cooldown, and turn ownership is checked on every message; invalid input is answered with an error, never applied. The end-of-round majority decision uses the weighted score of §2.4 (rival cells ×2) while extinction is checked on the raw count, so server and client agree bit-for-bit on both legality and outcome. Local prediction exists only for offline modes.

The room logic is written against a minimal socket surface (`send`, `_wsState`, `_room`, `_player`). Both transports below implement that surface, so the game code has a single path regardless of wire format.

### 4.2 WebSocket path (RFC 6455, hand-written)

- **Handshake**: `101 Switching Protocols` with `Sec-WebSocket-Accept = base64(SHA1(key ∥ 258EAFA5-E914-47DA-95CA-C5AB0DC85B11))`.
- **Frames**: streaming parser handling FIN/opcode, 7/16/64-bit payload lengths, and the mandatory client→server masking, unmasked as `payload[i] XOR mask[i mod 4]`.
- **Control**: opcode 0x8 closes; 0x9 (ping) is answered with a pong; 0x1 (text) carries the JSON protocol.

The implementation is deliberately minimal: no extensions, no fragmentation reassembly beyond what the client emits, no compression. It exists because the project's constraint is zero dependencies, not because writing WebSocket parsers is recommended practice.

### 4.3 Long-polling fallback

Some managed hosts complete the WebSocket handshake at their proxy but never deliver frames to the application — the socket *opens* and stays silent. Since a `join` always elicits an immediate reply, the client treats silence as evidence and arms two triggers: (1) socket not OPEN within 4 s; (2) socket OPEN but no message within 3.5 s of the join. Either one switches to:

```
POST /api/send  { msg:{type:'join', …} }   → { sid }       (creates session)
POST /api/send  { sid, msg:{…} }           → { sid }
GET  /api/poll?sid=…                       → { msgs:[…] }   (held ≤ 25 s)
```

Server-side, a session wraps the fake socket of §4.1; `send()` enqueues into the session and flushes into the pending poll response. Sessions silent for 60 s are reaped as disconnects. A `?net=poll` URL parameter forces the polling path for diagnosis.

### 4.4 Abuse limits

Per client IP (first `X-Forwarded-For` entry behind proxies, else socket address): ≤3 concurrent open rooms, ≤12 polling sessions, ≤15 join attempts/min; rooms older than 2 h are swept. Joining a nonexistent room code returns a fatal error; an earlier build silently created a fresh room on a typo, stranding the joiner in a permanent waiting state. These are flood limits, not security boundaries: IP-based limits are circumventable by anyone with multiple addresses, and the game transports no sensitive data.

### 4.5 Known operational limits

Rooms and sessions live in process memory: a host-initiated restart ends in-flight games. There is no persistence, no reconnection-with-state, and no horizontal scaling (a second process would split the room namespace). For the intended scale these are accepted; each would require a state store and is noted here so the trade-off is explicit rather than implicit.

---

## 5. Client rendering and input

The board is one `<canvas>` redrawn on state changes, not per frame. Transient effects (death fade, birth ring, bomb ring) run a temporary `requestAnimationFrame` loop only while effects exist; effects read game state, never write it. Input uses Pointer Events with tap discrimination (≤12 px travel, ≤700 ms) so that page scrolls beginning on the canvas place nothing; `touch-action: manipulation` removes double-tap zoom, which iOS applies regardless of `user-scalable=no`. Coordinates are mapped from CSS pixels to canvas pixels via the bounding rect, handling the CSS downscale on narrow screens. A legacy `click`/`touchend` path (reading `changedTouches`, which is the populated list on `touchend`) is attached only where `PointerEvent` is absent. JS and HTML are served with `Cache-Control: no-store` and a versioned query string, after field reports of phones running stale cached game code through a hosting proxy.

---

## 6. References

1. Gardner, M. *Mathematical Games — The fantastic combinations of John Conway's new solitaire game "life"*. Scientific American 223 (Oct 1970).
2. Berlekamp, E., Conway, J. H., Guy, R. *Winning Ways for Your Mathematical Plays*, Vol. 2 (1982).
3. Moore, E. F. *Machine models of self-reproduction* (1962); Myhill, J. *The converse of Moore's Garden-of-Eden theorem* (1963).
4. Rendell, P. *Turing Universality of the Game of Life* (2002).
5. Fette, I., Melnikov, A. *RFC 6455: The WebSocket Protocol* (2011).
6. The Immigration Game — two-color Life variant, commonly attributed to Don Woods (c. 1971); primary documentation is scarce and the attribution should be treated as folklore.
