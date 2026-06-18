/**
 * Conway's Conquerors — game.js v5.0
 * Features: editable names, animated tutorial, smarter CPU, online multiplayer
 */
'use strict';

// roundRect polyfill for older browsers
if(typeof CanvasRenderingContext2D!=='undefined' && !CanvasRenderingContext2D.prototype.roundRect){
  CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){
    const radius=Array.isArray(r)?r[0]:r;
    this.beginPath();
    this.moveTo(x+radius,y);
    this.arcTo(x+w,y,x+w,y+h,radius);
    this.arcTo(x+w,y+h,x,y+h,radius);
    this.arcTo(x,y+h,x,y,radius);
    this.arcTo(x,y,x+w,y,radius);
    this.closePath();
    return this;
  };
}

const ROWS=26,COLS=28,CS=22,MPT=4,MAX_ROUNDS=12,ZONE_W=8,BOMB_CD=3,BOMB_UNLOCK=7;
const GAME_VERSION='6.0';
const zoneOf=c=>c<ZONE_W?1:c>=COLS-ZONE_W?2:0;
const COLOR={
  C1:'#3d8ef0',C2:'#e85252',
  Z1:'#091523',Z2:'#1a0808',ZN:'#0d0f18',
  G1:'#152840',G2:'#401515',GN:'#1a1a22',
  HOK:'#a0f060',HNO:'#604040',HBOMB:'#c8a020',
  BAREA:'rgba(200,160,32,0.18)',DIV:'rgba(255,255,255,0.07)',
  REACH:'rgba(255,255,255,0.025)',
};

// ── State ─────────────────────────────────────────────────────────────────
let board,player,moves,round,hover,locked,abilityMode;
let abilityCooldown,skipUsed;
let gameGen=0; // bumped on every reset; stale CPU/evolution timers check against it
let names={1:'Blue',2:'Red'};
let gameMode='local'; // 'local'|'cpu'|'online'
let cpuDifficulty='normal';
let gameStartTime=0; // ms timestamp when the current game began (for scoring)

// ── Player identity (anti-impersonation) ──────────────────────────────────
// A secret player CODE (pid) lives only in this browser's localStorage and is
// sent with every scored result. The server keys the leaderboard by pid, so a
// score under your NAME only counts if it also carries your CODE. The code can
// be backed up / restored so you keep your identity across devices.
const PlayerID = {
  get(){
    let id=null;
    try{ id=localStorage.getItem('cc_pid'); }catch(e){}
    if(!id || !/^[a-z0-9]{8,40}$/i.test(id)){
      id=this._gen();
      try{ localStorage.setItem('cc_pid', id); }catch(e){}
    }
    return id;
  },
  _gen(){
    // 24 hex chars from crypto if available, else Math.random fallback
    try{
      const a=new Uint8Array(12); crypto.getRandomValues(a);
      return [...a].map(b=>b.toString(16).padStart(2,'0')).join('');
    }catch(e){
      let s=''; for(let i=0;i<24;i++) s+=Math.floor(Math.random()*16).toString(16);
      return s;
    }
  },
  set(code){
    if(/^[a-z0-9]{8,40}$/i.test(code)){
      try{ localStorage.setItem('cc_pid', code); }catch(e){}
      return true;
    }
    return false;
  },
  getName(){ try{ return localStorage.getItem('cc_pname')||''; }catch(e){ return ''; } },
  setName(n){ try{ localStorage.setItem('cc_pname', n); }catch(e){} },
};
let guidedMode=false;        // when true, show evolution preview before applying
let previewActive=false;     // currently showing the ghost preview
let previewBoard=null;       // the computed next-gen board (for ghost render)
let placedThisTurn=[];       // [[r,c],...] cells placed this turn (to undo on cancel)
let onlinePlayer=null; // which player we are (1 or 2) in online mode
let fatalNetError=false; // set on unrecoverable join errors; resetGame reloads
let ws=null,roomId=null;


// ── Atari-style sound synthesis (Web Audio, no external files) ─────────────
const SND={
  ctx:null,muted:false,
  init(){
    if(this.ctx) return;
    try{this.ctx=new (window.AudioContext||window.webkitAudioContext)();}
    catch(e){this.ctx=null;}
    // restore mute pref from localStorage
    try{if(localStorage.getItem('cc_muted')==='1') this.muted=true;}catch(e){}
  },
  resume(){if(this.ctx&&this.ctx.state==='suspended')this.ctx.resume();},
  setMuted(m){
    this.muted=!!m;
    try{localStorage.setItem('cc_muted',m?'1':'0');}catch(e){}
  },
  // core 8-bit beep: square wave, optional pitch sweep, short envelope
  beep(freq,dur,type='square',sweep=0,vol=0.08){
    if(!this.ctx||this.muted) return;
    const t=this.ctx.currentTime;
    const osc=this.ctx.createOscillator();
    const gain=this.ctx.createGain();
    osc.type=type;
    osc.frequency.setValueAtTime(freq,t);
    if(sweep) osc.frequency.linearRampToValueAtTime(freq+sweep,t+dur);
    // ADSR-like envelope (Atari TIA-ish)
    gain.gain.setValueAtTime(0,t);
    gain.gain.linearRampToValueAtTime(vol,t+0.005);
    gain.gain.exponentialRampToValueAtTime(0.001,t+dur);
    osc.connect(gain);gain.connect(this.ctx.destination);
    osc.start(t);osc.stop(t+dur+0.02);
  },
  // noise burst (for explosions/bombs)
  noise(dur,vol=0.12,filter=800){
    if(!this.ctx||this.muted) return;
    const t=this.ctx.currentTime;
    const sr=this.ctx.sampleRate;
    const buf=this.ctx.createBuffer(1,Math.floor(sr*dur),sr);
    const data=buf.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
    const src=this.ctx.createBufferSource();src.buffer=buf;
    const bp=this.ctx.createBiquadFilter();bp.type='lowpass';bp.frequency.value=filter;
    const gain=this.ctx.createGain();
    gain.gain.setValueAtTime(vol,t);
    gain.gain.exponentialRampToValueAtTime(0.001,t+dur);
    src.connect(bp);bp.connect(gain);gain.connect(this.ctx.destination);
    src.start(t);src.stop(t+dur+0.02);
  },
  // ── Game sound effects ──
  place(player){
    // short pitched blip — blue=higher, red=lower
    this.beep(player===1?440:330,0.08,'square',60,0.07);
  },
  invalid(){this.beep(120,0.12,'square',-40,0.06);},
  preview(){this.beep(660,0.05,'triangle',0,0.05);this.beep(880,0.06,'triangle',0,0.05);},
  confirm(){
    // ascending two-tone
    this.beep(523,0.07,'square',0,0.07);
    setTimeout(()=>this.beep(784,0.1,'square',0,0.08),70);
  },
  cancel(){this.beep(440,0.06,'square',-180,0.06);},
  evolve(){
    // tick-tick-tick burst
    this.beep(1200,0.03,'square',0,0.04);
    setTimeout(()=>this.beep(900,0.03,'square',0,0.04),60);
    setTimeout(()=>this.beep(600,0.05,'square',0,0.05),120);
  },
  bomb(){
    this.beep(180,0.15,'square',-140,0.1);
    this.noise(0.4,0.13,1200);
  },
  bombReady(){this.beep(700,0.05,'triangle',200,0.06);},
  skip(){this.beep(330,0.1,'triangle',-100,0.05);},
  click(){this.beep(800,0.02,'square',0,0.04);},
  win(){
    // ascending fanfare
    const notes=[523,659,784,1047];
    notes.forEach((n,i)=>setTimeout(()=>this.beep(n,0.15,'square',0,0.09),i*100));
  },
  lose(){
    // descending sad
    const notes=[392,330,294,247];
    notes.forEach((n,i)=>setTimeout(()=>this.beep(n,0.18,'triangle',0,0.07),i*120));
  },
  draw(){
    this.beep(440,0.15,'triangle',0,0.07);
    setTimeout(()=>this.beep(440,0.15,'triangle',0,0.07),200);
  },
  turnStart(){this.beep(550,0.04,'triangle',150,0.04);},
  // ── Text-to-speech (uses native browser speechSynthesis) ──
  // English accent guaranteed: u.lang='en-US' forces an English voice even on
  // Spanish-locale devices, and voices are cached via onvoiceschanged because
  // getVoices() returns an EMPTY list on first call in most browsers — the old
  // code found no voice and fell back to the device default (Spanish accent).
  _voices:[],
  _loadVoices(){try{this._voices=speechSynthesis.getVoices()||[];}catch(e){}},
  speak(text){
    if(this.muted) return;
    if(typeof speechSynthesis==='undefined') return;
    try{
      speechSynthesis.cancel(); // stop any prior utterance
      const u=new SpeechSynthesisUtterance(text);
      u.rate=0.95;u.pitch=1.0;u.volume=0.9;
      u.lang='en-US';
      if(!this._voices.length) this._loadVoices();
      const v=this._voices;
      const pick=
        v.find(x=>x.lang==='en-US'&&/Google|Natural|Premium|Enhanced/i.test(x.name))||
        v.find(x=>x.lang==='en-US')||
        v.find(x=>/^en[-_]GB/i.test(x.lang))||
        v.find(x=>/^en[-_]/i.test(x.lang));
      if(pick) u.voice=pick;
      speechSynthesis.speak(u);
    }catch(e){}
  },
  stopSpeech(){
    // show the running script version in the header — instantly tells you
// whether a phone is executing stale cached code
(function(){const v=document.querySelector('.ver');if(v)v.textContent='v'+GAME_VERSION;})();

if(typeof speechSynthesis!=='undefined'){
      try{speechSynthesis.cancel();}catch(e){}
    }
  },
};

// show the running script version in the header — instantly tells you
// whether a phone is executing stale cached code
(function(){const v=document.querySelector('.ver');if(v)v.textContent='v'+GAME_VERSION;})();

