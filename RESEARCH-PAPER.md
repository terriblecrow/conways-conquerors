# Conway's Conquerors: A Competitive Two-Color Cellular Automaton — Design, Analysis, and Empirical Balance Study

**Terrible Crow — Research Report RR-001 (v5.5, 2026)**

*A. Mattioli, Terrible Crow Studio*

---

## Abstract

Conway's Conquerors is a two-player, perfect-information, deterministic strategy game played on a bounded two-color variant of Conway's Game of Life (the *Immigration Game*). Players alternately seed cells into a 26×28 grid; after each turn the grid advances one synchronous generation under B3/S23 rules with majority-color births. This report specifies the game formally, situates it against the classical theory of cellular automata (clarifying which results from unbounded Life do and do not transfer to a finite board), documents a dependency-free authoritative-server architecture with a hand-written WebSocket implementation and a transparent long-polling fallback, and presents an empirical balance study of the heuristic AI based on several hundred simulated self-play games. The baseline measurement found a correct but unevenly-spaced difficulty ladder: Easy clearly separated from the higher tiers, but Normal and Hard statistically close (a near coin-flip in self-play), with high-tier games almost never ending by extinction. We then introduce two targeted, difficulty-exclusive changes to the Hard tier — a difficulty-scaled bomb threshold and a late-game "killer-instinct" term that hunts weakened colonies — and re-measure. The tuned AI shows a steep, monotone ladder at every rung (Hard beats Normal 64–35 and Easy 89–10) and markedly higher decisiveness against weaker play (extinction rate up to 34% in Easy-vs-Hard), achieved without altering Normal's or Easy's own parameters. We report both campaigns in full so the effect of each change is auditable; all data are reproducible from the open game source via a harness that extracts the live AI functions rather than reimplementing them.

---

## 1. Introduction

Conway's Game of Life (Conway, 1970) is the canonical example of how simple local rules generate unbounded global complexity. It is normally a zero-player automaton: an initial configuration is set, and the system evolves deterministically with no further input. Conway's Conquerors converts this solitaire system into a competitive two-player game by (i) splitting live cells into two colors, (ii) letting each player inject four cells per turn, and (iii) advancing exactly one generation between turns. The result is a game whose "physics" is indifferent to either player's intentions — the board evolves by the same rules regardless of color — which is the source of its characteristic tension: a placement that looks locally advantageous can, one generation later, overcrowd and kill the player's own cells.

This report consolidates what is known about the game to date: its formal definition, its computational and mathematical properties, its software architecture, and a quantitative study of its artificial opponent.

---

## 2. Formal specification

### 2.1 Board and state space

The board is the bounded grid

$$
G = \{0,\dots,R-1\} \times \{0,\dots,C-1\}, \quad R=26,\ C=28,\ |G|=728.
$$

Each cell holds a state in $\Sigma=\{0,1,2\}$ (empty, blue, red); a configuration is a map $B:G\to\Sigma$, giving $3^{728}\approx 10^{347.3}$ configurations. This figure counts configurations, not positions reachable through legal play — a game runs at most $2K=24$ generations and $96$ placements, so the reachable set is vastly smaller, though still far beyond enumeration. The number's only practical consequence is that transposition tables and endgame databases are infeasible; play must be heuristic.

### 2.2 Transition function

The automaton uses the radius-1 Moore neighborhood with bounded (non-toroidal) edges: cells outside $G$ contribute nothing, so edge cells have 5 neighbors and corners 3. For $x=(r,c)$ let $n_1(x),n_2(x)$ count live blue and red neighbors and $n=n_1+n_2$. The synchronous update $B\mapsto F(B)$ is:

**Survival (S23).** If $B(x)\neq 0$: the cell keeps its color iff $n\in\{2,3\}$, else dies. Color never affects survival.

**Birth (B3, majority color).** If $B(x)=0$ and $n=3$: a cell is born with the majority color among the three parents.

**Proposition (no birth ties).** Under B3 with two colors, $n_1=n_2$ is impossible at a birth site, since $n_1+n_2=3$ is odd. Every birth therefore has a strict 2–1 or 3–0 majority.

The implementation nonetheless carries a deterministic parity tie-break, $(r+c)\bmod 2$, on the equal-counts branch of both client and server. By the proposition this branch is unreachable during evolution; it is defensive code that keeps client and server bit-identical should the birth threshold ever change. The system's determinism does not depend on it. (An early build used `Math.random()` here; it was replaced not because it ever fired, but to make determinism auditable by inspection.)

### 2.3 Game layer

