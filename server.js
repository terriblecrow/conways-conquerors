/**
 * Conway's Conquerors — server.js v5.0
 * Static file server + manual WebSocket (no dependencies)
 * 
 * Usage: node server.js [PORT]
 * 
 * WebSocket protocol (JSON messages):
 *   Client → Server:
 *     {type:'join', name:'Alice', room:'abc123'}
 *     {type:'move', r, c}
 *     {type:'bomb', r, c}
 *     {type:'skip'}
 *     {type:'restart'}
 *     {type:'ping'}
 *
 *   Server → Client:
 *     {type:'joined', player:1|2, room:'abc123', names:{1:'Alice',2:'Bob'}}
 *     {type:'waiting', room:'abc123'}
 *     {type:'start', names:{1:'Alice',2:'Bob'}}
 *     {type:'state', board, player, moves, round, abilityCooldown, skipUsed}
 *     {type:'move_ok', r, c, player}
 *     {type:'bomb_ok', r, c, player, killed}
 *     {type:'skip_ok', player}
 *     {type:'evolve', board, round}
 *     {type:'gameover', winner, p1, p2, round}
 *     {type:'opponent_left'}
 *     {type:'error', msg}
 *     {type:'pong'}
 */
'use strict';

const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const url    = require('url');
const os     = require('os');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = __dirname;

// ── Game constants (must match game.js) ───────────────────────────────────
const ROWS=26, COLS=28, MPT=4, MAX_ROUNDS=12, ZONE_W=8, BOMB_CD=3, BOMB_UNLOCK=7;
const zoneOf = c => c < ZONE_W ? 1 : c >= COLS - ZONE_W ? 2 : 0;

// ── Static file server ────────────────────────────────────────────────────
const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.ico':'image/x-icon', '.png':'image/png',
  '.svg':'image/svg+xml', '.json':'application/json',
  '.woff2':'font/woff2', '.woff':'font/woff',
  '.webmanifest':'application/manifest+json',
  '.md':'text/markdown; charset=utf-8',
};

// ── Rooms ─────────────────────────────────────────────────────────────────
const rooms = new Map(); // roomId → Room

// ── Leaderboard & scoring ──────────────────────────────────────────────────
// Score combines four factors the user asked for:
//   1. CPU difficulty   (only for vs-CPU games reported by the client)
//   2. victory mode      (extinction worth more than majority)
//   3. time to victory   (faster wins score higher, with a floor)
//   4. margin vs rival   (bigger cell-count gap = more dominant win)
// Online human-vs-human games have no "difficulty", so they use a fixed PvP
// base that sits between Normal and Hard CPU — beating a person is worth more
// than beating easy AI but is not difficulty-graded.
//
// Persistence: a plain JSON file on disk (no DB, no deps).
//
// IMPORTANT: the file must live OUTSIDE the deploy directory. A redeploy
// replaces the whole app folder (ROOT/__dirname), which would wipe a file
// stored under ROOT/data. We therefore default to a sibling of ROOT
// (../cc-data/), which survives redeploys on Hostinger, and allow an explicit
// override via the LEADERBOARD_PATH env var (set it to any persistent absolute
// path, e.g. a mounted volume, if available).
const LB_FILE = process.env.LEADERBOARD_PATH
  || path.join(ROOT, '..', 'cc-data', 'leaderboard.json');
let LB = { players: {}, games: 0, updatedAt: null };

(function loadLB() {
  // try the configured location first, then a legacy in-deploy path so existing
  // data from older builds is migrated rather than lost on the upgrade.
  const candidates = [LB_FILE, path.join(ROOT, 'data', 'leaderboard.json')];
  for (const f of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (parsed && parsed.players) {
        LB = parsed;
        if (!LB.players) LB.players = {};
        console.log('leaderboard loaded from', f, '(' + Object.keys(LB.players).length + ' players)');
        return;
      }
    } catch (e) { /* try next */ }
  }
  console.log('leaderboard: starting fresh at', LB_FILE);
})();

let lbWriteTimer = null;
function saveLB() {
  if (lbWriteTimer) return; // debounce bursts
  lbWriteTimer = setTimeout(() => {
    lbWriteTimer = null;
    try {
      fs.mkdirSync(path.dirname(LB_FILE), { recursive: true });
      // atomic write: write to temp then rename, so a crash mid-write can't
      // corrupt the existing leaderboard file.
      const tmp = LB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(LB));
      fs.renameSync(tmp, LB_FILE);
    } catch (e) { console.error('leaderboard save:', e.message); }
  }, 1500);
  lbWriteTimer.unref && lbWriteTimer.unref();
}

const SCORE = {
  // victory-mode base points
  BASE_ONLINE: 100,      // beating a human
  BASE_CPU: { easy: 30, normal: 70, hard: 120 },
  EXTINCTION_BONUS: 40,  // wiping the opponent out entirely vs. winning on count
  // time: full speed bonus if won at/under FAST_SEC, decaying to 0 at SLOW_SEC
  FAST_SEC: 60, SLOW_SEC: 600, TIME_BONUS_MAX: 50,
  // margin: points per cell of lead, capped
  MARGIN_PER_CELL: 1.5, MARGIN_CAP: 45,
  // round: an early extinction (low round) also gives a small efficiency bonus
  ROUND_BONUS_MAX: 25,
};