if(typeof speechSynthesis!=='undefined'){
  SND._loadVoices();
  try{speechSynthesis.onvoiceschanged=()=>SND._loadVoices();}catch(e){}
}

const canvas=document.getElementById('c'),ctx=canvas.getContext('2d');
canvas.width=COLS*CS; canvas.height=ROWS*CS;

// ── Visual FX engine ──────────────────────────────────────────────────────
// One-shot effects (cell deaths/births on evolution, bomb shockwave) driven by
// a rAF loop that re-renders only while effects are alive. Purely cosmetic:
// game state is never touched here.
const FX={
  list:[],running:false,
  add(e){e.start=performance.now();this.list.push(e);this._run();},
  clear(){this.list=[];},
  _run(){
    if(this.running)return;
    this.running=true;
    const tick=()=>{
      const now=performance.now();
      this.list=this.list.filter(e=>now-e.start<e.dur);
      render();
      if(this.list.length) requestAnimationFrame(tick);
      else {this.running=false;render();}
    };
    requestAnimationFrame(tick);
  }
};
function addEvolveFX(oldB,newB){
  for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
    const o=oldB[r][c],n=newB[r][c];
    if(o===n)continue;
    if(o&&!n)FX.add({type:'die',r,c,p:o,dur:420});
    else FX.add({type:'born',r,c,p:n,dur:420});
  }
}
function addBombFX(r,c){FX.add({type:'bomb',r,c,dur:550});}
const easeOut=t=>1-Math.pow(1-t,3);

// ── Territory ─────────────────────────────────────────────────────────────
function reachableZones(p){
  const z=new Set([p]),e=p===1?2:1;
  let a=false;
  outer: for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) if(board[r][c]===p&&zoneOf(c)===p){a=true;break outer;}
  if(a) z.add(0);
  let n=false;
  outer2: for(let r=0;r<ROWS;r++) for(let c=ZONE_W;c<COLS-ZONE_W;c++) if(board[r][c]===p){n=true;break outer2;}
  let en=false;
  outer3: for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) if(board[r][c]===p&&zoneOf(c)===(e)){en=true;break outer3;}
  if(n&&en) z.add(e);
  return z;
}

function canPlace(r,c){
  if(board[r][c]!==0) return false;
  return reachableZones(player).has(zoneOf(c));
}

function accessLabel(p){
  const z=reachableZones(p),e=p===1?2:1;
  if(z.has(e)) return 'full access';
  if(z.has(0)) return 'home + neutral';
  return 'home zone only';
}

// ── Helpers ───────────────────────────────────────────────────────────────
const count=p=>{let n=0;for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)if(board[r][c]===p)n++;return n;};
const setMsg=(t,cls='')=>{const e=document.getElementById('msg');e.textContent=t;e.className=cls;};

function getCell(ev){
  const rect=canvas.getBoundingClientRect();
  // pointer/mouse events carry clientX directly; legacy touch events need
  // changedTouches (ev.touches is EMPTY on touchend — the finger lifted)
  const src=(ev.clientX!=null)?ev
    :(ev.changedTouches&&ev.changedTouches[0])||(ev.touches&&ev.touches[0]);
  if(!src||src.clientX==null) return null;
  // scale from CSS pixels to canvas pixels (canvas is scaled down on mobile)
  const sx=canvas.width/rect.width,sy=canvas.height/rect.height;
  const col=Math.floor((src.clientX-rect.left)*sx/CS);
  const row=Math.floor((src.clientY-rect.top)*sy/CS);
  return(row>=0&&row<ROWS&&col>=0&&col<COLS)?[row,col]:null;
}

// ── HUD ───────────────────────────────────────────────────────────────────
function updateHUD(){
  const p1=count(1),p2=count(2),tot=Math.max(1,p1+p2);
  document.getElementById('rnd-val').textContent=round+'/'+MAX_ROUNDS;
  document.getElementById('s1').textContent=p1;
  document.getElementById('s2').textContent=p2;
  document.getElementById('pb1').style.width=Math.round(p1/tot*100)+'%';
  document.getElementById('pb2').style.width=Math.round(p2/tot*100)+'%';
  document.getElementById('name1-hud').textContent=names[1];
  document.getElementById('name2-hud').textContent=names[2];

  [1,2].forEach(p=>{
    const myTurn=player===p&&!locked;
    const isCPU=gameMode==='cpu'&&p===2;
    const isOnlineOpp=gameMode==='online'&&p!==onlinePlayer;
    document.getElementById('pc'+p).classList.toggle('active',myTurn);
    document.getElementById('pi'+p).textContent=myTurn
      ?(isCPU?'thinking…':isOnlineOpp?'opponent…':moves+' left · '+accessLabel(p)):'';
    const cd=abilityCooldown[p-1],ab=document.getElementById('ab'+p);
    const canBomb=myTurn&&!isCPU&&!(gameMode==='online'&&p!==onlinePlayer);
    if(round<BOMB_UNLOCK){ab.textContent='Bomb 🔒R'+BOMB_UNLOCK;ab.disabled=true;ab.classList.remove('ready');}
    else if(cd>0){ab.textContent='Bomb cd:'+cd;ab.disabled=true;ab.classList.remove('ready');}
    else{ab.textContent='Bomb';ab.disabled=!canBomb;ab.classList.toggle('ready',canBomb);}
    const sb=document.getElementById('skip'+p);
    if(sb){
      const used=skipUsed[p-1];
      const canSkip=myTurn&&!isCPU&&!(gameMode==='online'&&p!==onlinePlayer)&&!used;
      sb.textContent=used?'Skip ✗':'Skip';
      sb.disabled=!canSkip;
      sb.classList.toggle('used',used);
    }
  });
}

// ── Render ────────────────────────────────────────────────────────────────
function render(){
  const[hr,hc]=hover||[-1,-1];
  const zones=locked?new Set():reachableZones(player);
  for(let r=0;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      const x=c*CS,y=r*CS,v=board[r][c],z=zoneOf(c);
      // zone background first, rounded cell on top — "specimen in a dish" look
      ctx.fillStyle=z===1?COLOR.Z1:z===2?COLOR.Z2:COLOR.ZN;
      ctx.fillRect(x,y,CS,CS);
      if(!locked&&!v&&zones.has(z)){ctx.fillStyle=COLOR.REACH;ctx.fillRect(x,y,CS,CS);}
      ctx.strokeStyle=z===1?COLOR.G1:z===2?COLOR.G2:COLOR.GN;
      ctx.lineWidth=0.5;ctx.strokeRect(x+.25,y+.25,CS-.5,CS-.5);
      if(v){
        ctx.fillStyle=v===1?COLOR.C1:COLOR.C2;
        ctx.beginPath();ctx.roundRect(x+1.5,y+1.5,CS-3,CS-3,4.5);ctx.fill();
        // subtle top bevel + bottom shade for a soft 3D capsule feel
        ctx.fillStyle='rgba(255,255,255,0.16)';
        ctx.beginPath();ctx.roundRect(x+3,y+3,CS-6,(CS-6)*0.42,3);ctx.fill();
        ctx.fillStyle='rgba(0,0,0,0.22)';
        ctx.beginPath();ctx.roundRect(x+3,y+CS-5.5,CS-6,2.5,1.5);ctx.fill();
      }
      // bomb targeting: show the FULL 3×3 blast area (empty cells included)
      if(abilityMode&&hover&&!locked&&Math.max(Math.abs(r-hr),Math.abs(c-hc))<=1){
        ctx.fillStyle=COLOR.BAREA;ctx.fillRect(x,y,CS,CS);
      }
      if(!locked&&r===hr&&c===hc){
        ctx.strokeStyle=abilityMode?COLOR.HBOMB:canPlace(r,c)?COLOR.HOK:COLOR.HNO;
        ctx.lineWidth=1.5;ctx.strokeRect(x+.75,y+.75,CS-1.5,CS-1.5);
      }
    }
  }
  // gold ring on cells placed this turn (helps track your own move)
  if(!previewActive&&!locked){
    ctx.strokeStyle='rgba(200,160,32,0.65)';ctx.lineWidth=1;
    placedThisTurn.forEach(([pr,pc])=>{
      if(board[pr][pc])ctx.strokeRect(pc*CS+3.5,pr*CS+3.5,CS-7,CS-7);
    });
  }
  // ── guided preview ghost overlay ──
  if(previewActive&&previewBoard){
    for(let r=0;r<ROWS;r++){
      for(let c=0;c<COLS;c++){
        const cur=board[r][c],nxt=previewBoard[r][c];
        if(cur===nxt) continue;
        const x=c*CS,y=r*CS;
        if(cur!==0&&nxt===0){
          // dying cell — red X / fade
          ctx.fillStyle='rgba(0,0,0,0.45)';ctx.fillRect(x,y,CS,CS);
          ctx.strokeStyle='rgba(255,90,90,0.9)';ctx.lineWidth=1.5;
          ctx.beginPath();
          ctx.moveTo(x+5,y+5);ctx.lineTo(x+CS-5,y+CS-5);
          ctx.moveTo(x+CS-5,y+5);ctx.lineTo(x+5,y+CS-5);
          ctx.stroke();
        } else if(cur===0&&nxt!==0){
          // being born — pulsing ghost in team color
          ctx.fillStyle=nxt===1?'rgba(61,142,240,0.5)':'rgba(232,82,82,0.5)';
          ctx.fillRect(x+3,y+3,CS-6,CS-6);
          ctx.strokeStyle=nxt===1?'rgba(160,200,255,0.9)':'rgba(255,180,180,0.9)';
          ctx.lineWidth=1;ctx.strokeRect(x+2.5,y+2.5,CS-5,CS-5);
        }
      }
    }
  }

  // ── one-shot FX overlays (evolution diff + bomb shockwave) ──
  if(FX.list.length){
    const now=performance.now();
    for(const e of FX.list){
      const t=Math.min(1,(now-e.start)/e.dur);
      const x=e.c*CS,y=e.r*CS;
      if(e.type==='die'){
        // ghost of the dead cell shrinking & fading out
        const s=(1-easeOut(t))*(CS-3),off=(CS-s)/2;
        if(s>0.5){
          ctx.globalAlpha=(1-t)*0.85;
          ctx.fillStyle=e.p===1?COLOR.C1:COLOR.C2;
          ctx.beginPath();ctx.roundRect(x+off,y+off,s,s,Math.min(4.5,s/2));ctx.fill();
          ctx.globalAlpha=1;
        }
      } else if(e.type==='born'){
        // repaint bg, then the new cell scaling up + a bright expanding ring
        const z=zoneOf(e.c);
        ctx.fillStyle=z===1?COLOR.Z1:z===2?COLOR.Z2:COLOR.ZN;
        ctx.fillRect(x,y,CS,CS);
        const s=easeOut(t)*(CS-3),off=(CS-s)/2;
        if(s>0.5){
          ctx.fillStyle=e.p===1?COLOR.C1:COLOR.C2;
          ctx.beginPath();ctx.roundRect(x+off,y+off,s,s,Math.min(4.5,s/2));ctx.fill();
        }
        const ring=easeOut(t)*CS*1.1;
        ctx.globalAlpha=(1-t)*0.7;
        ctx.strokeStyle=e.p===1?'#9cc6ff':'#ffb0b0';
        ctx.lineWidth=1.25;
        ctx.strokeRect(x+CS/2-ring/2,y+CS/2-ring/2,ring,ring);
        ctx.globalAlpha=1;
      } else if(e.type==='bomb'){
        const cx=x+CS/2,cy=y+CS/2,rad=easeOut(t)*CS*2.8;
        ctx.globalAlpha=(1-t)*0.3;
        ctx.fillStyle='#c8a020';
        ctx.beginPath();ctx.arc(cx,cy,rad*0.85,0,Math.PI*2);ctx.fill();
        ctx.globalAlpha=1-t;
        ctx.strokeStyle='#e8c860';ctx.lineWidth=3*(1-t)+1;
        ctx.beginPath();ctx.arc(cx,cy,rad,0,Math.PI*2);ctx.stroke();
        ctx.globalAlpha=1;
      }
    }
  }

  ctx.strokeStyle=COLOR.DIV;ctx.lineWidth=1;
  [ZONE_W,COLS-ZONE_W].forEach(col=>{
    ctx.beginPath();ctx.moveTo(col*CS,0);ctx.lineTo(col*CS,ROWS*CS);ctx.stroke();
  });

  // ── subtle lab "petri dish" tint: blue left → red right ──
  const W=COLS*CS,H=ROWS*CS;
  const grad=ctx.createLinearGradient(0,0,W,0);
  grad.addColorStop(0,'rgba(61,142,240,0.06)');
  grad.addColorStop(0.42,'rgba(61,142,240,0.0)');
  grad.addColorStop(0.5,'rgba(255,255,255,0.015)');
  grad.addColorStop(0.58,'rgba(232,82,82,0.0)');
  grad.addColorStop(1,'rgba(232,82,82,0.05)');
  ctx.fillStyle=grad;
  ctx.fillRect(0,0,W,H);

  // soft glow along the centerline (the "membrane" between colonies)
  const cx=W/2;
  const cg=ctx.createLinearGradient(cx-14,0,cx+14,0);
  cg.addColorStop(0,'rgba(200,210,255,0)');
  cg.addColorStop(0.5,'rgba(210,220,255,0.05)');
  cg.addColorStop(1,'rgba(255,210,210,0)');
  ctx.fillStyle=cg;
  ctx.fillRect(cx-14,0,28,H);
}