Players $p\in\{1,2\}$ alternate, blue first. A turn is exactly $M=4$ placements or one of two full-turn actions (below), followed by one generation. A *round* is one turn by each player; the game lasts at most $K=12$ rounds (24 generations).

**Territory as a reachability predicate.** Columns split into three zones of width $w=8$: blue home ($c<8$), red home ($c\geq 20$), neutral between. A player's legal placement zones are re-derived from the live board every turn:

1. own home — always legal;
2. neutral — legal iff the player has a live cell in its home zone;
3. enemy home — legal iff the player has live cells in neutral **and** at least one live cell already inside the enemy zone.

Condition (3) cannot be satisfied by placement alone, since placing there is illegal until the condition already holds; the first cell inside enemy territory must be *born* there by the evolution. Invasion is therefore an emergent achievement of the dynamics, not a purchasable action. Access is revocable: losing all home-zone cells re-locks neutral.

**Full-turn actions.** The *bomb* clears the 3×3 Moore neighborhood of a target (states set to 0); it unlocks at round $K/2+1=7$, consumes the entire turn, and has a 3-turn-end cooldown. The *skip* forfeits the four placements (the generation still runs) and is available once per player per game; it can be optimal because placements carry negative value when they would overcrowd friendly cells.

**Termination.** With $\#p(B)$ the cell count of player $p$, evaluated after each post-turn generation but suppressed until both players have moved at least once: extinction ($\#\bar p=0\wedge\#p>0$) wins for $p$; mutual emptiness is a draw; after round $K$ the higher count wins, equal counts draw.

The game is finite, perfect-information, and deterministic, so optimal strategies exist by backward induction. The obstacle is size: an upper bound on one turn's placement choices is $\binom{728}{4}\approx1.16\times10^{10}$, and with home-only access still $\binom{208}{4}\approx7.6\times10^{7}$, making exhaustive search infeasible beyond shallow depth.

---

## 3. Relationship to classical Life theory

Because the underlying rule is exactly B3/S23 and color never alters live/die decisions, all *local* structures of standard Life exist here: still lifes (block, beehive), oscillators (blinker), and spaceships (the glider, moving diagonally at $c/4$, where $c=1$ cell/generation is the maximum propagation speed). The speed bound has direct game meaning: a placement cannot influence cells at Chebyshev distance $d$ until $d$ further generations elapse, which is precisely what makes home zones defensible.

Two famous global results, however, do **not** transfer as usually stated:

- **Turing completeness / undecidability.** Life is Turing-complete and its reachability undecidable *on the unbounded grid*. A 26×28 bounded board is a finite-state system: every question about it is decidable in principle (the transition function is a fixed map over $3^{728}$ states), merely intractable. Moreover the standard universality constructions do not fit — a Gosper glider gun spans roughly 36×9 cells and requires unbounded room for its output. The correct statement here concerns *complexity*, not *computability*.
- **Gardens of Eden.** The Moore–Myhill theorem (1962–63) concerns infinite grids. On the bounded board, the existence of predecessor-less configurations follows from elementary counting: $F$ on the finite set $S$ ($|S|=3^{728}$) is not injective — every single-live-cell configuration maps to the empty board, as does the empty board itself — hence not surjective, so orphan configurations exist. The same argument gives irreversibility: distinct boards can share a successor, so positions cannot be rewound; reconstruction requires the move log.

---

## 4. System architecture

### 4.1 Authoritative server, transport-agnostic rooms

A single dependency-free Node.js process (built-in `http`, `crypto`, `fs`, `path`, `os` only) serves static assets and owns all online game state. Clients are views: `move` is validated against the same zone-reachability predicate of §2.3, `bomb` against the round gate and cooldown, and turn ownership is checked on every message. The room logic is written against a minimal socket surface (`send`, `_wsState`, `_room`, `_player`); both transports below implement that surface, so the game code has a single path regardless of wire format.

### 4.2 WebSocket and long-polling fallback

The WebSocket layer implements RFC 6455 directly over TCP: the handshake answers `101 Switching Protocols` with `Sec-WebSocket-Accept = base64(SHA1(key ∥ GUID))`; a streaming parser handles FIN/opcode, 7/16/64-bit lengths, and the mandatory client-to-server masking ($\text{payload}[i]\oplus\text{mask}[i\bmod 4]$); control opcodes handle close and ping. Because some managed hosts complete the handshake at their proxy but never deliver frames, the client arms two fallback triggers — socket not open within 4 s, or open but silent for 3.5 s after a join — and transparently switches to an HTTP transport (`POST /api/send`, `GET /api/poll` held up to 25 s) that is semantically identical. Each polling session wraps a fake socket exposing the same surface, so the room code is unchanged.