function computeScore({ mode, difficulty, byExtinction, round, elapsedSec, margin, winnerCells }) {
  let pts = mode === 'cpu'
    ? (SCORE.BASE_CPU[difficulty] != null ? SCORE.BASE_CPU[difficulty] : SCORE.BASE_CPU.normal)
    : SCORE.BASE_ONLINE;

  // victory mode
  if (byExtinction) pts += SCORE.EXTINCTION_BONUS;

  // time to victory: linear decay between FAST and SLOW
  if (typeof elapsedSec === 'number' && elapsedSec >= 0) {
    const t = Math.min(1, Math.max(0,
      (SCORE.SLOW_SEC - elapsedSec) / (SCORE.SLOW_SEC - SCORE.FAST_SEC)));
    pts += Math.round(t * SCORE.TIME_BONUS_MAX);
  }

  // margin vs rival
  if (typeof margin === 'number' && margin > 0) {
    pts += Math.min(SCORE.MARGIN_CAP, Math.round(margin * SCORE.MARGIN_PER_CELL));
  }

  // round efficiency: only rewarded on extinction (winning fast on the board,
  // not by running out the clock to round 12)
  if (byExtinction && typeof round === 'number') {
    const t = Math.min(1, Math.max(0, (MAX_ROUNDS - round) / (MAX_ROUNDS - 1)));
    pts += Math.round(t * SCORE.ROUND_BONUS_MAX);
  }

  return Math.max(1, Math.round(pts));
}

// Identity model: the leaderboard is keyed by a secret player CODE (pid), not
// by display name. The first time a pid is seen it claims its name; afterwards
// the pid is the identity and the name is just a (re-settable) label. This
// makes impersonation impossible: writing someone else's NAME does nothing
// unless you also hold their CODE, which only lives in their browser.
//
// recordResult returns false and records nothing if the pid/name pairing is
// rejected (see verifyIdentity).

function verifyIdentity(pid, name) {
  // pid must be a sane token; otherwise treat as anonymous-by-name (legacy)
  if (!pid || typeof pid !== 'string' || !/^[a-z0-9]{8,40}$/i.test(pid)) return null;
  const existing = LB.players[pid];
  if (existing) {
    // known player: accept regardless of submitted name (they may rename),
    // but a name COLLISION with a different pid is blocked at claim time below
    return existing;
  }
  // new pid: ensure the requested display name isn't already owned by another pid
  const wanted = String(name || 'Player').slice(0, 20).trim() || 'Player';
  const nameTaken = Object.values(LB.players)
    .some(p => p.name.toLowerCase() === wanted.toLowerCase());
  if (nameTaken) return 'name_taken';
  return undefined; // ok to create
}

function recordResult(pid, name, points, meta) {
  name = String(name || 'Player').slice(0, 20).trim() || 'Player';

  const check = verifyIdentity(pid, name);
  if (check === 'name_taken') return false; // impersonation attempt — reject
  // legacy path: no valid pid → fall back to name-keyed entry (older clients)
  const key = (check === null) ? ('name:' + name.toLowerCase()) : pid;

  if (!LB.players[key]) {
    LB.players[key] = { name, score: 0, games: 0, wins: 0, best: 0, pid: (check===null?null:pid) };
  }
  const p = LB.players[key];
  // only let a pid-owner change their own display name
  if (check !== null) p.name = name;
  p.score += points;
  p.games += 1;
  if (meta && meta.winner) p.wins += 1;
  if (points > p.best) p.best = points;
  LB.games += 1;
  LB.updatedAt = new Date().toISOString();
  saveLB();
  return true;
}

function topPlayers(n = 20) {
  return Object.values(LB.players)
    .map(p => ({ name: p.name, score: p.score, games: p.games, wins: p.wins, best: p.best,
      winRate: p.games ? Math.round(p.wins / p.games * 100) : 0 })) // never leak pid
    .sort((a, b) => b.score - a.score || b.wins - a.wins)
    .slice(0, n);
}

function serveLeaderboard(res) {
  const body = JSON.stringify({
    totalGames: LB.games,
    updatedAt: LB.updatedAt,
    top: topPlayers(20),
    scoring: { // expose the constants so the website can document them live
      baseOnline: SCORE.BASE_ONLINE, baseCpu: SCORE.BASE_CPU,
      extinctionBonus: SCORE.EXTINCTION_BONUS,
      timeBonusMax: SCORE.TIME_BONUS_MAX, fastSec: SCORE.FAST_SEC, slowSec: SCORE.SLOW_SEC,
      marginPerCell: SCORE.MARGIN_PER_CELL, marginCap: SCORE.MARGIN_CAP,
      roundBonusMax: SCORE.ROUND_BONUS_MAX, maxRounds: MAX_ROUNDS,
    },
  });
  res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-cache',
    'Access-Control-Allow-Origin':'*' });
  res.end(body);
}

// client reports a finished vs-CPU game (offline mode the server can't observe)
function handleCpuResult(msg) {
  const d = ['easy','normal','hard'].includes(msg.difficulty) ? msg.difficulty : 'normal';
  // Record BOTH wins and losses so win-rate is meaningful. Previously only wins
  // were stored, which made every CPU-only player show 100% win rate (games and
  // wins incremented together). A loss scores 0 points but counts as a game.
  if (!msg.win) {
    recordResult(msg.pid, msg.name, 0, { mode:'cpu', winner:false, difficulty:d });
    return 0;
  }
  const pts = computeScore({
    mode: 'cpu', difficulty: d,
    byExtinction: !!msg.byExtinction,
    round: Math.max(1, Math.min(MAX_ROUNDS, Number(msg.round) || MAX_ROUNDS)),
    elapsedSec: Math.max(0, Math.min(3600, Number(msg.elapsedSec) || 0)),
    margin: Math.max(0, Math.min(728, Number(msg.margin) || 0)),
  });
  const ok = recordResult(msg.pid, msg.name, pts, { mode:'cpu', winner:true, difficulty:d });
  return ok ? pts : false; // false = rejected (name owned by another code)
}