// ── Conway evolution ──────────────────────────────────────────────────────
function evolve(){
  const nb=Array.from({length:ROWS},()=>new Int8Array(COLS));
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    let n1=0,n2=0;
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      if(!dr&&!dc) continue;
      const nr=r+dr,nc=c+dc;
      if(nr>=0&&nr<ROWS&&nc>=0&&nc<COLS){if(board[nr][nc]===1)n1++;else if(board[nr][nc]===2)n2++;}
    }
    const tot=n1+n2,cur=board[r][c];
    if(cur){nb[r][c]=(tot===2||tot===3)?cur:0;}
    else if(tot===3){nb[r][c]=n1>n2?1:n1<n2?2:(((r+c)&1)?1:2);} // deterministic tie-break by cell parity
  }
  board=nb;
}

// ── CPU AI ────────────────────────────────────────────────────────────────
// Core idea: don't guess with neighbor heuristics — actually simulate one
// Conway generation in the 5×5 window around a candidate placement and score
// the NET change in own cells. This single number captures both failure
// modes the old AI suffered from:
//   · suicide  → isolated cell dies next gen        → own delta ≤ -1
//   · kamikaze → placement overcrowds own cluster   → own delta very negative
function placementImpact(r,c,p){
  const e=p===1?2:1;
  board[r][c]=p; // place temporarily
  const r0=Math.max(0,r-2),r1=Math.min(ROWS-1,r+2);
  const c0=Math.max(0,c-2),c1=Math.min(COLS-1,c+2);
  let ownB=0,enB=0,ownA=0,enA=0;
  for(let rr=r0;rr<=r1;rr++) for(let cc=c0;cc<=c1;cc++){
    const cur=board[rr][cc];
    if(cur===p)ownB++; else if(cur===e)enB++;
    let n1=0,n2=0;
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      if(!dr&&!dc) continue;
      const nr=rr+dr,nc=cc+dc;
      if(nr>=0&&nr<ROWS&&nc>=0&&nc<COLS){
        const v=board[nr][nc];
        if(v===1)n1++; else if(v===2)n2++;
      }
    }
    const tot=n1+n2;
    let nxt=0;
    if(cur) nxt=(tot===2||tot===3)?cur:0;
    else if(tot===3) nxt=n1>n2?1:n1<n2?2:(((rr+cc)&1)?1:2);
    if(nxt===p)ownA++; else if(nxt===e)enA++;
  }
  board[r][c]=0; // restore
  return {own:ownA-ownB,enemy:enA-enB};
}

function cpuScore(r,c){
  let score=0;
  const z=zoneOf(c);
  if(z===0)score+=5;          // pushing into neutral is good
  // Invading enemy zone: gated to later rounds so the CPU builds a stable home
  // colony first instead of rushing in and triggering overcrowding wipes.
  if(z===1)score+=(round>=6?4:1);

  // light shape heuristic: mild preference for touching 1-2 own cells
  let ownN=0;
  for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
    if(!dr&&!dc) continue;
    const nr=r+dr,nc=c+dc;
    if(nr>=0&&nr<ROWS&&nc>=0&&nc<COLS&&board[nr][nc]===2)ownN++;
  }
  if(ownN===1||ownN===2)score+=4;
  else if(ownN===0)score-=2;
  else if(ownN>=4)score-=4;

  // adjacency to cells placed THIS turn: half-built shapes must look good so
  // the greedy chain completes blinkers/blocks instead of scattering
  if(cpuTurnPlaced&&cpuTurnPlaced.size){
    let adjTurn=0;
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      if(!dr&&!dc) continue;
      if(cpuTurnPlaced.has((r+dr)+','+(c+dc)))adjTurn++;
    }
    if(adjTurn===1)score+=12;
    else if(adjTurn>=2)score+=16; // completing an L / line
  }

  // the heart: simulated local impact of this placement
  // ALL difficulties use it (so even Easy doesn't suicide); Easy just weighs
  // it less and adds more noise, which makes it sloppy without being brainless.
  const imp=placementImpact(r,c,2);
  const w=cpuDifficulty==='easy'?5:cpuDifficulty==='normal'?9:10;
  score+=imp.own*w;
  if(cpuDifficulty==='hard'){
    score+=Math.max(0,-imp.enemy)*4; // hard also values hurting the enemy
    // late-game killer instinct: when the enemy colony is already small, hard
    // prioritizes moves that shrink it further, pushing toward a real extinction
    // win instead of coasting to a round-12 count victory. Makes high-difficulty
    // games feel more decisive and dangerous to the human.
    if(round>=7){
      const enemyTotal=count(1);
      if(enemyTotal>0&&enemyTotal<=12)score+=Math.max(0,-imp.enemy)*6;
    }
  }

  // difficulty-scaled randomness for variety
  score+=Math.random()*(cpuDifficulty==='easy'?8:cpuDifficulty==='normal'?3:1.2);
  return score;
}

function cpuUseBomb(){
  if(abilityCooldown[1]>0) return false;
  // Only bomb LARGE enemy clusters, never before round 4, and NEVER when the
  // blast would take out a meaningful chunk of the CPU's own colony (the old
  // version only maximized enemy hits and happily kamikazed its own cells).
  if(round<BOMB_UNLOCK) return false;
  let best=-Infinity,br=-1,bc=-1,bestEnemy=0;
  for(let r=1;r<ROWS-1;r++) for(let c=1;c<COLS-1;c++){
    let e=0,own=0;
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      const v=board[r+dr][c+dc];
      if(v===1)e++; else if(v===2)own++;
    }
    const s=e-own*1.5; // own cells weigh more: friendly fire is worse than missing
    if(s>best){best=s;br=r;bc=c;bestEnemy=e;}
  }
  // require a dense enemy cluster AND a clearly positive trade. Hard bombs more
  // readily (smaller clusters, thinner margin) which makes it finish games and
  // play more decisively; normal/easy keep the conservative threshold.
  const eMin=cpuDifficulty==='hard'?5:6, sMin=cpuDifficulty==='hard'?3:4;
  if(bestEnemy>=eMin&&best>=sMin){executeBomb(br,bc,true);return true;}
  return false;
}

// cells the CPU placed THIS turn — lets the scorer see half-built shapes
let cpuTurnPlaced=null;