### 4.3 Leaderboard, scoring, and identity

Finished games are scored on four factors and accumulated in a JSON file on disk (no database). The score combines (i) opponent strength — vs-CPU base by difficulty (Easy 30, Normal 70, Hard 120), online a flat 100; (ii) victory mode — a +40 bonus for extinction over a count win; (iii) speed — up to +50 decaying from 60 s to 10 min, plus up to +25 for an early-round extinction; (iv) margin — 1.5 points per cell of final lead, capped at +45. Identity is protected by a per-browser secret player code: the leaderboard is keyed by code, not name, so a score under a given name only counts if it carries that name's code, making casual impersonation impossible. Online games are recorded server-side; vs-CPU games are reported by the client, since the server does not observe offline play.

---

## 5. The artificial opponent

### 5.1 Evaluation by one-step local simulation

For each legal candidate cell $x$, the AI places it tentatively and simulates one generation restricted to the 5×5 window around it (reading a 7×7 neighborhood, which by the speed bound determines the window's successor exactly). The primary feature is the own-cell delta

$$
\Delta_{\text{own}}(x)=\#p\!\big(F(B+x)\!\restriction_W\big)-\#p\!\big((B+x)\!\restriction_W\big),
$$

which captures both classical one-step failure modes: an isolated placement that dies ($\Delta=-1$) and a placement that overcrowds adjacent friendly cells past $n>3$ (strongly negative $\Delta$ even though the placed cell survives).

### 5.2 The pair-valley pathology

A purely greedy per-cell optimizer is globally suicidal here. Starting from no support, every stable shape must pass through a two-cell intermediate, and a pair dies entirely ($\Delta_{\text{own}}=-2$), scoring *worse* than a second isolated cell ($\Delta=-1$). The optimizer therefore prefers scattering four lone cells — all of which die — over building anything; earlier versions reliably self-destructed on the first turn. Two measures remove this: (i) **formation stamping** — with fewer than three standing cells, the AI skips per-cell scoring and stamps a 2×2 block (a still life using exactly the four placements) at the best legal location; (ii) an **intra-turn adjacency term** — candidates adjacent to cells placed this turn receive +12 (one neighbor) or +16 (two, completing an L or line), so half-built intermediates score well enough to bridge the valley.

### 5.3 Scoring function and difficulty parameters

$$
\text{score}(x)=w_z(x)+w_s(x)+a(x)+\lambda\,\Delta_{\text{own}}(x)+\mu\max(0,-\Delta_{\text{enemy}}(x))+\kappa(x)+\varepsilon
$$

with zone term $w_z$ (neutral +5; enemy +5 from round 5, +1 before), shape prior $w_s$ (+4 for 1–2 own neighbors, −2 for none, −4 for ≥4), intra-turn adjacency $a$ as above, and noise $\varepsilon\sim U[0,\nu]$. The difficulty tiers differ in these parameters:

| difficulty | $\lambda$ (sim weight) | $\mu$ (enemy harm) | $\nu$ (noise) | candidate pool |
|---|---|---|---|---|
| easy | 5 | 0 | 8 | top 25% |
| normal | 9 | 0 | 3 | top 10% |
| hard | 10 | 4 | 1.2 | top 2 |

The term $\kappa(x)$ is the *killer-instinct* bonus introduced in v5.5 (§6.5): for Hard only, from round 7, when the opponent colony has $\leq 12$ cells, candidate placements receive an extra $6\max(0,-\Delta_{\text{enemy}})$, steering Hard toward finishing a weakened enemy by extinction rather than coasting to a round-12 count win. For Easy and Normal, $\kappa\equiv 0$.

The bomb is considered from round 7 with probability 0.8 (hard) / 0.35 (otherwise), targeting the 3×3 maximizing $e-1.5\,o$ (enemy minus weighted own cells). The firing threshold is *difficulty-scaled* (v5.5): Hard fires when $e\geq 5$ and the trade score $\geq 3$; Normal and Easy keep the conservative $e\geq 6,\ \text{score}\geq 4$. Hard therefore bombs smaller clusters on a thinner margin, which both shortens games and raises its win rate against weaker tiers without collapsing the Normal–Hard distinction.

---

## 6. Empirical balance study

### 6.1 Method

We extracted the shipped AI functions (not a reimplementation) into a headless harness and ran self-play between difficulty tiers. The harness reproduces the exact evolution, reachability, scoring, and bomb logic, mirroring the AI for the first player by color-swapping the board so the player-2-coded functions apply to either side. Victory checking is suppressed until both players have moved, matching the server. Each matchup ran 50–120 games; results are reported as win percentages for player 1 (P1) and player 2 (P2), with the fraction ending by extinction, mean final round, and mean cell margin. We report two measurement campaigns: the **baseline** (release v5.4, before tuning) and the **tuned** AI (v5.5, after the changes of §6.4).

### 6.2 Results

**Baseline (v5.4):**

| matchup (P1 vs P2) | P1 win% | P2 win% | draw% | extinction% | mean round |
|---|---|---|---|---|---|
| easy vs easy | 82 | 17 | 2 | 47 | 9.6 |
| normal vs normal | 53 | 43 | 4 | 6 | 11.7 |
| hard vs hard | 40 | 56 | 4 | 9 | 11.7 |
| easy vs normal | 35 | 64 | 1 | 19 | 10.9 |
| easy vs hard | 21 | 79 | 0 | 23 | 10.7 |
| normal vs hard | 49 | 48 | 4 | 0 | 12.0 |

**Tuned (v5.5):**

| matchup (P1 vs P2) | P1 win% | P2 win% | draw% | extinction% | mean round |
|---|---|---|---|---|---|
| easy vs easy | 76 | 23 | 1 | 53 | 9.5 |
| normal vs normal | 72 | 27 | 1 | 11 | 11.3 |
| hard vs hard | 32 | 65 | 3 | 5 | 11.8 |
| easy vs normal | 30 | 70 | 0 | 16 | 10.8 |
| easy vs hard | 10 | 89 | 1 | 34 | 10.6 |
| normal vs hard | 35 | 64 | 1 | 0 | 12.0 |

### 6.3 Findings (baseline)

**(F1) The ladder is correct but unevenly spaced.** Stronger tiers beat weaker ones in every asymmetric matchup. However, the spacing is concentrated at the bottom: Easy is decisively separated from Normal and from Hard, whereas Normal vs Hard was nearly a coin flip (48–49 in the baseline run, ~52–56 for Hard across runs). The difficulty ladder was steep from Easy to Normal and nearly flat from Normal to Hard.

**(F2) The Normal/Hard parameters are almost identical where it matters.** The simulation weight $\lambda$ differs by one unit (9 vs 10) and both share $w_z, w_s, a$. Their only substantive differences are the noise $\nu$ (3 vs 1.2), the candidate pool (top 10% vs top 2), and Hard's enemy-harm term $\mu=4$.

**(F3) High-tier games rarely end by extinction.** Hard-vs-Hard ended by extinction only 9% of the time and Normal-vs-Hard 0–1%; most high-level games ran the full twelve rounds and were decided on cell count. The bomb — the natural finisher — was used too conservatively (its $e\geq 6$ threshold demands a dense cluster that stable mid-game colonies rarely present).

**(F4) Easy retains nontrivial competence.** Easy still wins against higher tiers a fraction of the time because the one-step simulation $\Delta_{\text{own}}$ — used at all tiers — prevents the suicidal placements that would make a true beginner tier. Easy is "sloppy," not "weak."

**(F5) First-player advantage at low tiers, reversed at high tiers.** Mirror matchups favor P1 at Easy and Normal but favor P2 at Hard. The low-tier P1 edge plausibly reflects tempo (acting first on an empty board); the high-tier reversal suggests that against sharp play, reacting to a revealed position outweighs the opening tempo. This is a property of the game, not of the difficulty tuning.

### 6.4 Applied adjustments (v5.5)

Two of the four proposals from the baseline analysis were implemented and re-measured; the other two were deliberately deferred (see below).

1. **Difficulty-scaled bomb (targets F3).** Hard's bomb now fires on smaller clusters and a thinner margin ($e\geq 5,\ \text{score}\geq 3$ vs the conservative $e\geq 6,\ \text{score}\geq 4$ retained for Easy/Normal), and is evaluated with probability 0.8 instead of 0.6. This finisher is exclusive to Hard so it widens the Normal–Hard gap rather than lifting all tiers equally.
2. **Killer-instinct term $\kappa$ (targets F1, F3).** From round 7, when the opponent has $\leq 12$ cells, Hard adds a strong bonus to placements that further reduce the enemy, steering toward extinction wins instead of count wins.

**Deferred:** lowering Normal's $\lambda$ and Easy's $\lambda$ (proposals 1–2 of the baseline) were *not* applied, because the bomb/killer-instinct changes alone restored a clear Normal–Hard gap (see §6.5) and additionally lowering Normal risked compressing the Easy–Normal gap from the other side. The second-player compensation (F5) remains deferred pending human online data.

### 6.5 Results of the tuning

Comparing the two campaigns in §6.2:

- **The Normal–Hard gap widened and became consistent.** Baseline Normal-vs-Hard was 49–48 (a coin flip); tuned it is 35–64 in Hard's favor — a stable, clearly-felt skill step, achieved without touching Normal's own parameters.
- **Hard became more dominant against every lower tier.** Easy-vs-Hard moved from 79% to 89% for Hard; Easy-vs-Normal held at ~70%. The ladder is now monotone *and* steep at every rung.
- **Decisiveness against weaker play improved.** Easy-vs-Hard extinctions rose from 23% to 34%, and Easy-vs-Easy from 47% to 53%; Normal-vs-Normal doubled (6%→11%). Hard now closes out weakened colonies instead of coasting.
- **The mirror-match extinction rate at the very top stayed low** (Hard-vs-Hard 5%, Normal-vs-Hard 0%). When *both* sides have the killer instinct they neutralize each other, so symmetric top-tier games still tend to the round limit. This is acceptable: the design goal was decisive, dangerous-feeling games for a *human* facing the CPU, which corresponds to the asymmetric matchups, not CPU-vs-CPU mirror play.

The net effect is a difficulty ladder that is now steep and monotone at every rung (Easy < Normal < Hard with clear margins), and a Hard tier that actively hunts for the kill in the late game — the intended "fun, dangerous challenge" target. As before, these are self-play measurements; the qualitative gains (clear ladder, more finishes) are robust across runs, but absolute human difficulty must still be confirmed by playtesting.

---

## 7. Threats to validity

The balance study measures AI-vs-AI play. It establishes the relative ordering and spacing of the tiers under their own heuristic, but not the absolute difficulty experienced by a human, who brings pattern recognition and multi-turn planning the depth-1 AI lacks. Sample sizes (50–120 games per matchup) are adequate for the large effects (Easy vs others) but leave the Normal/Hard margin with wide confidence intervals; the qualitative conclusion (they are close) is robust across runs, but the exact percentage is not. Finally, the harness mirrors the first player by color-swap; while the rules are color-symmetric, any latent asymmetry in the parity tie-break $(r+c)\bmod 2$ could in principle bias mirror matchups, though §2.2 shows that branch is unreachable in normal evolution.

---

## 8. Conclusion

Conway's Conquerors is a finite, deterministic, perfect-information game built on a faithful two-color Life automaton, served by a compact dependency-free authoritative architecture. Its difficulty AI is a depth-1 heuristic whose central device — one-step local simulation of $\Delta_{\text{own}}$ — eliminates the suicidal and kamikaze failure modes that plague naive neighbor-counting opponents. Baseline self-play confirmed a correctly ordered but unevenly-spaced ladder, with Normal and Hard nearly indistinguishable and high-tier games rarely decisive. Two difficulty-exclusive changes to Hard — a scaled bomb threshold and a late-game killer-instinct term — restored a steep, monotone ladder and a Hard tier that actively hunts the kill, without disturbing the lower tiers, as confirmed by a second self-play campaign reported alongside the first. Learning is handled separately from challenge: a practice sandbox (single-device control of both colonies), an animated multi-slide tutorial covering zones, the B3/S23 rules and invasion, an optional guided mode that previews each evolution before it is committed, and a progressive rotating coach make the systems approachable without diluting the competitive AI. The determinism, locality, and irreversibility the game inherits from Life are not incidental: they are the mechanics, turning a zero-player automaton into a contest of reading a system that has no favorites.

---

## References

1. Gardner, M. *Mathematical Games — The fantastic combinations of John Conway's new solitaire game "life."* Scientific American 223 (Oct 1970).
2. Berlekamp, E., Conway, J. H., Guy, R. *Winning Ways for Your Mathematical Plays*, Vol. 2 (1982).
3. Moore, E. F. *Machine models of self-reproduction* (1962); Myhill, J. *The converse of Moore's Garden-of-Eden theorem* (1963).
4. Rendell, P. *Turing Universality of the Game of Life* (2002).
5. Fette, I., Melnikov, A. *RFC 6455: The WebSocket Protocol* (2011).
6. The Immigration Game — two-color Life variant, commonly attributed to Don Woods (c. 1971); primary documentation is scarce and the attribution should be treated as folklore.

---

*Research reports from Terrible Crow document the internals of shipped games. Methods and data in §6 are reproducible from the open game source; the self-play harness extracts the live AI functions rather than reimplementing them.*