// ── Per-IP abuse limits ───────────────────────────────────────────────────
// Prevents one origin from flooding the server with rooms or sessions.
const LIMITS = {
  ROOMS_PER_IP: 3,        // concurrent open rooms created from one IP
  SESSIONS_PER_IP: 12,    // concurrent polling sessions from one IP
  JOINS_PER_MIN: 15,      // join attempts per minute per IP
  ROOM_MAX_AGE_MS: 2*60*60*1000, // stale rooms force-removed after 2h
  // ── global ceilings (protect the single process from overload) ──
  MAX_ROOMS_TOTAL: 200,        // hard cap on concurrent rooms server-wide
  MAX_PUBLIC_ROOMS: 60,        // of those, at most this many public/listed
  PUBLIC_WAIT_MAX_AGE_MS: 10*60*1000, // public rooms waiting >10min are reaped
  LOBBY_RATE_MS: 2000,         // min interval between /api/lobby reads per IP
};
const joinRate = new Map(); // ip → [timestamps]
const lobbyRate = new Map(); // ip → last lobby fetch ms

function countRooms() {
  let total = 0, pub = 0;
  for (const r of rooms.values()) { total++; if (r.public && !r.started) pub++; }
  return { total, pub };
}

function clientIp(req) {
  // behind a hosting proxy the real client comes in x-forwarded-for
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// ── Country from IP (dependency-free, coarse) ──────────────────────────────
// A compact table mapping leading IPv4 octets to an ISO country code. This is
// NOT a precise geo-IP database — it uses well-known large regional/national
// allocations and is meant only to show an approximate host-country flag on a
// public room. Unknown ranges fall back to a neutral globe. The flag is cosmetic.
const GEO8 = { // first octet → country (largest single-country /8 allocations)
  3:'US',4:'US',6:'US',7:'US',8:'US',9:'US',11:'US',12:'US',13:'US',15:'US',16:'US',17:'US',
  18:'US',19:'US',20:'US',21:'US',22:'US',23:'US',24:'US',26:'US',28:'US',29:'US',30:'US',
  32:'US',33:'US',35:'US',38:'US',40:'US',44:'US',45:'US',47:'US',48:'US',50:'US',52:'US',
  54:'US',55:'US',56:'US',63:'US',64:'US',65:'US',66:'US',67:'US',68:'US',69:'US',70:'US',
  71:'US',72:'US',73:'US',74:'US',75:'US',76:'US',96:'US',97:'US',98:'US',99:'US',
  100:'US',104:'US',107:'US',108:'US',173:'US',174:'US',184:'US',192:'US',198:'US',199:'US',
  204:'US',205:'US',206:'US',207:'US',208:'US',209:'US',216:'US',
  2:'FR',5:'GB',25:'GB',51:'GB',57:'FR',62:'EU',77:'DE',78:'FR',79:'IT',80:'EU',81:'EU',
  82:'EU',83:'DE',84:'DE',85:'EU',86:'IT',87:'DE',88:'EU',89:'EU',90:'FR',91:'EU',92:'EU',
  93:'EU',94:'EU',95:'EU',176:'EU',178:'EU',185:'EU',188:'EU',193:'EU',194:'EU',195:'EU',
  212:'EU',213:'EU',217:'EU',
  1:'AU',14:'JP',27:'CN',36:'CN',39:'CN',42:'CN',49:'JP',58:'CN',59:'CN',60:'CN',61:'JP',
  101:'CN',103:'AP',106:'CN',110:'JP',111:'JP',112:'CN',113:'CN',114:'CN',115:'CN',116:'CN',
  117:'CN',118:'CN',119:'CN',120:'CN',121:'CN',122:'CN',123:'CN',124:'CN',125:'JP',
  126:'JP',133:'JP',150:'JP',153:'JP',175:'CN',180:'CN',182:'CN',183:'CN',202:'AP',203:'AP',
  210:'JP',211:'KR',218:'CN',219:'CN',220:'JP',221:'CN',222:'CN',223:'CN',
  131:'BR',177:'BR',179:'BR',186:'BR',187:'BR',189:'BR',191:'BR',200:'BR',201:'BR',
  190:'AR',
  41:'ZA',102:'ZA',105:'AF',154:'AF',155:'ZA',196:'AF',197:'AF',
  37:'RU',46:'RU',95:'RU',109:'RU',176:'RU',178:'RU',188:'RU',
  43:'IN',49:'IN',
};
function countryForIp(ip) {
  if (!ip || ip === 'unknown') return null;
  if (ip === '::1' || ip.startsWith('127.') || ip === '::ffff:127.0.0.1') return 'LOCAL';
  // strip IPv6-mapped IPv4 prefix
  const m = ip.replace(/^::ffff:/, '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const a = +m[1];
  // private ranges → unknown
  if (a === 10 || a === 192 && +m[2] === 168 || a === 172 && (+m[2] >= 16 && +m[2] <= 31)) return null;
  return GEO8[a] || null;
}
// ISO code → regional indicator emoji (flag). 'EU'/'AP'/'AF'/'LOCAL' get symbols.
function flagFor(cc) {
  if (!cc) return '🌐';
  if (cc === 'LOCAL') return '🏠';
  if (cc === 'EU') return '🇪🇺';
  if (cc === 'AP' || cc === 'AF') return '🌐';
  if (!/^[A-Z]{2}$/.test(cc)) return '🌐';
  return String.fromCodePoint(...[...cc].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}


function roomsOwnedBy(ip) {
  let n = 0;
  for (const room of rooms.values()) if (room.creatorIp === ip && !room.over) n++;
  return n;
}
function sessionCountFor(ip) {
  let n = 0;
  for (const sess of sessions.values()) if (sess.ip === ip) n++;
  return n;
}
function joinAllowed(ip) {
  const now = Date.now();
  let arr = joinRate.get(ip) || [];
  arr = arr.filter(t => now - t < 60000);
  if (arr.length >= LIMITS.JOINS_PER_MIN) { joinRate.set(ip, arr); return false; }
  arr.push(now);
  joinRate.set(ip, arr);
  return true;
}
// stale-room sweeper: rooms abandoned mid-setup or forgotten after games
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.createdAt > LIMITS.ROOM_MAX_AGE_MS) { rooms.delete(id); continue; }
    // public rooms that nobody joined within the window are reaped so the
    // lobby never fills up with stale/abandoned listings
    if (room.public && !room.started && room.playerCount() <= 1 &&
        now - room.createdAt > LIMITS.PUBLIC_WAIT_MAX_AGE_MS) {
      try { if (room.clients[0]) room.clients[0].send(JSON.stringify({type:'error', fatal:true,
        msg:'Your public room expired after waiting too long. Create a new one.'})); } catch(e) {}
      rooms.delete(id);
    }
  }
  for (const [ip, arr] of joinRate) {
    const live = arr.filter(t => now - t < 60000);
    if (live.length) joinRate.set(ip, live); else joinRate.delete(ip);
  }
  for (const [ip, t] of lobbyRate) { if (now - t > 30000) lobbyRate.delete(ip); }
}, 60000).unref();