// Opening/recovery formation: a 2×2 block is stable forever and uses exactly
// the 4 moves of a turn. Greedy per-cell scoring has a "pair valley" (cell #2
// adjacent to cell #1 scores Δ=-2 because the pair dies, WORSE than an
// isolated cell's Δ=-1), so with no standing colony the CPU used to scatter
// four lone cells that all died — the first-move suicide. Stamping skips the
// valley entirely.
function cpuPickBlock(){
  let best=-Infinity,pos=null;
  for(let r=0;r<ROWS-1;r++) for(let c=0;c<COLS-1;c++){
    const cells=[[r,c],[r,c+1],[r+1,c],[r+1,c+1]];
    if(!cells.every(([rr,cc])=>canPlace(rr,cc))) continue;
    let s=0;
    // prefer own home zone, roughly centered vertically, off the walls
    if(zoneOf(c)===2&&zoneOf(c+1)===2)s+=8;
    s-=Math.abs(r-(ROWS/2-1))*0.35;
    if(r===0||r>=ROWS-2||c===0||c>=COLS-2)s-=3;
    // keep clear of enemies that could perturb the block
    let enemyNear=0;
    for(let dr=-2;dr<=3;dr++) for(let dc=-2;dc<=3;dc++){
      const nr=r+dr,nc=c+dc;
      if(nr>=0&&nr<ROWS&&nc>=0&&nc<COLS&&board[nr][nc]===1)enemyNear++;
    }
    s-=enemyNear*2;
    s+=Math.random()*(cpuDifficulty==='easy'?6:cpuDifficulty==='normal'?2.5:1);
    if(s>best){best=s;pos=cells;}
  }
  return pos;
}

function cpuPickCell(){
  const cands=[];
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++)
    if(canPlace(r,c)) cands.push([r,c,cpuScore(r,c)]);
  if(!cands.length) return null;
  cands.sort((a,b)=>b[2]-a[2]);
  // easy: top ~25% (sloppy but never absurd). normal: top ~10%. hard: top 2.
  const pool=cpuDifficulty==='easy'?Math.max(1,Math.floor(cands.length*.25))
    :cpuDifficulty==='normal'?Math.max(1,Math.floor(cands.length*.10))
    :Math.min(2,cands.length);
  return cands[Math.floor(Math.random()*pool)];
}

function cpuTakeTurn(){
  const myGen=gameGen;
  const delay=cpuDifficulty==='easy'?320:cpuDifficulty==='normal'?480:680;
  setTimeout(()=>{
    if(myGen!==gameGen) return; // game was reset — abort stale turn
    // Bomb now ENDS the turn (and unlocks mid-game) — only worth it on a fat
    // enemy cluster, since it replaces all 4 placements.
    if(round>=BOMB_UNLOCK&&Math.random()<(cpuDifficulty==='hard'?.8:.35)){
      if(cpuUseBomb()) return; // executeBomb handles end-of-turn
    }
    cpuTurnPlaced=new Set();
    // no standing colony (first turn or wiped out) → stamp a stable block
    const plan=(count(2)<3)?cpuPickBlock():null;
    let placed=0;
    const next=()=>{
      if(myGen!==gameGen) return; // reset mid-sequence — stop placing
      if(placed>=MPT){cpuTurnPlaced=null;doEvolution();return;}
      const cell=plan?plan[placed]:cpuPickCell();
      if(!cell){cpuTurnPlaced=null;doEvolution();return;}
      board[cell[0]][cell[1]]=2;placed++;moves--;
      cpuTurnPlaced.add(cell[0]+','+cell[1]);
      SND.place(2);
      render();updateHUD();
      setTimeout(next,delay);
    };
    next();
  },delay);
}

// ── Bomb ──────────────────────────────────────────────────────────────────
function executeBomb(r,c,isCPU=false){
  SND.bomb();
  addBombFX(r,c);
  // Using the bomb ENDS the turn: it replaces your 4 placements. Without this
  // cost the bomb was pure advantage stacked on a full turn.
  moves=0;
  let killed=0;
  for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
    const nr=r+dr,nc=c+dc;
    if(nr>=0&&nr<ROWS&&nc>=0&&nc<COLS&&board[nr][nc]){killed++;board[nr][nc]=0;}
  }
  abilityCooldown[player-1]=BOMB_CD;
  abilityMode=false;
  setMsg(names[player]+' bombed — '+killed+' cell'+(killed!==1?'s':'')+' destroyed. Turn ends.','hl');
  render();updateHUD();
  // bomb consumed the turn → evolve and pass to the other player
  doEvolution();
}

// ── Skip ──────────────────────────────────────────────────────────────────
function skipTurn(){
  if(locked||skipUsed[player-1]) return;
  SND.skip();
  if(gameMode==='online'){
    wsSend({type:'skip'});
    return;
  }
  skipUsed[player-1]=true;
  moves=0;
  doEvolution();
}

// ── Guided preview ────────────────────────────────────────────────────────
function computeNextBoard(){
  const nb=Array.from({length:ROWS},()=>new Int8Array(COLS));
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    let n1=0,n2=0;
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      if(!dr&&!dc) continue;
      const nr=r+dr,nc=c+dc;
      if(nr>=0&&nr<ROWS&&nc>=0&&nc<COLS){if(board[nr][nc]===1)n1++;else if(board[nr][nc]===2)n2++;}
    }
    const tot=n1+n2,cur=board[r][c];
    if(cur){nb[r][c]=(tot===2||tot===3)?cur:0;}
    else if(tot===3){nb[r][c]=n1>n2?1:n1<n2?2:(((r+c)&1)?1:2);} // same deterministic tie-break as evolve()
  }
  return nb;
}

function showPreview(){
  SND.preview();
  previewBoard=computeNextBoard();
  previewActive=true;
  locked=true; // block further placement until confirm/cancel
  render();
  document.getElementById('preview-bar').style.display='flex';
  setMsg('Preview: tap CONFIRM to evolve, or CANCEL to reposition','hl');
}

function confirmPreview(){
  if(!previewActive) return;
  SND.confirm();
  const applied=previewBoard;            // the exact board the user saw
  previewActive=false;previewBoard=null;placedThisTurn=[];
  document.getElementById('preview-bar').style.display='none';
  locked=true;
  setMsg('Evolving…','hl');
  SND.evolve();
  const myGen=gameGen;
  setTimeout(()=>{
    if(myGen!==gameGen) return;
    const oldB=board.map(row=>new Int8Array(row));
    board=applied;                       // apply the previewed result directly
    addEvolveFX(oldB,board);
    postEvolution();
  },300);
}

function cancelPreview(){
  if(!previewActive) return;
  SND.cancel();
  // undo cells placed this turn
  placedThisTurn.forEach(([r,c])=>{board[r][c]=0;});
  moves=MPT;
  placedThisTurn=[];
  previewActive=false;previewBoard=null;locked=false;
  document.getElementById('preview-bar').style.display='none';
  render();updateHUD();
  setMsg(names[player]+'\'s turn — place your '+MPT+' cells again');
}

// ── Practice-mode coaching tips ───────────────────────────────────────────
// In practice mode (gameMode 'local') you control both colonies, so it works
// as a sandbox. After each evolution a short tip rotates through the message
// bar, plus contextual callouts when territory access changes.
const TIPS=[
  // fundamentals first — these are what a brand-new player needs to survive
  'a lone cell always dies — every placement needs at least one neighbor',
  'a 2×2 block never moves and never dies — your safest anchor',
  'cells with 4+ neighbors die of overcrowding — don\'t pack too tight',
  'a line of 3 flips forever between ─ and │ — cheap, living board presence',
  'L-shapes of 3 cells become a 2×2 block next generation',
  // territory & tempo
  'birth: an empty square with exactly 3 neighbors — the majority color claims it',
  'invading needs a cell BORN in enemy territory — push births across the line',
  'losing all home-zone cells locks you out of neutral — always keep an anchor home',
  'place your 4 cells as ONE shape, not scattered — scattered cells just die',
  // advanced / strategic
  'think one generation ahead: imagine the board AFTER it evolves, then place',
  'the bomb (round 7+) clears a 3×3 but ends your turn — save it for fat enemy clusters',
  'skip is once per game — use it when every placement would only hurt you',
  'gliders travel diagonally — seed one to sneak cells across zones',
  'a wall of stable blocks near the centre line blocks the enemy\'s expansion',
  'try guided mode in the lobby to preview each evolution before it lands',
];
let tipIdx=0;
function nextTip(){const t=TIPS[tipIdx%TIPS.length];tipIdx++;return t;}
let lastAccess={1:'',2:''};
function practiceCoach(){
  if(gameMode!=='local')return '';
  // contextual callout: territory access just changed for the player to move
  const acc=accessLabel(player);
  if(lastAccess[player]&&lastAccess[player]!==acc){
    lastAccess[player]=acc;
    if(acc==='home + neutral')return '  ·  tip: neutral unlocked — expand to the middle';
    if(acc==='full access')return '  ·  tip: enemy zone open — you can place inside their territory';
    if(acc==='home zone only')return '  ·  tip: you lost neutral access — rebuild at home first';
  }
  lastAccess[player]=acc;
  return '  ·  tip: '+nextTip();
}

// ── Evolution cycle ───────────────────────────────────────────────────────
function doEvolution(){
  locked=true;
  setMsg('Evolving…','hl');
  SND.evolve();
  const myGen=gameGen;
  setTimeout(()=>{
    if(myGen!==gameGen) return; // game reset before evolution fired
    const oldB=board.map(row=>new Int8Array(row));
    evolve();
    addEvolveFX(oldB,board);
    postEvolution();
  },480);
}

// Shared post-evolution flow: win checks, cooldowns, turn switch.
// Used by both doEvolution (normal mode) and confirmPreview (guided mode).
function postEvolution(){
  const p1=count(1),p2=count(2);
  if(player===2) round++;
  const bothPlayed=round>=2||(round===1&&player===2);
  if(bothPlayed){
    if(!p1&&!p2){endGame(0,p1,p2);return;}
    if(!p1){endGame(2,p1,p2);return;}
    if(!p2){endGame(1,p1,p2);return;}
  }
  if(round>MAX_ROUNDS){
    endGame(p1>p2?1:p2>p1?2:0,p1,p2);return;
  }
  const cdWas=[abilityCooldown[0],abilityCooldown[1]];
  abilityCooldown[0]=Math.max(0,abilityCooldown[0]-1);
  abilityCooldown[1]=Math.max(0,abilityCooldown[1]-1);
  // audio cue: a bomb just came off cooldown (sound was defined but never wired)
  if(cdWas[0]===1||cdWas[1]===1) SND.bombReady();
  player=player===1?2:1;
  moves=MPT;
  placedThisTurn=[];
  if(gameMode==='cpu'&&player===2){
    updateHUD();render();
    setMsg('CPU thinking…','hl');
    cpuTakeTurn();
  } else {
    locked=false;updateHUD();render();
    const skip=skipUsed[player-1]?'':'  ·  skip available';
    setMsg(names[player]+'\'s turn — '+accessLabel(player)+skip+practiceCoach());
  }
}

// ── End game ──────────────────────────────────────────────────────────────
function endGame(winner,p1,p2){
  locked=true;render();updateHUD();
  // play win/lose/draw jingle
  if(winner===0) SND.draw();
  else if(gameMode==='cpu') (winner===1?SND.win:SND.lose).call(SND);
  else if(gameMode==='online') (winner===onlinePlayer?SND.win:SND.lose).call(SND);
  else SND.win();
  const title=buildTitle(winner);
  const sub=buildSub(winner,p1,p2);
  const exp=buildExplanation(winner,p1,p2);
  document.getElementById('ov-title').textContent=title;
  document.getElementById('ov-sub').textContent=sub;
  document.getElementById('ov-exp').textContent=exp;
  document.getElementById('ov-title').style.color=winner===1?'var(--c1)':winner===2?'var(--c2)':'var(--gold)';
  document.getElementById('overlay').classList.add('show');
  // Speak the result after the jingle so they don't overlap
  setTimeout(()=>SND.speak(title+'. '+exp),750);
  // report a vs-CPU win to the leaderboard (server can't observe offline games)
  if(gameMode==='cpu' && winner!==0){
    const elapsedSec=gameStartTime?Math.round((Date.now()-gameStartTime)/1000):0;
    const won=(winner===1);
    const payload={
      name:(names[1]||'Player'),
      pid:PlayerID.get(),
      difficulty:cpuDifficulty,
      win:won,
      byExtinction:won&&(p2===0),
      round:round,
      elapsedSec:elapsedSec,
      margin:Math.abs(p1-p2),
    };
    try{
      fetch('/api/cpu-result',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)}).catch(()=>{});
    }catch(e){}
  }
}

function buildTitle(winner){
  if(winner===0) return 'Draw';
  return names[winner]+' wins!';
}
function buildSub(winner,p1,p2){
  if(winner===0&&p1===0&&p2===0) return 'Mutual extinction';
  if(winner===0) return p1+' cells each — round '+MAX_ROUNDS;
  return (winner===1?p1:p2)+' cells vs '+(winner===1?p2:p1);
}
function buildExplanation(winner,p1,p2){
  const wn=names[winner]||'Nobody',ln=names[winner===1?2:1];
  if(winner===0&&p1===0&&p2===0)
    return 'Both colonies collapsed at the same moment. No cell had enough neighbors — loneliness consumed them all. A shared defeat as rare as it is total.';
  if(winner===0)
    return 'Round '+MAX_ROUNDS+' ended with identical forces: '+p1+' cells each. Neither colony could dominate the board. A perfect draw.';
  const wc=winner===1?p1:p2,lc=winner===1?p2:p1;
  if(lc===0)
    return wn+' wiped out '+ln+'. '+(round<=5
      ?'The losing colony never reached neutral ground — trapped in its own zone, it died of isolation.'
      :'The invasion in round '+round+' was decisive. Too many '+wn+' cells surrounded '+ln+'\'s colony and erased it.')+' Total domination.';
  const diff=wc-lc;
  return 'Round '+MAX_ROUNDS+' ended with '+wn+' holding '+wc+' cells vs '+ln+'\'s '+lc+'. A '+diff+'-cell margin built through smarter territorial expansion.';
}

// ── Local reset ───────────────────────────────────────────────────────────
function doReset(){
  gameGen++; // invalidate any pending CPU/evolution timers from the previous game
  FX.clear();
  tipIdx=0;lastAccess={1:'',2:''};
  if(typeof SND!=='undefined') SND.stopSpeech();
  previewActive=false;previewBoard=null;placedThisTurn=[];
  var pbar=document.getElementById('preview-bar');if(pbar)pbar.style.display='none';
  board=Array.from({length:ROWS},()=>new Int8Array(COLS));
  player=1;moves=MPT;round=1;hover=null;locked=false;abilityMode=false;
  abilityCooldown=[0,0];skipUsed=[false,false];
  document.getElementById('overlay').classList.remove('show');
  document.getElementById('ov-btn').textContent='Play again';
  // ensure HUD names reflect current names immediately
  document.getElementById('name1-hud').textContent=names[1];
  document.getElementById('name2-hud').textContent=names[2];
  updateHUD();render();
  setMsg(names[1]+'\'s turn — home zone only  ·  skip available');
}

function useAbility(p){
  if(round<BOMB_UNLOCK){setMsg('Bomb unlocks at round '+BOMB_UNLOCK+' (mid-game)','hl');return;}
  if(player!==p||locked||abilityCooldown[p-1]>0) return;
  if(gameMode==='cpu'&&p===2) return;
  if(gameMode==='online'&&p!==onlinePlayer) return;
  abilityMode=true;
  setMsg('Bomb active — tap a 3×3 target. Using it ends your turn','hl');
  updateHUD();render();
}

// ── Online multiplayer ────────────────────────────────────────────────────
// Transport layer with automatic fallback:
//   1) Try native WebSocket (lowest latency).
//   2) If the socket fails to OPEN within 4s (typical of hosting proxies that
//      drop the Upgrade handshake, e.g. some managed Node platforms), fall
//      back to HTTP long-polling against /api/send + /api/poll.
// Both transports deliver the exact same JSON messages to handleServerMsg().
const net={mode:null,sid:null,joinMsg:null};

function wsSend(msg){ // name kept: called from skipTurn/handleInput/resetGame
  if(net.mode==='poll'){
    fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sid:net.sid,msg})})
      .then(r=>r.json()).then(d=>{if(d&&d.sid)net.sid=d.sid;}).catch(()=>{});
  } else if(ws&&ws.readyState===WebSocket.OPEN){
    ws.send(JSON.stringify(msg));
  }
}

// ── In-game chat (online matches only) ─────────────────────────────────────
let chatOpen=false, chatUnread=0, chatReady=false;
function initChat(freshGame){
  // reveal the floating chat button for the duration of the online match
  const fab=document.getElementById('chat-fab');
  if(fab) fab.style.display='flex';
  if(freshGame){
    // clear log on a brand-new match (not on a rematch of the same room)
    const log=document.getElementById('chat-log');
    if(log) log.innerHTML='<div class="cempty" id="chat-empty">'+
      'Say hi to your opponent. Messages are only visible to the two of you, during this match.</div>';
  }
  chatReady=true;
}
function toggleChat(){
  const panel=document.getElementById('chat-panel');
  const fab=document.getElementById('chat-fab');
  if(!panel) return;
  chatOpen=!chatOpen;
  panel.classList.toggle('open',chatOpen);
  if(fab) fab.style.display=chatOpen?'none':'flex';
  if(chatOpen){
    chatUnread=0; updateChatBadge();
    const t=document.getElementById('chat-text'); if(t) setTimeout(()=>t.focus(),50);
    const log=document.getElementById('chat-log'); if(log) log.scrollTop=log.scrollHeight;
  }
}
function sendChat(){
  const inp=document.getElementById('chat-text');
  if(!inp) return;
  const text=inp.value.trim();
  if(!text) return;
  if(gameMode!=='online'){ inp.value=''; return; }
  wsSend({type:'chat',text:text.slice(0,200)});
  inp.value='';
  inp.focus();
}
function _chatLog(){ return document.getElementById('chat-log'); }
function _chatClearEmpty(){ const e=document.getElementById('chat-empty'); if(e) e.remove(); }
function addChatMessage(playerNum,name,text){
  const log=_chatLog(); if(!log) return;
  _chatClearEmpty();
  const mine=(playerNum===onlinePlayer);
  const div=document.createElement('div');
  div.className='cmsg '+(mine?'me':'them');
  const safeName=String(name||'Player').replace(/[<>&]/g,'');
  const safeText=String(text).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  div.innerHTML='<span class="cn">'+safeName+'</span>'+safeText;
  log.appendChild(div);
  log.scrollTop=log.scrollHeight;
  if(!chatOpen && !mine){ chatUnread++; updateChatBadge(); SND.place&&SND.place(playerNum); }
}
function addChatSystem(text){
  const log=_chatLog(); if(!log) return;
  _chatClearEmpty();
  const div=document.createElement('div');
  div.className='cmsg sys';
  div.textContent=text;
  log.appendChild(div);
  log.scrollTop=log.scrollHeight;
}
function updateChatBadge(){
  const b=document.getElementById('chat-badge');
  if(!b) return;
  if(chatUnread>0){ b.textContent=chatUnread>9?'9+':String(chatUnread); b.style.display='flex'; }
  else b.style.display='none';
}
function hideChat(){
  const fab=document.getElementById('chat-fab'), panel=document.getElementById('chat-panel');
  if(fab) fab.style.display='none';
  if(panel){ panel.classList.remove('open'); }
  chatOpen=false; chatUnread=0; chatReady=false; updateChatBadge();
}
window.toggleChat=toggleChat;
window.sendChat=sendChat;