function makeRoomId() {
  return crypto.randomBytes(3).toString('hex'); // e.g. 'a1b2c3'
}

class Room {
  constructor(id, creatorIp) {
    this.id = id;
    this.creatorIp = creatorIp || 'unknown';
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.public = false;        // public rooms are listed in the lobby
    this.country = countryForIp(creatorIp); // host country (coarse, cosmetic)
    this.flag = flagFor(this.country);
    this.clients = [null, null]; // [p1_socket, p2_socket]
    this.names   = {1:'Blue', 2:'Red'};
    this.pids    = {1:null, 2:null}; // player codes for anti-impersonation scoring
    this.board   = Array.from({length:ROWS}, () => new Int8Array(COLS));
    this.player  = 1;
    this.moves   = MPT;
    this.round   = 1;
    this.abilityCooldown = [0, 0];
    this.skipUsed = [false, false];
    this.started  = false;
    this.over     = false;
    this.startTime = Date.now(); // for time-to-victory scoring
  }

  playerCount() { return this.clients.filter(Boolean).length; }

  boardJSON() {
    // Serialize Int8Array rows as plain arrays for JSON
    return this.board.map(row => Array.from(row));
  }

  stateMsg() {
    return {
      type: 'state',
      board: this.boardJSON(),
      player: this.player,
      moves: this.moves,
      round: this.round,
      abilityCooldown: this.abilityCooldown,
      skipUsed: this.skipUsed,
      names: this.names,
    };
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    this.clients.forEach(c => { if (c && c._wsState === 1) c.send(s); });
  }

  sendTo(playerIdx, msg) { // playerIdx = 0 or 1
    const c = this.clients[playerIdx];
    if (c && c._wsState === 1) c.send(JSON.stringify(msg));
  }

  count(p) {
    let n=0;
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (this.board[r][c]===p) n++;
    return n;
  }