function handleServerMsg(msg){
  switch(msg.type){
      case 'waiting':{
        roomId=msg.room;
        // shareable link built from the REAL origin the page was loaded from
        // (the domain in production, never localhost)
        const base=location.origin+location.pathname.replace(/[^/]*$/,'');
        const shareUrl=base+'?room='+msg.room;
        const st=document.getElementById('online-status');
        const rd=document.getElementById('online-room-display');
        const hint=document.getElementById('online-hint');
        if(rd)rd.textContent=msg.room;
        if(st)st.textContent='Waiting for your opponent…';
        if(hint)hint.innerHTML='Or share this link — it joins directly:<br><span style="color:var(--gold);word-break:break-all;user-select:all">'+shareUrl+'</span>';
        try{navigator.clipboard.writeText(shareUrl).then(()=>{
          if(st)st.textContent='Waiting for your opponent… (link copied to clipboard)';
        }).catch(()=>{});}catch(e){}
        setMsg('Room '+msg.room+' created — waiting for opponent','hl');
        break;
      }
      case 'start':
      case 'restart':{
        names=msg.names||names;
        document.getElementById('online-waiting').style.display='none';
        document.getElementById('lobby').style.display='none';
        document.getElementById('game-ui').style.display='flex';
        const lb=document.querySelector('.launch-btn');
        if(lb){lb.disabled=false;lb.textContent='Start Game';lb.style.opacity='';}
        // chat is available for the whole online match
        if(gameMode==='online') initChat(msg.type==='start');
        break;
      }
      case 'state':
        board=msg.board.map(row=>new Int8Array(row));
        player=msg.player; moves=msg.moves; round=msg.round;
        abilityCooldown=msg.abilityCooldown; skipUsed=msg.skipUsed;
        if(msg.names) names=msg.names;
        locked=(player!==onlinePlayer);
        updateHUD();render();
        if(!locked){
          const skip=skipUsed[player-1]?'':'  ·  skip available';
          setMsg('Your turn — '+accessLabel(player)+skip);
        } else {
          setMsg('Waiting for '+names[player]+'…','hl');
        }
        break;
      case 'move_ok':
        board[msg.r][msg.c]=msg.player;
        moves=msg.moves;
        render();updateHUD();
        break;
      case 'bomb_ok':
        SND.bomb();
        addBombFX(msg.r,msg.c);
        for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
          const nr=msg.r+dr,nc=msg.c+dc;
          if(nr>=0&&nr<ROWS&&nc>=0&&nc<COLS) board[nr][nc]=0;
        }
        abilityCooldown[msg.player-1]=BOMB_CD;
        setMsg(names[msg.player]+' bombed — '+msg.killed+' cells destroyed','hl');
        render();updateHUD();
        break;
      case 'skip_ok':
        skipUsed[msg.player-1]=true;
        setMsg(names[msg.player]+' skipped their turn','hl');
        updateHUD();
        break;
      case 'evolve':{
        const oldB=board;
        board=msg.board.map(row=>new Int8Array(row));
        round=msg.round;
        addEvolveFX(oldB,board);
        render();
        break;
      }
      case 'gameover':
        if(msg.board){
          const oldB=board;
          board=msg.board.map(row=>new Int8Array(row));
          addEvolveFX(oldB,board);
        }
        locked=true;
        endGame(msg.winner,msg.p1,msg.p2);
        // show restart button only in online mode
        document.getElementById('ov-btn').textContent='Request rematch';
        break;
      case 'opponent_left':
        locked=true;
        setMsg('Opponent disconnected.','hl');
        document.getElementById('overlay').classList.add('show');
        document.getElementById('ov-title').textContent='Opponent left';
        document.getElementById('ov-sub').textContent='';
        document.getElementById('ov-exp').textContent='Your opponent disconnected from the game.';
        document.getElementById('ov-title').style.color='var(--gold)';
        addChatSystem('Your opponent disconnected.');
        break;
      case 'chat':
        addChatMessage(msg.player,msg.name,msg.text);
        break;
      case 'chat_throttled':
        addChatSystem('Slow down — too many messages.');
        break;
      case 'error':
        setMsg('Error: '+msg.msg,'hl');
        if(msg.fatal){
          // unrecoverable join errors (room not found / full / rate-limited):
          // surface them properly instead of leaving a frozen board
          fatalNetError=true;
          document.getElementById('ov-title').textContent='Could not join';
          document.getElementById('ov-title').style.color='var(--c2)';
          document.getElementById('ov-sub').textContent='';
          document.getElementById('ov-exp').textContent=msg.msg;
          document.getElementById('ov-btn').textContent='Back to lobby';
          document.getElementById('overlay').classList.add('show');
          document.getElementById('lobby').style.display='none';
          document.getElementById('game-ui').style.display='flex';
        }
        break;
    }
}

function connectOnline(playerName,joinRoom,isPublic){
  net.joinMsg={type:'join',name:playerName,pid:PlayerID.get(),room:joinRoom||undefined,
    public:isPublic===true?true:undefined};
  // manual override for debugging: ?net=poll skips WebSocket entirely
  try{
    if(new URLSearchParams(location.search).get('net')==='poll'){startPolling();return;}
  }catch(e){}
  net.mode='ws';
  let opened=false,fell=false,gotFirstMsg=false;
  const fallback=()=>{
    if(fell||gotFirstMsg)return;
    fell=true;
    try{if(ws){ws.onclose=null;ws.close();}}catch(e){}
    startPolling();
  };
  try{
    const proto=location.protocol==='https:'?'wss:':'ws:';
    ws=new WebSocket(proto+'//'+location.host);
  }catch(e){fallback();return;}
  const openTimer=setTimeout(fallback,4000);
  ws.onopen=()=>{
    opened=true;clearTimeout(openTimer);
    wsSend(net.joinMsg);
    // HALF-OPEN PROXY GUARD: some hosting proxies accept the WS handshake but
    // never pipe frames to the app. A join always gets an immediate reply
    // (waiting/start/error), so if nothing arrives shortly → switch to polling.
    setTimeout(fallback,3500);
  };
  ws.onerror=()=>{if(!opened){clearTimeout(openTimer);fallback();}};
  ws.onmessage=e=>{
    gotFirstMsg=true;
    try{handleServerMsg(JSON.parse(e.data));}
    catch(err){console.error('msg handler:',err);}
  };
  ws.onclose=()=>{
    if(!gotFirstMsg){clearTimeout(openTimer);fallback();}
    else if(gameMode==='online'&&net.mode!=='poll') setMsg('Disconnected from server','hl');
  };
}

function startPolling(){
  net.mode='poll';
  fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({msg:net.joinMsg})})
    .then(r=>r.json())
    .then(d=>{net.sid=d.sid;pollLoop();})
    .catch(()=>setMsg('Could not reach the server','hl'));
}

function pollLoop(){
  if(net.mode!=='poll'||gameMode!=='online')return;
  fetch('/api/poll?sid='+encodeURIComponent(net.sid))
    .then(r=>{
      if(r.status===410){setMsg('Disconnected from server','hl');net.mode=null;return null;}
      return r.json();
    })
    .then(d=>{
      if(!d)return;
      (d.msgs||[]).forEach(m=>{
        try{handleServerMsg(m);}catch(err){console.error('msg handler:',err);}
      });
      pollLoop();
    })
    .catch(()=>{setTimeout(()=>{if(net.mode==='poll')pollLoop();},1500);});
}

// ── Board input ───────────────────────────────────────────────────────────
// Unified Pointer Events (mouse + touch + pen). The old touchend handler read
// ev.touches[0], which is EMPTY on touchend (finger already lifted) — taps
// crashed silently and fell through to the browser's synthesized click, or
// were eaten by double-tap zoom (iOS ignores user-scalable=no since iOS 10).
canvas.style.touchAction='manipulation'; // kills double-tap zoom & 300ms delay

canvas.addEventListener('pointermove',e=>{
  if(e.pointerType!=='mouse') return; // hover ring only makes sense for mouse
  if(locked) return;
  if(gameMode==='online'&&player!==onlinePlayer) return;
  hover=getCell(e);render();
});
canvas.addEventListener('pointerleave',()=>{hover=null;render();});

// tap detection: commit on pointerup only if the finger didn't drag (so page
// scrolling that starts on the canvas never places a cell by accident)
let _pDown=null;
canvas.addEventListener('pointerdown',e=>{
  _pDown={x:e.clientX,y:e.clientY,t:performance.now(),id:e.pointerId};
});
canvas.addEventListener('pointerup',e=>{
  const d=_pDown;_pDown=null;
  if(!d||e.pointerId!==d.id) return;
  const dx=e.clientX-d.x,dy=e.clientY-d.y;
  if(dx*dx+dy*dy>144) return;              // moved >12px → drag/scroll, not a tap
  if(performance.now()-d.t>700) return;    // long press → not a tap
  handleInput(e);
});
canvas.addEventListener('pointercancel',()=>{_pDown=null;});

// legacy fallback ONLY where Pointer Events don't exist (old Android WebViews):
// click for mouse, touchend reading changedTouches (ev.touches is empty there)
if(!window.PointerEvent){
  canvas.addEventListener('click',handleInput);
  canvas.addEventListener('touchend',e=>{
    if(e.cancelable)e.preventDefault(); // suppress the synthesized click
    handleInput(e);
  },{passive:false});
}

function handleInput(e){
  SND.resume();
  if(locked) return;
  if(gameMode==='cpu'&&player===2) return;
  if(gameMode==='online'&&player!==onlinePlayer) return;
  if(e.cancelable) e.preventDefault();
  const cell=getCell(e);if(!cell) return;
  const[r,c]=cell;

  if(abilityMode){
    if(gameMode==='online'){
      wsSend({type:'bomb',r,c});
      abilityMode=false;
    } else {
      executeBomb(r,c);
    }
    return;
  }

  if(!canPlace(r,c)){
    SND.invalid();
    const z=reachableZones(player),en=player===1?2:1;
    if(!z.has(0))          setMsg('Need cells in home zone first','hl');
    else if(!z.has(en))    setMsg('Need cells in neutral AND in enemy zone to invade','hl');
    else                   setMsg('Cell is occupied');
    return;
  }

  if(gameMode==='online'){
    wsSend({type:'move',r,c});
  } else {
    board[r][c]=player;moves--;
    placedThisTurn.push([r,c]);
    SND.place(player);
    render();updateHUD();
    if(moves===0){
      if(guidedMode) showPreview();
      else doEvolution();
    } else {
      setMsg(names[player]+': '+moves+' move'+(moves!==1?'s':'')+' left');
    }
  }
}