  reachableZones(p) {
    const zones = new Set([p]), enemy = p===1?2:1;
    let hasOwn=false;
    outer: for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++)
      if(this.board[r][c]===p && zoneOf(c)===p){hasOwn=true;break outer;}
    if(hasOwn) zones.add(0);
    let hasNeutral=false;
    outer2: for(let r=0;r<ROWS;r++) for(let c=ZONE_W;c<COLS-ZONE_W;c++)
      if(this.board[r][c]===p){hasNeutral=true;break outer2;}
    let hasEnemy=false;
    outer3: for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++)
      if(this.board[r][c]===p && zoneOf(c)===enemy){hasEnemy=true;break outer3;}
    if(hasNeutral && hasEnemy) zones.add(enemy);
    return zones;
  }

  canPlace(p, r, c) {
    if (this.board[r][c] !== 0) return false;
    return this.reachableZones(p).has(zoneOf(c));
  }

  evolve() {
    const nb = Array.from({length:ROWS}, () => new Int8Array(COLS));
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
      let n1=0, n2=0;
      for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
        if (!dr&&!dc) continue;
        const nr=r+dr, nc=c+dc;
        if (nr>=0&&nr<ROWS&&nc>=0&&nc<COLS) {
          if (this.board[nr][nc]===1) n1++; else if (this.board[nr][nc]===2) n2++;
        }
      }
      const tot=n1+n2, cur=this.board[r][c];
      if (cur)        { nb[r][c] = (tot===2||tot===3) ? cur : 0; }
      else if(tot===3){ nb[r][c] = n1>n2 ? 1 : n1<n2 ? 2 : (((r+c)&1)?1:2); } // deterministic tie-break, matches client
    }
    this.board = nb;
  }

  execBomb(p, r, c) {
    let killed = 0;
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
      const nr=r+dr, nc=c+dc;
      if (nr>=0&&nr<ROWS&&nc>=0&&nc<COLS && this.board[nr][nc]) {
        killed++; this.board[nr][nc]=0;
      }
    }
    this.abilityCooldown[p-1] = BOMB_CD;
    return killed;
  }

  finishTurn() {
    this.evolve();
    const p1 = this.count(1), p2 = this.count(2);
    if (this.player === 2) this.round++;
    const bothPlayed = this.round >= 2 || (this.round===1 && this.player===2);

    if (bothPlayed) {
      if (!p1 && !p2) { this.endGame(0, p1, p2); return; }
      if (!p1)        { this.endGame(2, p1, p2); return; }
      if (!p2)        { this.endGame(1, p1, p2); return; }
    }
    if (this.round > MAX_ROUNDS) {
      const winner = p1>p2 ? 1 : p2>p1 ? 2 : 0;
      this.endGame(winner, p1, p2); return;
    }

    this.abilityCooldown[0] = Math.max(0, this.abilityCooldown[0]-1);
    this.abilityCooldown[1] = Math.max(0, this.abilityCooldown[1]-1);
    this.player = this.player===1 ? 2 : 1;
    this.moves  = MPT;

    this.broadcast({ type:'evolve', board: this.boardJSON(), round: this.round });
    this.broadcast(this.stateMsg());
  }

  endGame(winner, p1, p2) {
    this.over = true;
    const elapsedSec = Math.round((Date.now() - this.startTime) / 1000);
    const byExtinction = (p1 === 0 || p2 === 0);
    // include the final board: when the game ends by extinction the 'evolve'
    // broadcast never fires, so without this clients would show a stale board
    this.broadcast({ type:'gameover', winner, p1, p2, round: this.round, names: this.names, board: this.boardJSON() });
    // record to leaderboard (online human-vs-human games only)
    if (winner !== 0) {
      const wName = this.names[winner] || 'Player';
      const margin = Math.abs(p1 - p2);
      const pts = computeScore({
        mode: 'online', byExtinction, round: this.round,
        elapsedSec, margin, winnerCells: winner === 1 ? p1 : p2,
      });
      recordResult(this.pids[winner], wName, pts, { mode:'online', winner:true, byExtinction, round:this.round });
      const lp = winner === 1 ? 2 : 1;
      const lName = this.names[lp] || 'Player';
      recordResult(this.pids[lp], lName, 0, { mode:'online', winner:false });
    }
    // clean up room after delay (cancelled if players restart)
    this.cleanupTimer = setTimeout(() => rooms.delete(this.id), 60000);
  }

  restart() {
    if (this.cleanupTimer) { clearTimeout(this.cleanupTimer); this.cleanupTimer = null; }
    this.board = Array.from({length:ROWS}, () => new Int8Array(COLS));
    this.player = 1; this.moves = MPT; this.round = 1;
    this.abilityCooldown = [0,0]; this.skipUsed = [false,false]; this.over = false;
    this.startTime = Date.now();
    this.broadcast({ type:'restart' });
    this.broadcast(this.stateMsg());
  }
}

// ── WebSocket handshake ───────────────────────────────────────────────────
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsAccept(key) {
  return crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
}

function upgradeToWS(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + wsAccept(key),
    '\r\n'
  ].join('\r\n'));

  socket._wsState = 1;
  socket._wsBuf = Buffer.alloc(0);
  socket._room  = null;
  socket._player = null;
  socket._ip = clientIp(req);

  socket.send = function(data) {
    if (socket.destroyed || socket._wsState !== 1) return;
    const payload = Buffer.from(data, 'utf8');
    const len     = payload.length;
    let header;
    if (len <= 125)        { header = Buffer.from([0x81, len]); }
    else if (len <= 65535) { header = Buffer.from([0x81, 126, len>>8, len&0xff]); }
    else {
      header = Buffer.allocUnsafe(10);
      header[0]=0x81; header[1]=127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  };

  socket.on('data', buf => {
    socket._wsBuf = Buffer.concat([socket._wsBuf, buf]);
    while (true) {
      const b = socket._wsBuf;
      if (b.length < 2) break;
      const masked   = (b[1] & 0x80) !== 0;
      let payLen     = b[1] & 0x7f;
      let offset     = 2;
      if (payLen === 126)      { if (b.length < 4) break; payLen = b.readUInt16BE(2); offset = 4; }
      else if (payLen === 127) { if (b.length < 10) break; payLen = Number(b.readBigUInt64BE(2)); offset = 10; }
      const needed = offset + (masked ? 4 : 0) + payLen;
      if (b.length < needed) break;
      let payload;
      if (masked) {
        const mask = b.slice(offset, offset+4);
        const raw  = b.slice(offset+4, offset+4+payLen);
        payload = Buffer.alloc(payLen);
        for (let i=0;i<payLen;i++) payload[i] = raw[i] ^ mask[i%4];
        offset += 4;
      } else {
        payload = b.slice(offset, offset+payLen);
      }
      socket._wsBuf = b.slice(offset + payLen);
      const opcode = b[0] & 0x0f;
      if (opcode === 8) { socket.destroy(); break; } // close
      if (opcode === 9) { // ping → pong
        socket.send(JSON.stringify({type:'pong'})); continue;
      }
      if (opcode === 1 || opcode === 2) {
        try { handleMessage(socket, JSON.parse(payload.toString('utf8'))); }
        catch(e) { console.error('WS parse error:', e.message); }
      }
    }
  });

  socket.on('close', () => { socket._wsState = 0; handleDisconnect(socket); });
  socket.on('error', () => { socket._wsState = 0; handleDisconnect(socket); });
}

// ── Message handler ───────────────────────────────────────────────────────
function handleMessage(socket, msg) {
  const { type } = msg;

  if (type === 'ping') { socket.send(JSON.stringify({type:'pong'})); return; }

  if (type === 'join') {
    const name = (msg.name||'Player').slice(0,20).trim() || 'Player';
    const pid = (typeof msg.pid === "string" && /^[a-z0-9]{8,40}$/i.test(msg.pid)) ? msg.pid : null;
    const ip = socket._ip || 'unknown';
    if (!joinAllowed(ip)) {
      socket.send(JSON.stringify({type:'error', fatal:true,
        msg:'Too many connection attempts from your network. Wait a minute and try again.'}));
      return;
    }
    let room;

    if (msg.room) {
      // explicit room code: it must exist — a typo'd code must NOT silently
      // create a brand-new room and strand the player "waiting"
      room = rooms.get(String(msg.room).toLowerCase());
      if (!room) {
        socket.send(JSON.stringify({type:'error', fatal:true,
          msg:'Room "'+String(msg.room).slice(0,12)+'" not found. Check the code with your opponent — rooms close when the host leaves.'}));
        return;
      }
      if (room.playerCount() >= 2 || room.started) {
        socket.send(JSON.stringify({type:'error', fatal:true, msg:'Room is full.'}));
        return;
      }
      // join as player 2
      socket._room   = room;
      socket._player = 2;
      room.clients[1] = socket;
      room.names[2]   = name;
      room.pids[2]    = pid;
      room.started    = true;
      room.broadcast({ type:'start', names: room.names });
      room.broadcast(room.stateMsg());
    } else {
      // create room as player 1 — capped per IP and server-wide
      if (roomsOwnedBy(ip) >= LIMITS.ROOMS_PER_IP) {
        socket.send(JSON.stringify({type:'error', fatal:true,
          msg:'Too many open rooms from your connection ('+LIMITS.ROOMS_PER_IP+' max). Close or finish one first.'}));
        return;
      }
      const counts = countRooms();
      if (counts.total >= LIMITS.MAX_ROOMS_TOTAL) {
        socket.send(JSON.stringify({type:'error', fatal:true,
          msg:'The server is at capacity right now. Please try again in a few minutes.'}));
        return;
      }
      const wantPublic = msg.public === true;
      if (wantPublic && counts.pub >= LIMITS.MAX_PUBLIC_ROOMS) {
        socket.send(JSON.stringify({type:'error', fatal:true,
          msg:'The public lobby is full right now. Create a private room or try again shortly.'}));
        return;
      }
      const id = makeRoomId();
      room = new Room(id, ip);
      room.public = wantPublic;
      rooms.set(id, room);
      socket._room   = room;
      socket._player = 1;
      room.clients[0] = socket;
      room.names[1]   = name;
      room.pids[1]    = pid;
      socket.send(JSON.stringify({ type:'waiting', room: id, public: room.public,
        flag: room.flag, country: room.country }));
    }
    return;
  }

  const room = socket._room;
  if (!room) { socket.send(JSON.stringify({type:'error', msg:'Not in a room'})); return; }
  const p = socket._player;

  if (type === 'move') {
    if (room.over || room.player !== p) return;
    const { r, c } = msg;
    if (!room.canPlace(p, r, c)) {
      socket.send(JSON.stringify({type:'error', msg:'Invalid placement'})); return;
    }
    room.board[r][c] = p;
    room.moves--;
    room.broadcast({ type:'move_ok', r, c, player: p, moves: room.moves });
    if (room.moves === 0) room.finishTurn();
    return;
  }

  if (type === 'bomb') {
    if (room.over || room.player !== p || room.abilityCooldown[p-1] > 0) return;
    if (room.round < BOMB_UNLOCK) {
      socket.send(JSON.stringify({type:'error', msg:'Bomb unlocks at round '+BOMB_UNLOCK})); return;
    }
    const { r, c } = msg;
    const killed = room.execBomb(p, r, c);
    room.broadcast({ type:'bomb_ok', r, c, player: p, killed });
    // bombing consumes the turn: evolve and pass to the other player
    room.moves = 0;
    room.finishTurn();
    return;
  }

  if (type === 'skip') {
    if (room.over || room.player !== p || room.skipUsed[p-1]) return;
    room.skipUsed[p-1] = true;
    room.moves = 0;
    room.broadcast({ type:'skip_ok', player: p });
    room.finishTurn();
    return;
  }

  if (type === 'chat') {
    // chat is only allowed once the match has two players and has started,
    // so lobby/waiting rooms can't be used as an anonymous message relay.
    if (!room.started || room.playerCount() < 2) return;
    // sanitize: collapse whitespace, strip control chars, hard length cap.
    let text = String(msg.text == null ? '' : msg.text)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    if (!text) return;
    // per-player rate limit: max ~5 messages per 5s sliding window.
    const now = Date.now();
    room.chatTimes = room.chatTimes || { 1: [], 2: [] };
    let arr = (room.chatTimes[p] || []).filter(t => now - t < 5000);
    if (arr.length >= 5) {
      socket.send(JSON.stringify({ type:'chat_throttled' }));
      room.chatTimes[p] = arr;
      return;
    }
    arr.push(now);
    room.chatTimes[p] = arr;
    room.broadcast({ type:'chat', player: p, name: room.names[p] || 'Player', text, ts: now });
    return;
  }

  if (type === 'restart') {
    if (room.playerCount() < 2) return;
    room.restart();
    return;
  }
}