// ── Tutorial ──────────────────────────────────────────────────────────────
const TUTORIAL_SLIDES=[
  {
    title:'Welcome to Conway\'s Conquerors',
    text:'A strategic 1v1 game based on Conway\'s Game of Life.\nPlace cells. Watch them evolve. Conquer the board.',
    draw(c,w,h){
      // Draw a glider pattern as example
      const cs=14,ox=w/2-3*cs,oy=h/2-3*cs;
      const cells=[[1,0],[2,1],[0,2],[1,2],[2,2]];
      c.fillStyle='rgba(61,142,240,0.9)';
      cells.forEach(([cr,cc])=>{
        roundRect(c,ox+cc*cs,oy+cr*cs,cs-2,cs-2,3);c.fill();
      });
      // label
      c.fillStyle='rgba(61,142,240,0.4)';
      c.font='10px Space Mono,monospace';
      c.textAlign='center';
      c.fillText('Conway glider →',w/2,oy+6*cs);
    }
  },
  {
    title:'Territory Zones',
    text:'The board has 3 zones.\nYou start in your home zone.\nExpand to unlock neutral, then enemy territory.',
    draw(c,w,h){
      const bw=w*.85,bh=h*.55,bx=(w-bw)/2,by=(h-bh)/2+10;
      const zw=ZONE_W/COLS*bw;
      // draw zones
      c.fillStyle='rgba(9,21,35,0.9)';roundRect(c,bx,by,zw,bh,4);c.fill();
      c.strokeStyle='rgba(61,142,240,0.5)';c.lineWidth=1.5;roundRect(c,bx,by,zw,bh,4);c.stroke();
      c.fillStyle='rgba(13,15,24,0.9)';c.fillRect(bx+zw,by,bw-2*zw,bh);
      c.strokeStyle='rgba(255,255,255,0.1)';c.strokeRect(bx+zw,by,bw-2*zw,bh);
      c.fillStyle='rgba(26,8,8,0.9)';roundRect(c,bx+bw-zw,by,zw,bh,4);c.fill();
      c.strokeStyle='rgba(232,82,82,0.5)';c.lineWidth=1.5;roundRect(c,bx+bw-zw,by,zw,bh,4);c.stroke();
      // labels
      c.font='bold 11px Syne,sans-serif';c.textAlign='center';
      c.fillStyle='#3d8ef0';c.fillText('BLUE',bx+zw/2,by+bh/2+4);
      c.fillStyle='#6a7090';c.fillText('NEUTRAL',bx+bw/2,by+bh/2+4);
      c.fillStyle='#e85252';c.fillText('RED',bx+bw-zw/2,by+bh/2+4);
      // arrows
      c.fillStyle='rgba(200,160,32,0.8)';c.font='18px sans-serif';c.textAlign='center';
      c.fillText('→',bx+zw+18,by+bh/2+6);
      c.fillText('→',bx+bw-zw-18,by+bh/2+6);
    }
  },
  {
    title:'Conway\'s Rules',
    text:'After each turn, every cell lives or dies:\n• < 2 neighbors → dies (loneliness)\n• 2–3 neighbors → survives\n• > 3 neighbors → dies (overcrowding)\n• Empty + exactly 3 neighbors → born!',
    draw(c,w,h){
      const examples=[
        {cells:[[0,0],[1,0],[2,0]],label:'Line → oscillates',col:'#3d8ef0',ox:w*.1,oy:h*.2},
        {cells:[[0,0],[0,1],[1,0],[1,1]],label:'2×2 → stable!',col:'#a0f060',ox:w*.5,oy:h*.2},
      ];
      const cs=14;
      examples.forEach(ex=>{
        c.fillStyle=ex.col;
        ex.cells.forEach(([cr,cc])=>{roundRect(c,ex.ox+cc*cs,ex.oy+cr*cs,cs-2,cs-2,3);c.fill();});
        c.fillStyle='rgba(255,255,255,0.5)';c.font='10px Space Mono,monospace';c.textAlign='left';
        c.fillText(ex.label,ex.ox,ex.oy+ex.cells.length*cs+16);
      });
    }
  },
  {
    title:'Invasion Rules',
    text:'You can only place in enemy territory\nif you already have a live cell there\n(born by Conway evolution, not placed).\n\nCross the board step by step!',
    draw(c,w,h){
      const steps=[
        {x:.12,label:'① Build\nhome'},
        {x:.38,label:'② Cross to\nneutral'},
        {x:.62,label:'③ Born in\nenemy zone'},
        {x:.88,label:'④ Invade\nenemy!'},
      ];
      const oy=h*.35,cs=10;
      c.strokeStyle='rgba(200,160,32,0.4)';c.lineWidth=1.5;c.setLineDash([4,4]);
      c.beginPath();c.moveTo(w*.12,oy);c.lineTo(w*.88,oy);c.stroke();
      c.setLineDash([]);
      steps.forEach((s,i)=>{
        const x=w*s.x;
        c.fillStyle=i===3?'#e85252':i===2?'#c8a020':i===1?'#6a7090':'#3d8ef0';
        c.beginPath();c.arc(x,oy,8,0,Math.PI*2);c.fill();
        c.fillStyle='rgba(255,255,255,0.7)';c.font='9px Space Mono,monospace';c.textAlign='center';
        const lines=s.label.split('\n');
        lines.forEach((l,li)=>c.fillText(l,x,oy+22+li*13));
      });
    }
  },
  {
    title:'Special Abilities',
    text:'Each player has:\n\n💣 Bomb: destroys 3×3 area.\n   Doesn\'t cost a move. 3-round cooldown.\n\n⏭ Skip: pass your turn without placing.\n   Each player can use this ONCE per game.',
    draw(c,w,h){
      // draw bomb blast radius
      const cx=w/2,cy=h*.45,cs=16;
      for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
        const x=cx+(dc-.5)*cs,y=cy+(dr-.5)*cs;
        c.fillStyle=dr===0&&dc===0?'rgba(200,160,32,0.9)':'rgba(200,160,32,0.3)';
        roundRect(c,x,y,cs-2,cs-2,3);c.fill();
      }
      c.font='18px sans-serif';c.textAlign='center';c.fillText('💣',cx,cy+5);
      c.fillStyle='rgba(200,160,32,0.6)';c.font='10px Space Mono,monospace';
      c.fillText('3×3 blast radius',cx,cy+cs*2);
    }
  },
];

function roundRect(c,x,y,w,h,r){
  c.beginPath();c.roundRect(x,y,w,h,[r]);
}

let tutSlide=0,tutAnim=null,tutDone=false;

function showTutorial(){
  const el=document.getElementById('tutorial');
  el.style.display='flex';
  tutSlide=0;renderTutSlide();
}

function renderTutSlide(){
  const slide=TUTORIAL_SLIDES[tutSlide];
  const tc=document.getElementById('tut-canvas');
  const tctx=tc.getContext('2d');
  const w=tc.width,h=tc.height;

  // fade out
  let alpha=1;
  if(tutAnim) clearInterval(tutAnim);
  tutAnim=setInterval(()=>{
    alpha-=0.12;
    if(alpha<=0){
      clearInterval(tutAnim);
      drawTutSlide(tctx,slide,w,h);
      // update text with fade in
      document.getElementById('tut-title').textContent=slide.title;
      document.getElementById('tut-text').textContent=slide.text;
      document.getElementById('tut-counter').textContent=(tutSlide+1)+'/'+TUTORIAL_SLIDES.length;
      document.getElementById('tut-prev').disabled=tutSlide===0;
      document.getElementById('tut-next').textContent=tutSlide===TUTORIAL_SLIDES.length-1?'Play!':'Next →';
    } else {
      tctx.globalAlpha=alpha;
      tctx.fillStyle='#090b12';tctx.fillRect(0,0,w,h);
    }
  },30);
}

function drawTutSlide(c,slide,w,h){
  c.globalAlpha=1;
  c.clearRect(0,0,w,h);
  c.fillStyle='#090b12';c.fillRect(0,0,w,h);
  // subtle grid bg
  c.strokeStyle='rgba(255,255,255,0.04)';c.lineWidth=0.5;
  for(let x=0;x<w;x+=20){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}
  for(let y=0;y<h;y+=20){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}
  slide.draw(c,w,h);
}

function tutNext(){
  if(tutSlide<TUTORIAL_SLIDES.length-1){tutSlide++;renderTutSlide();}
  else closeTutorial();
}
function tutPrev(){if(tutSlide>0){tutSlide--;renderTutSlide();}}
function closeTutorial(){
  document.getElementById('tutorial').style.display='none';
  tutDone=true;
}

// ── Lobby / name input ────────────────────────────────────────────────────
function startLobby(){
  document.getElementById('lobby').style.display='flex';
  if(typeof hideChat==='function') hideChat();
  document.getElementById('game-ui').style.display='none';
  // restore previously used name
  const saved=PlayerID.getName();
  if(saved){ const inp=document.getElementById('p1name'); if(inp&&!inp.value) inp.value=saved; }
  // Static hosting build (no Node server → no WebSocket): hide online modes
  // instead of letting players hit a dead connection.
  if(window.CC_STATIC){
    const sel=document.getElementById('mode-select');
    const onlineModes=['host','host-public','browse','join'];
    [...sel.options].forEach(o=>{if(onlineModes.includes(o.value))o.remove();});
  }
  // detect if we're in a shared session (URL has ?room=xxx)
  const params=new URLSearchParams(location.search);
  const joinRoom=params.get('room');
  if(joinRoom){
    document.getElementById('lobby-title').textContent='Join Game';
    document.getElementById('join-room-row').style.display='none';
    document.getElementById('room-code-input').value=joinRoom;
    document.getElementById('mode-select').value='join';
    updateLobbyUI();
  }
}