function handleDisconnect(socket) {
  const room = socket._room;
  if (!room) return;
  const idx = socket._player - 1;
  room.clients[idx] = null;
  if (room.playerCount() > 0) {
    room.broadcast({ type:'opponent_left' });
  } else {
    rooms.delete(room.id);
  }
}

// ── HTTP long-polling fallback transport ──────────────────────────────────
// For hosts whose proxy drops WebSocket upgrades (some managed Node platforms).
// A "session" wraps a fake socket exposing the same surface the rooms code
// uses (._wsState, .send, ._room, ._player), so handleMessage/Room work
// unchanged over plain HTTP:
//   POST /api/send  {msg:{type:'join',...}}        → {sid}   (creates session)
//   POST /api/send  {sid, msg:{...}}               → {sid}
//   GET  /api/poll?sid=xxx                          → {msgs:[...]} (held ≤25s)
const sessions = new Map(); // sid → session
const POLL_HOLD_MS = 25000, SESSION_TTL_MS = 60000;

function createSession(ip) {
  const sid = crypto.randomBytes(12).toString('hex');
  const sess = { sid, ip: ip || 'unknown', queue: [], pending: null, pendingTimer: null, lastSeen: Date.now() };
  sess.socket = {
    _wsState: 1, _room: null, _player: null, _ip: ip || 'unknown', destroyed: false,
    send(str) { sess.queue.push(str); flushPoll(sess); },
    destroy() { this._wsState = 0; this.destroyed = true; },
  };
  sessions.set(sid, sess);
  return sess;
}

function flushPoll(sess) {
  if (!sess.pending || !sess.queue.length) return;
  const res = sess.pending;
  sess.pending = null;
  if (sess.pendingTimer) { clearTimeout(sess.pendingTimer); sess.pendingTimer = null; }
  const body = JSON.stringify({ msgs: sess.queue.map(s => JSON.parse(s)) });
  sess.queue = [];
  try {
    res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-cache'});
    res.end(body);
  } catch (e) {}
}

// reap sessions that stopped polling (treat as disconnect)
setInterval(() => {
  const now = Date.now();
  for (const [sid, sess] of sessions) {
    if (now - sess.lastSeen > SESSION_TTL_MS) {
      sess.socket._wsState = 0;
      handleDisconnect(sess.socket);
      if (sess.pending) { try { sess.pending.writeHead(410); sess.pending.end(); } catch (e) {} }
      sessions.delete(sid);
    }
  }
}, 15000).unref();

function handleApi(req, res, u) {
  const JSON_HDR = {'Content-Type':'application/json','Cache-Control':'no-cache'};

  // public lobby: list of open public rooms waiting for an opponent
  if (u.pathname === '/api/lobby' && req.method === 'GET') {
    const ip = clientIp(req);
    const now = Date.now();
    const last = lobbyRate.get(ip) || 0;
    if (now - last < LIMITS.LOBBY_RATE_MS) {
      // too frequent — return 429 but cheap (no body work)
      res.writeHead(429, JSON_HDR); res.end('{"rooms":[],"throttled":true}'); return true;
    }
    lobbyRate.set(ip, now);
    const list = [];
    for (const r of rooms.values()) {
      if (r.public && !r.started && !r.over && r.playerCount() === 1) {
        list.push({ id: r.id, host: r.names[1] || 'Player',
          flag: r.flag, country: r.country,
          waiting: Math.round((now - r.createdAt) / 1000) });
      }
    }
    list.sort((a, b) => a.waiting - b.waiting); // freshest first
    res.writeHead(200, JSON_HDR);
    res.end(JSON.stringify({ rooms: list.slice(0, 50), total: list.length }));
    return true;
  }

  // public leaderboard (read)
  if (u.pathname === '/api/leaderboard' && req.method === 'GET') {
    serveLeaderboard(res); return true;
  }

  // client reports a finished vs-CPU game (write) — offline games the server can't see
  if (u.pathname === '/api/cpu-result' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) {
        res.writeHead(400, JSON_HDR); res.end('{"error":"bad json"}'); return;
      }
      const ip = clientIp(req);
      if (!joinAllowed(ip)) { res.writeHead(429, JSON_HDR); res.end('{"error":"rate"}'); return; }
      let pts = 0, recorded = false;
      try {
        pts = handleCpuResult(parsed);
        recorded = (pts !== false);
      } catch (e) { console.error('cpu-result:', e.message); }
      res.writeHead(200, JSON_HDR);
      res.end(JSON.stringify({ ok: recorded, points: recorded ? (pts||0) : 0,
        rejected: !recorded ? 'name_owned_by_another_code' : undefined }));
    });
    return true;
  }

  // claim or verify a display name for a player code (pid)
  if (u.pathname === '/api/claim-name' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) {
        res.writeHead(400, JSON_HDR); res.end('{"error":"bad json"}'); return;
      }
      const pid = parsed.pid;
      const name = String(parsed.name || '').slice(0, 20).trim();
      if (!pid || !/^[a-z0-9]{8,40}$/i.test(pid) || !name) {
        res.writeHead(200, JSON_HDR); res.end('{"ok":false,"reason":"invalid"}'); return;
      }
      const mine = LB.players[pid];
      if (mine) { // already own a record — renaming, allowed unless colliding
        const collision = Object.entries(LB.players)
          .some(([k, p]) => k !== pid && p.name.toLowerCase() === name.toLowerCase());
        if (collision) { res.writeHead(200, JSON_HDR); res.end('{"ok":false,"reason":"taken"}'); return; }
        mine.name = name; saveLB();
        res.writeHead(200, JSON_HDR); res.end('{"ok":true,"owned":true}'); return;
      }
      // new pid: name must be free
      const taken = Object.values(LB.players).some(p => p.name.toLowerCase() === name.toLowerCase());
      if (taken) { res.writeHead(200, JSON_HDR); res.end('{"ok":false,"reason":"taken"}'); return; }
      res.writeHead(200, JSON_HDR); res.end('{"ok":true,"owned":false}'); // free to use
    });
    return true;
  }

  if (u.pathname === '/api/poll' && req.method === 'GET') {
    const sess = sessions.get(String(u.query.sid || ''));
    if (!sess) { res.writeHead(410, JSON_HDR); res.end('{"error":"no session"}'); return true; }
    sess.lastSeen = Date.now();
    if (sess.queue.length) {
      const body = JSON.stringify({ msgs: sess.queue.map(s => JSON.parse(s)) });
      sess.queue = [];
      res.writeHead(200, JSON_HDR); res.end(body); return true;
    }
    if (sess.pending) { try { sess.pending.writeHead(200, JSON_HDR); sess.pending.end('{"msgs":[]}'); } catch (e) {} }
    sess.pending = res;
    sess.pendingTimer = setTimeout(() => {
      if (sess.pending === res) {
        sess.pending = null; sess.pendingTimer = null;
        try { res.writeHead(200, JSON_HDR); res.end('{"msgs":[]}'); } catch (e) {}
      }
    }, POLL_HOLD_MS);
    sess.pendingTimer.unref && sess.pendingTimer.unref();
    req.on('close', () => {
      if (sess.pending === res) {
        sess.pending = null;
        if (sess.pendingTimer) { clearTimeout(sess.pendingTimer); sess.pendingTimer = null; }
      }
    });
    return true;
  }

  if (u.pathname === '/api/send' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 16384) req.destroy(); });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { res.writeHead(400, JSON_HDR); res.end('{"error":"bad json"}'); return; }
      let sess;
      const ip = clientIp(req);
      if (parsed.sid && sessions.has(parsed.sid)) sess = sessions.get(parsed.sid);
      else if (parsed.msg && parsed.msg.type === 'join') {
        if (sessionCountFor(ip) >= LIMITS.SESSIONS_PER_IP) {
          res.writeHead(429, JSON_HDR);
          res.end(JSON.stringify({error:'too many sessions from your network'}));
          return;
        }
        sess = createSession(ip);
      }
      else { res.writeHead(410, JSON_HDR); res.end('{"error":"no session"}'); return; }
      sess.lastSeen = Date.now();
      try { handleMessage(sess.socket, parsed.msg); } catch (e) { console.error('api/send:', e.message); }
      res.writeHead(200, JSON_HDR);
      res.end(JSON.stringify({ sid: sess.sid }));
    });
    return true;
  }
  return false;
}

// ── HTTP server ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname && u.pathname.startsWith('/api/')) {
    if (handleApi(req, res, u)) return;
    res.writeHead(404); res.end('Unknown API'); return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end('Method Not Allowed'); return;
  }
  let pathname = u.pathname;
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname.endsWith('/')) pathname += 'index.html'; // /play/ → /play/index.html

  const filepath = path.normalize(path.join(ROOT, pathname));
  if (!filepath.startsWith(ROOT + path.sep) && filepath !== ROOT) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.stat(filepath, (serr, st) => {
    if (!serr && st.isDirectory()) { // /play → redirigir a /play/
      res.writeHead(301, { Location: pathname + '/' }); res.end(); return;
    }
    fs.readFile(filepath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const mime = MIME[path.extname(filepath).toLowerCase()] || 'application/octet-stream';
      const ext = path.extname(filepath).toLowerCase();
    // JS/HTML must never be served stale (mobile browsers + hosting proxies
    // cache aggressively and keep running old game code); assets can cache.
    const cache = (ext==='.js'||ext==='.html') ? 'no-store, must-revalidate' : 'public, max-age=3600';
    res.writeHead(200, {'Content-Type':mime,'Content-Length':data.length,'Cache-Control':cache});
      if (req.method === 'HEAD') { res.end(); return; }
      res.end(data);
    });
  });
});

server.on('upgrade', upgradeToWS);

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  Conway\'s Conquerors v6.0 (competitive AI tuning) — server up on port ' + PORT);
  console.log('  Routes: /  /conquerors/  /play/  /api/*');
  console.log('  Online play: WebSocket + automatic HTTP-polling fallback');
  console.log('  Limits: ' + LIMITS.ROOMS_PER_IP + ' rooms/IP · ' + LIMITS.JOINS_PER_MIN + ' joins/min/IP');
  console.log('');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error('\n  Port '+PORT+' in use. Try PORT=3001 node server.js\n');
  else console.error(err);
  process.exit(1);
});