let _nameCheckTimer=null;
function checkName(){
  const inp=document.getElementById('p1name');
  const st=document.getElementById('name-status');
  const name=(inp.value||'').trim();
  PlayerID.setName(name);
  if(!name){ st.textContent=''; return; }
  clearTimeout(_nameCheckTimer);
  _nameCheckTimer=setTimeout(()=>{
    fetch('/api/claim-name',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({pid:PlayerID.get(),name})})
      .then(r=>r.json()).then(d=>{
        if(d.ok&&d.owned){ st.style.color='var(--te)'; st.textContent='✓ this name is yours'; }
        else if(d.ok){ st.style.color='var(--mu)'; st.textContent='✓ name available'; }
        else if(d.reason==='taken'){ st.style.color='var(--c2)'; st.textContent='✗ name taken by another player — pick another'; }
        else { st.textContent=''; }
      }).catch(()=>{ st.textContent=''; });
  },450);
}

function showPlayerCode(){
  const code=PlayerID.get();
  const msg='YOUR PLAYER CODE:\n\n'+code+'\n\n'+
    'This code is your identity on the leaderboard. It is stored only in this '+
    'browser. Save it somewhere safe to keep your score if you clear your '+
    'browser or switch device.\n\n'+
    'To RESTORE a code from another device, paste it when prompted (or cancel to keep this one).';
  const entered=prompt(msg, code);
  if(entered && entered.trim() && entered.trim()!==code){
    if(PlayerID.set(entered.trim())){
      const st=document.getElementById('name-status');
      if(st){ st.style.color='var(--te)'; st.textContent='✓ player code restored'; }
      checkName();
    } else {
      alert('That does not look like a valid player code.');
    }
  }
}

function updateLobbyUI(){
  const mode=document.getElementById('mode-select').value;
  document.getElementById('p2name-row').style.display=mode==='local'?'flex':'none';
  document.getElementById('join-room-row').style.display=mode==='join'?'flex':'none';
  document.getElementById('diff-row2').style.display=mode==='cpu'?'flex':'none';
  const browseRow=document.getElementById('browse-row');
  if(browseRow) browseRow.style.display=mode==='browse'?'flex':'none';
  // guided mode only for local/cpu (online evolution is server-controlled)
  const gr=document.getElementById('guided-row');
  if(gr) gr.style.display=(mode==='local'||mode==='cpu')?'block':'none';
  // the Start button is meaningless in browse mode (you pick a room to join)
  const lb=document.querySelector('.launch-btn');
  if(lb) lb.style.display=mode==='browse'?'none':'block';
  if(mode==='browse') startLobbyPolling(); else stopLobbyPolling();
}

// ── Public lobby browser ──────────────────────────────────────────────────
let _lobbyTimer=null;
function startLobbyPolling(){
  refreshLobby();
  clearInterval(_lobbyTimer);
  _lobbyTimer=setInterval(refreshLobby,4000); // gentle, server throttles at 2s
}
function stopLobbyPolling(){ clearInterval(_lobbyTimer); _lobbyTimer=null; }
function refreshLobby(){
  fetch('/api/lobby').then(r=>{
    if(r.status===429) return null; // throttled, keep current list
    return r.json();
  }).then(d=>{
    if(!d) return;
    const list=document.getElementById('lobby-list');
    const empty=document.getElementById('lobby-empty');
    const count=document.getElementById('browse-count');
    if(count) count.textContent=d.rooms.length?('('+d.rooms.length+')'):'';
    if(!d.rooms.length){
      list.innerHTML='';
      empty.style.display='block';
      empty.textContent='No open public games right now. Host one!';
      return;
    }
    empty.style.display='none';
    list.innerHTML=d.rooms.map(r=>{
      const host=String(r.host).replace(/[<>&]/g,'');
      const wait=r.waiting<60?(r.waiting+'s'):(Math.floor(r.waiting/60)+'m');
      return '<div class="lobby-room">'+
        '<span class="lr-flag">'+(r.flag||'🌐')+'</span>'+
        '<div class="lr-info"><div class="lr-host">'+host+'</div>'+
        '<div class="lr-meta">waiting '+wait+'</div></div>'+
        '<button class="lr-join" onclick="joinPublicRoom(\''+r.id+'\')">JOIN</button></div>';
    }).join('');
  }).catch(()=>{});
}
function joinPublicRoom(roomId){
  stopLobbyPolling();
  SND.init();SND.resume();
  const p1name=(document.getElementById('p1name').value.trim()||'Blue').slice(0,16);
  names={1:p1name,2:'Red'};
  gameMode='online';
  onlinePlayer=2;
  document.getElementById('lobby').style.display='none';
  document.getElementById('game-ui').style.display='flex';
  locked=true;
  setMsg('Joining game…','hl');
  connectOnline(p1name,roomId);
}
window.joinPublicRoom=joinPublicRoom;

function launchGame(){
  SND.init();SND.resume();
  const mode=document.getElementById('mode-select').value;
  const p1name=(document.getElementById('p1name').value.trim()||'Blue').slice(0,16);
  const p2name=(document.getElementById('p2name').value.trim()||'Red').slice(0,16);
  names={1:p1name,2:p2name};
  const gchk=document.getElementById('guided-check');
  guidedMode=(gchk?gchk.checked:false) && (mode==='local'||mode==='cpu');

  if(mode==='local'){
    gameMode='local';
    document.getElementById('lobby').style.display='none';
    document.getElementById('game-ui').style.display='flex';
    document.getElementById('name1-hud').textContent=names[1];
    document.getElementById('name2-hud').textContent=names[2];
    doReset();
  } else if(mode==='cpu'){
    gameMode='cpu';
    names[2]='CPU';
    cpuDifficulty=document.getElementById('diff-select').value;
    gameStartTime=Date.now(); // for leaderboard time-to-victory scoring
    document.getElementById('lobby').style.display='none';
    document.getElementById('game-ui').style.display='flex';
    document.getElementById('name1-hud').textContent=names[1];
    document.getElementById('name2-hud').textContent=names[2];
    doReset();
  } else if(mode==='host'||mode==='host-public'){
    const isPublic=(mode==='host-public');
    gameMode='online';
    onlinePlayer=1;
    // KEEP the lobby visible: the room-code panel lives inside it. The game
    // screen appears when the opponent joins ('start' message hides the lobby).
    locked=true;
    const lb=document.querySelector('.launch-btn');
    if(lb){lb.disabled=true;lb.textContent='Connecting…';lb.style.opacity='.5';}
    document.getElementById('online-waiting').style.display='block';
    document.getElementById('online-status').textContent='Connecting to server…';
    // public rooms tell the host they're listed; private show a shareable code
    const wsLabel=document.querySelector('#online-waiting .ws-label');
    if(wsLabel) wsLabel.textContent=isPublic
      ? 'Your game is now listed in the public lobby. Waiting for a challenger…'
      : 'Share this room code with your opponent:';
    if(isPublic){ const rd=document.getElementById('online-room-display'); if(rd) rd.style.display='none'; }
    connectOnline(p1name,null,isPublic);
  } else if(mode==='browse'){
    // handled by the Join buttons in the list; nothing to do here
    return;
  } else if(mode==='join'){
    gameMode='online';
    onlinePlayer=2;
    const room=(document.getElementById('room-code-input').value.trim()||'').toLowerCase();
    if(!room){alert('Enter a room code');return;}
    document.getElementById('lobby').style.display='none';
    document.getElementById('game-ui').style.display='flex';
    locked=true;
    setMsg('Joining room '+room+'…','hl');
    connectOnline(p1name,room);
  }
}

// ── Expose globals ────────────────────────────────────────────────────────
window.resetGame=function(){
  if(fatalNetError){location.reload();return;}
  if(gameMode==='online'){wsSend({type:'restart'});}
  else{names=names||{1:'Blue',2:'Red'};doReset();}
};
window.skipTurn=skipTurn;
window.useAbility=useAbility;
window.confirmPreview=confirmPreview;
window.cancelPreview=cancelPreview;
window.toggleMute=function(){
  SND.init();
  SND.setMuted(!SND.muted);
  if(SND.muted) SND.stopSpeech();
  const btn=document.getElementById('mute-btn');
  if(btn){btn.textContent=SND.muted?'🔇':'🔊';btn.classList.toggle('muted',SND.muted);}
  if(!SND.muted) SND.click();
};
// initialize mute button state from stored pref on load
window.initMute=function(){
  SND.init();
  const btn=document.getElementById('mute-btn');
  if(btn){btn.textContent=SND.muted?'🔇':'🔊';btn.classList.toggle('muted',SND.muted);}
};
window.tutNext=tutNext;
window.tutPrev=tutPrev;
window.closeTutorial=closeTutorial;
window.updateLobbyUI=updateLobbyUI;
window.launchGame=launchGame;
window.skipTurnFor=(p)=>{if(window.player!==p)return;skipTurn();};

// ── Init ──────────────────────────────────────────────────────────────────
// expose player state for lobby
Object.defineProperty(window,'player',{get:()=>player});

// Boot: initialize ALL state to safe defaults BEFORE anything renders
board=Array.from({length:ROWS},()=>new Int8Array(COLS));
player=1;moves=MPT;round=1;hover=null;locked=false;abilityMode=false;
abilityCooldown=[0,0];skipUsed=[false,false];
previewActive=false;previewBoard=null;placedThisTurn=[];
// then show tutorial + lobby
showTutorial();
startLobby();
render(); // render empty board in background
try{initMute();}catch(e){}
