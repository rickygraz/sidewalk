/* SIDEWALK - walk through the airport, take the best path, do not hit anyone.
   Plain HTML5 canvas, no dependencies, no build step. */
(() => {
'use strict';

const W = 480, VH = 720;            // logical view size
const WALL = 22;                    // wall thickness
const SPEED = 150, HUSTLE = 235;    // px per second
const PR = 11;                      // player radius
const WALKWAY_DRIFT = 120;
const PX_PER_M = 40;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const panel = document.getElementById('panel');
const hustleBtn = document.getElementById('hustle');
const btnPause = document.getElementById('btnPause');
const btnMute = document.getElementById('btnMute');

/* ---------- helpers ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
function mkRng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
function fmtTime(s) { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }

/* ---------- levels ---------- */
const LEVELS = [
  { name: 'Curb to Check-In', sub: 'Warm-up. Everyone is just standing there.', H: 1400, slack: 3.0, optFactor: 1.0,
    walkers: 6, phones: 3, kids: 0, groups: 1, luggage: 1, carts: 0, spills: 0, perfume: 0, walkway: false,
    pillars: 4, kiosks: 2, seats: 0, ropes: false, announce: [
      [1, 'Attention: Your flight is boarding. You are not at the gate.'],
      [9, 'Please do not leave bags unattended. Or yourself, apparently.']] },
  { name: 'Security Theater', sub: 'Serpentine ropes. Nobody is in the line. Zigzag anyway.', H: 1500, slack: 2.6, optFactor: 1.35,
    walkers: 5, phones: 2, kids: 1, groups: 2, luggage: 1, carts: 0, spills: 2, perfume: 0, walkway: false,
    pillars: 2, kiosks: 0, seats: 0, ropes: true, announce: [
      [1, 'Laptops out. Belts off. Dignity in the bin.'],
      [12, 'Random secondary screening is totally random, sir.']] },
  { name: 'The Long Concourse', sub: 'Gate B47. Obviously the farthest one. Use the walkway.', H: 2300, slack: 2.3, optFactor: 0.9,
    walkers: 8, phones: 4, kids: 2, groups: 2, luggage: 3, carts: 2, spills: 2, perfume: 0, walkway: true,
    pillars: 6, kiosks: 4, seats: 3, ropes: false, announce: [
      [1, 'Passengers on the moving walkway: please stand right, walk left. Nobody does.'],
      [14, 'Beep beep. Cart coming through. It will not stop.']] },
  { name: 'Duty-Free Maze', sub: 'You will be perfumed. Whether you consent or not.', H: 2000, slack: 2.4, optFactor: 1.15,
    walkers: 7, phones: 4, kids: 3, groups: 3, luggage: 2, carts: 1, spills: 1, perfume: 5, walkway: false,
    pillars: 4, kiosks: 9, seats: 0, ropes: false, announce: [
      [1, 'Spend $200 on a giant Toblerone. It is a good deal. (It is not.)'],
      [15, 'Would you like to try our new fragrance? Too late.']] },
  { name: 'Gate Change', sub: 'They moved it. Of course they moved it.', H: 2600, slack: 2.2, optFactor: 1.0,
    walkers: 9, phones: 5, kids: 3, groups: 3, luggage: 3, carts: 2, spills: 3, perfume: 2, walkway: true,
    pillars: 6, kiosks: 6, seats: 3, ropes: false, gateChange: 14, bonusTime: 14, announce: [
      [1, 'Your flight is on time. Probably.'],
      [14, 'GATE CHANGE. Your gate is now somewhere you are not. Good luck.']] },
  { name: 'Last Call', sub: 'Everything, everywhere, all at once. Final boarding.', H: 3000, slack: 1.9, optFactor: 1.05,
    walkers: 11, phones: 6, kids: 4, groups: 4, luggage: 4, carts: 3, spills: 3, perfume: 3, walkway: true,
    pillars: 8, kiosks: 7, seats: 4, ropes: false, announce: [
      [1, 'Final boarding call for passenger YOU. Please proceed to the gate. Immediately.'],
      [20, 'Doors close in one minute. We mean it this time.'],
      [40, 'Captain says he can see you on camera and is not impressed.']] },
];

const GATE_NAMES = ['A3', 'B12', 'C27', 'D9', 'E41', 'B47', 'F2', 'G31'];

/* ---------- save data ---------- */
const SAVE_KEY = 'gatedash.v1';
let save = { best: {}, muted: false };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) {}
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} };
const debugUnlock = /[?&]unlock/.test(location.search);
const isUnlocked = (i) => debugUnlock || i === 0 || !!save.best[i - 1];

/* ---------- audio (tiny synth, no assets) ---------- */
let actx = null;
function ensureAudio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state === 'suspended') actx.resume(); }
function beep(f, d = 0.1, type = 'square', vol = 0.05, slide = 0) {
  if (save.muted || !actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d + 0.02);
}
const sfx = {
  bump: () => beep(140, 0.18, 'sawtooth', 0.08, -80),
  close: () => beep(880, 0.07, 'triangle', 0.04),
  chime: () => { beep(660, 0.25, 'sine', 0.06); setTimeout(() => beep(523, 0.35, 'sine', 0.06), 220); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'triangle', 0.07), i * 110)),
  fail: () => [392, 330, 262, 196].forEach((f, i) => setTimeout(() => beep(f, 0.25, 'sawtooth', 0.06), i * 160)),
  tick: () => beep(1200, 0.04, 'square', 0.03),
};

/* ---------- input ---------- */
const keys = new Set();
let hustleHeld = false;
let joy = null;           // {id, ox, oy, x, y}
let isTouch = false;
addEventListener('keydown', (e) => {
  ensureAudio();
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  keys.add(k);
  if (k === 'p' || k === 'escape') togglePause();
  if ((k === 'enter' || k === ' ') && overlay.classList.contains('show') && g && g.state === 'result') {
    if (g.won && g.levelIdx < LEVELS.length - 1) startLevel(g.levelIdx + 1); else startLevel(g.levelIdx);
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { keys.clear(); hustleHeld = false; if (g && g.state === 'play') pause(); });

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * VH };
}
canvas.addEventListener('pointerdown', (e) => {
  ensureAudio();
  if (e.pointerType === 'touch') { isTouch = true; document.body.classList.add('touch'); }
  if (joy) return;
  const p = canvasPoint(e);
  joy = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y };
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
});
canvas.addEventListener('pointermove', (e) => { if (joy && joy.id === e.pointerId) { const p = canvasPoint(e); joy.x = p.x; joy.y = p.y; } });
const endJoy = (e) => { if (joy && joy.id === e.pointerId) joy = null; };
canvas.addEventListener('pointerup', endJoy);
canvas.addEventListener('pointercancel', endJoy);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const setHustle = (v) => { hustleHeld = v; hustleBtn.classList.toggle('held', v); };
hustleBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); ensureAudio(); setHustle(true); try { hustleBtn.setPointerCapture(e.pointerId); } catch (err) {} });
hustleBtn.addEventListener('pointerup', () => setHustle(false));
hustleBtn.addEventListener('pointercancel', () => setHustle(false));
btnPause.addEventListener('click', () => togglePause());
btnMute.addEventListener('click', () => { save.muted = !save.muted; persist(); btnMute.style.opacity = save.muted ? 0.5 : 1; });
btnMute.style.opacity = save.muted ? 0.5 : 1;
window.addEventListener('touchstart', () => { isTouch = true; document.body.classList.add('touch'); }, { once: true, passive: true });

function readInput() {
  let ix = 0, iy = 0;
  if (keys.has('arrowleft') || keys.has('a')) ix -= 1;
  if (keys.has('arrowright') || keys.has('d')) ix += 1;
  if (keys.has('arrowup') || keys.has('w')) iy -= 1;
  if (keys.has('arrowdown') || keys.has('s')) iy += 1;
  if (ix || iy) { const l = Math.hypot(ix, iy); ix /= l; iy /= l; }
  else if (joy) {
    const dx = joy.x - joy.ox, dy = joy.y - joy.oy, l = Math.hypot(dx, dy);
    if (l > 6) { const m = Math.min(1, l / 46); ix = dx / l * m; iy = dy / l * m; }
  }
  const hs = keys.has('shift') || keys.has('x') || hustleHeld;
  return { ix, iy, hs };
}

/* ---------- world building ---------- */
let g = null;     // current game state

function rectsOverlap(a, b, pad = 0) {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

function buildLevel(idx) {
  const L = LEVELS[idx];
  const r = mkRng(1000 + idx * 77);
  const H = L.H;
  const start = { x: W / 2, y: H - 60 };
  const gate = { x: W / 2 - 55 + (r() * 80 - 40), y: 0, w: 110, h: 46, name: GATE_NAMES[idx % GATE_NAMES.length], side: 'top' };
  gate.y = WALL - 6;
  const obs = [];
  const zones = [];
  const innerL = WALL + 10, innerR = W - WALL - 10;

  const free = (rect, pad = 54) => {
    if (rectsOverlap(rect, { x: start.x - 90, y: start.y - 90, w: 180, h: 160 })) return false;
    if (rectsOverlap(rect, { x: gate.x - 60, y: 0, w: gate.w + 120, h: 190 })) return false;
    for (const o of obs) if (rectsOverlap(rect, o, pad)) return false;
    return true;
  };
  const tryPlace = (w, h, kind, n) => {
    let placed = 0, guard = 0;
    while (placed < n && guard++ < 400) {
      const rect = { x: innerL + r() * (innerR - innerL - w), y: 200 + r() * (H - 420), w, h, kind };
      if (free(rect)) { obs.push(rect); placed++; }
    }
  };

  if (L.ropes) {
    // serpentine rope lines from alternating walls with a gap on the far side
    let left = true;
    for (let y = H - 260; y > 330; y -= 150) {
      const len = W - WALL * 2 - 140;
      obs.push({ x: left ? WALL : W - WALL - len, y, w: len, h: 8, kind: 'rope' });
      left = !left;
    }
  }
  if (L.walkway) {
    const wy = H * 0.22, wh = H * 0.56;
    zones.push({ type: 'walkway', x: W / 2 - 50, y: wy, w: 100, h: wh });
  }
  tryPlace(34, 34, 'pillar', L.pillars);
  tryPlace(70, 44, 'kiosk', L.kiosks);
  tryPlace(120, 26, 'seats', L.seats);

  const spot = (minY = 220) => {
    for (let i = 0; i < 80; i++) {
      const x = innerL + 20 + r() * (innerR - innerL - 40), y = minY + r() * (H - minY - 260);
      if (dist(x, y, start.x, start.y) < 200) continue;
      const rc = { x: x - 18, y: y - 18, w: 36, h: 36 };
      if (obs.some((o) => rectsOverlap(rc, o, 6))) continue;
      return { x, y };
    }
    return { x: W / 2, y: H / 2 };
  };

  for (let i = 0; i < L.spills; i++) { const p = spot(); zones.push({ type: 'spill', x: p.x, y: p.y, r: 38 }); }
  for (let i = 0; i < L.perfume; i++) { const p = spot(); zones.push({ type: 'perfume', x: p.x, y: p.y, r: 54, phase: r() * 6 }); }

  const ents = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const cols = ['#e76f51', '#2a9d8f', '#8338ec', '#fb8500', '#3a86ff', '#ef476f', '#06a77d', '#9c6644'];
  for (let i = 0; i < L.walkers; i++) {
    const p = spot(), d = pick(dirs, r), sp = 28 + r() * 28;
    ents.push({ type: 'walker', x: p.x, y: p.y, vx: d[0] * sp, vy: d[1] * sp, r: 12, color: pick(cols, r), label: '' });
  }
  for (let i = 0; i < L.phones; i++) {
    const p = spot();
    ents.push({ type: 'phone', x: p.x, y: p.y, vx: 0, vy: 0, r: 12, color: pick(cols, r), t: r() * 2, sp: 38 });
  }
  for (let i = 0; i < L.kids; i++) {
    const p = spot();
    ents.push({ type: 'kid', x: p.x, y: p.y, vx: 0, vy: 0, r: 8, color: pick(cols, r), t: 0, sp: 115 });
  }
  for (let i = 0; i < L.groups; i++) {
    const p = spot(), d = pick(dirs, r), n = 3 + Math.floor(r() * 2);
    const members = [];
    for (let m = 0; m < n; m++) members.push({ ox: (m - (n - 1) / 2) * 25, oy: (m % 2) * 14 - 7, r: 11, color: pick(cols, r) });
    const horiz = d[0] !== 0;
    if (!horiz) members.forEach((m, k) => { const t = m.ox; m.ox = (k % 2) * 14 - 7; m.oy = t; });
    ents.push({ type: 'group', x: p.x, y: p.y, vx: d[0] * 34, vy: d[1] * 34, r: 40, members });
  }
  for (let i = 0; i < L.luggage; i++) {
    const p = spot(), d = r() < 0.5 ? [1, 0] : [-1, 0];
    ents.push({ type: 'luggage', x: p.x, y: p.y, vx: d[0] * 85, vy: 0, r: 11, color: pick(cols, r) });
  }
  for (let i = 0; i < L.carts; i++) {
    const p = spot(), d = r() < 0.5 ? [0, 1] : [0, -1];
    ents.push({ type: 'cart', x: p.x, y: p.y, vx: 0, vy: d[1] * 175, r: 14 });
  }

  const announce = (L.announce || []).map(([at, text]) => ({ at, text, done: false }));
  const optSingle = dist(start.x, start.y, gate.x + gate.w / 2, gate.y + gate.h / 2);
  const limit = Math.ceil(optSingle * L.optFactor / SPEED * L.slack);

  return {
    levelIdx: idx, L, H, start, gate, obs, zones, ents, announce,
    limit, timeLeft: limit, t: 0,
    player: { x: start.x, y: start.y, vx: 0, vy: 0, stun: 0, hitCool: 0, stam: 1, face: -Math.PI / 2, step: 0 },
    path: 0, bumps: 0, close: 0, optAcc: 0, segStart: { x: start.x, y: start.y }, gateChanged: false,
    floaters: [], banner: null, shake: 0, state: 'play', won: false, finalBeeped: 0,
  };
}

/* ---------- collision utils ---------- */
function circleRectPush(cx, cy, cr, rc) {
  const nx = clamp(cx, rc.x, rc.x + rc.w), ny = clamp(cy, rc.y, rc.y + rc.h);
  let dx = cx - nx, dy = cy - ny, d = Math.hypot(dx, dy);
  if (d >= cr) return null;
  if (d === 0) { // center inside rect: push out the shortest way
    const l = cx - rc.x, rr = rc.x + rc.w - cx, t = cy - rc.y, b = rc.y + rc.h - cy, m = Math.min(l, rr, t, b);
    if (m === l) return { x: -(l + cr), y: 0 };
    if (m === rr) return { x: rr + cr, y: 0 };
    if (m === t) return { x: 0, y: -(t + cr) };
    return { x: 0, y: b + cr };
  }
  const push = cr - d;
  return { x: dx / d * push, y: dy / d * push };
}

function entCircles(e) {
  if (e.type === 'group') return e.members.map((m) => ({ x: e.x + m.ox, y: e.y + m.oy, r: m.r }));
  return [{ x: e.x, y: e.y, r: e.r }];
}
function entHitsObstacle(e) {
  for (const c of entCircles(e)) {
    if (c.x < WALL + c.r || c.x > W - WALL - c.r) return 'x';
    if (c.y < 150 || c.y > g.H - 30) return 'y';
    for (const o of g.obs) if (circleRectPush(c.x, c.y, c.r, o)) return 'o';
  }
  return null;
}

/* ---------- floaters / banners ---------- */
function floater(x, y, text, color = '#fff', big = false) { g.floaters.push({ x, y, text, color, big, t: 0 }); }
function showBanner(text, danger = false) { g.banner = { text, t: 0, danger }; sfx.chime(); }

const BUMP_LINES = ['SORRY!', 'EXCUSE ME!', 'OOF!', 'WATCH IT!', 'RUDE!', 'NOT AGAIN', 'MY LATTE!', 'REALLY??'];
const CLOSE_LINES = ['Close one', 'Smooth', 'Nice dodge', 'Threaded it', 'Clean'];

/* ---------- update ---------- */
function update(dt) {
  if (!g || g.state !== 'play') return;
  g.t += dt;
  g.timeLeft -= dt;
  const p = g.player;
  const inp = readInput();

  // timers
  p.stun = Math.max(0, p.stun - dt);
  p.hitCool = Math.max(0, p.hitCool - dt);
  g.shake = Math.max(0, g.shake - dt);

  // zones under the player
  let slow = 1, driftY = 0, onWalk = false;
  for (const z of g.zones) {
    if (z.type === 'walkway') { if (p.x > z.x && p.x < z.x + z.w && p.y > z.y && p.y < z.y + z.h) { driftY = -WALKWAY_DRIFT; onWalk = true; } }
    else if (dist(p.x, p.y, z.x, z.y) < z.r) slow = Math.min(slow, z.type === 'spill' ? 0.5 : 0.62);
  }

  // stamina / hustle
  const wantsHustle = inp.hs && (inp.ix || inp.iy) && p.stam > 0.04 && p.stun <= 0;
  if (wantsHustle) p.stam = Math.max(0, p.stam - dt * 0.42); else p.stam = Math.min(1, p.stam + dt * 0.22);
  const sp = (wantsHustle ? HUSTLE : SPEED) * (p.stun > 0 ? 0.3 : 1) * slow;

  // movement (input movement counts toward path length, belt drift does not)
  const mx = inp.ix * sp * dt, my = inp.iy * sp * dt;
  let nx = p.x + mx, ny = p.y + my + driftY * dt;
  const moved = Math.hypot(mx, my);
  g.path += moved;
  if (moved > 0.01) { p.face = Math.atan2(my, mx); p.step += moved * 0.12; }
  p.x = nx; p.y = ny;
  p.x = clamp(p.x, WALL + PR, W - WALL - PR);
  p.y = clamp(p.y, PR + 4, g.H - PR - 4);
  for (let it = 0; it < 3; it++) for (const o of g.obs) {
    const push = circleRectPush(p.x, p.y, PR, o);
    if (push) { p.x += push.x; p.y += push.y; }
  }
  p.x = clamp(p.x, WALL + PR, W - WALL - PR);

  // entities
  for (const e of g.ents) updateEnt(e, dt);

  // collisions with entities + close calls
  for (const e of g.ents) {
    e.cc = Math.max(0, (e.cc || 0) - dt);
    for (const c of entCircles(e)) {
      const d = dist(p.x, p.y, c.x, c.y);
      if (d < PR + c.r) {
        if (p.hitCool <= 0) bump(e, c, wantsHustle);
        else { const a = Math.atan2(p.y - c.y, p.x - c.x); p.x += Math.cos(a) * 1.5; p.y += Math.sin(a) * 1.5; }
        break;
      } else if (d < PR + c.r + 13 && p.hitCool <= 0 && e.cc <= 0 && p.stun <= 0) {
        e.cc = 2.5; g.close++; sfx.close();
        floater(p.x, p.y - 20, pick(CLOSE_LINES) + ' +25', '#06d6a0');
        break;
      }
    }
  }

  // gate change
  if (g.L.gateChange && !g.gateChanged && g.t >= g.L.gateChange) triggerGateChange();

  // finish?
  const gt = g.gate;
  if (p.x > gt.x - 6 && p.x < gt.x + gt.w + 6 && p.y > gt.y - 6 && p.y < gt.y + gt.h + 6) return finish(true);
  if (g.timeLeft <= 0) { g.timeLeft = 0; return finish(false); }

  // announcements
  for (const a of g.announce) if (!a.done && g.t >= a.at) { a.done = true; if (!(g.L.gateChange && a.at === g.L.gateChange)) showBanner(a.text); }
  if (g.timeLeft <= 10 && Math.ceil(g.timeLeft) !== g.finalBeeped) { g.finalBeeped = Math.ceil(g.timeLeft); sfx.tick(); if (g.finalBeeped === 10) showBanner('FINAL CALL. Gate closes in 10 seconds.', true); }

  // fx
  for (const f of g.floaters) f.t += dt;
  g.floaters = g.floaters.filter((f) => f.t < 1.1);
  if (g.banner) { g.banner.t += dt; if (g.banner.t > 4.2) g.banner = null; }
}

function triggerGateChange() {
  g.gateChanged = true;
  const p = g.player, gt = g.gate;
  g.optAcc += dist(g.segStart.x, g.segStart.y, p.x, p.y);
  g.segStart = { x: p.x, y: p.y };
  const left = p.x > W / 2;
  const ny = clamp(p.y + 420, 300, g.H - 160);
  gt.side = left ? 'left' : 'right';
  gt.w = 40; gt.h = 120; gt.x = left ? 0 : W - 40; gt.y = ny;
  gt.name = pick(GATE_NAMES.filter((n) => n !== gt.name));
  // keep the new door clear of obstacles
  g.obs = g.obs.filter((o) => !rectsOverlap(o, { x: gt.x - 50, y: gt.y - 40, w: gt.w + 100, h: gt.h + 80 }));
  g.timeLeft += g.L.bonusTime || 0;
  g.limit += g.L.bonusTime || 0;
  g.shake = 0.5;
  showBanner('GATE CHANGE! Now ' + gt.name + ', ' + (left ? 'LEFT' : 'RIGHT') + ' wall. Behind you. +' + (g.L.bonusTime || 0) + 's.', true);
}

function bump(e, c, hustling) {
  const p = g.player;
  g.bumps++;
  p.stun = hustling ? 1.15 : 0.7;
  p.hitCool = 1.0;
  g.shake = 0.25;
  const a = Math.atan2(p.y - c.y, p.x - c.x);
  p.x = clamp(p.x + Math.cos(a) * 16, WALL + PR, W - WALL - PR);
  p.y += Math.sin(a) * 16;
  // knock the other party around a bit
  if (e.type === 'cart') { e.vy *= -1; } else if (e.type !== 'group') { e.vx = -Math.cos(a) * 60; e.vy = -Math.sin(a) * 60; }
  sfx.bump();
  floater(p.x, p.y - 22, pick(BUMP_LINES) + ' -150', '#ff4d6d', true);
}

function updateEnt(e, dt) {
  const px = e.x, py = e.y;
  e.t = (e.t || 0) - dt;
  if (e.type === 'phone') {
    if (e.t <= 0) { // walk, stop, drift sideways, never look up
      e.t = 0.6 + Math.random() * 1.6;
      const roll = Math.random();
      if (roll < 0.3) { e.vx = 0; e.vy = 0; }
      else { const a = Math.random() * Math.PI * 2; e.vx = Math.cos(a) * e.sp; e.vy = Math.sin(a) * e.sp; }
    }
  } else if (e.type === 'kid') {
    if (e.t <= 0) { e.t = 0.35 + Math.random() * 0.7; const a = Math.random() * Math.PI * 2; e.vx = Math.cos(a) * e.sp; e.vy = Math.sin(a) * e.sp; }
  }
  e.x += e.vx * dt; e.y += e.vy * dt;
  const hit = entHitsObstacle(e);
  if (hit) {
    e.x = px; e.y = py;
    if (hit === 'x') e.vx *= -1; else if (hit === 'y') e.vy *= -1; else { e.vx *= -1; e.vy *= -1; }
    if (e.type === 'phone' || e.type === 'kid') e.t = 0;
  }
  if (e.vx || e.vy) e.face = Math.atan2(e.vy, e.vx);
}

/* ---------- finish + scoring ---------- */
function finish(won) {
  g.state = 'result'; g.won = won;
  const p = g.player;
  const optTotal = (g.optAcc + dist(g.segStart.x, g.segStart.y, g.gate.x + g.gate.w / 2, g.gate.y + g.gate.h / 2)) * g.L.optFactor;
  const eff = g.path > 1 ? clamp(optTotal / g.path, 0, 1.25) : 0;
  const idx = g.levelIdx;
  const timeLeft = won ? g.timeLeft : 0;
  const rows = {
    base: won ? 500 * (idx + 1) : 0,
    eff: won ? Math.round(2000 * Math.pow(Math.min(eff, 1.25), 3)) : 0,
    time: Math.round(timeLeft * 40),
    close: g.close * 25,
    bump: -g.bumps * 150,
  };
  const total = won ? Math.max(0, rows.base + rows.eff + rows.time + rows.close + rows.bump) : 0;
  const stars = !won ? 0 : (eff >= 0.85 && g.bumps <= 1) ? 3 : (eff >= 0.65 && g.bumps <= 4) ? 2 : 1;
  g.result = { eff, rows, total, stars, timeLeft, path: g.path, optTotal };
  const prev = save.best[idx];
  g.result.record = won && (!prev || total > prev.score);
  if (won && g.result.record) { save.best[idx] = { score: total, stars: Math.max(stars, prev ? prev.stars : 0) }; persist(); }
  else if (won && prev && stars > prev.stars) { prev.stars = stars; persist(); }
  won ? sfx.win() : sfx.fail();
  document.body.classList.remove('playing');
  setTimeout(() => { if (g && g.state === 'result') renderResult(); }, won ? 350 : 500);
}

/* ---------- screens ---------- */
function stars(n) { return '<span class="stars">' + '&#9733;'.repeat(n) + '<span style="opacity:.3">' + '&#9733;'.repeat(3 - n) + '</span></span>'; }

function renderMenu() {
  if (g) g.state = 'menu';
  document.body.classList.remove('playing');
  overlay.classList.add('show');
  let html = '<h1>SIDEWALK</h1><div class="tag">Your gate is at the other end of the airport. Your flight boards in minutes. Everyone else is walking at 0.4 mph and looking at their phone.</div>';
  html += '<div class="grid">';
  LEVELS.forEach((L, i) => {
    const b = save.best[i], un = isUnlocked(i);
    html += '<button class="lvl' + (un ? '' : ' locked') + '" data-i="' + i + '"><b>' + (i + 1) + '. ' + L.name + '</b><small>' + (un ? L.sub : 'Finish the previous level') + '</small><br>' +
      (b ? stars(b.stars) + ' <small>' + b.score + '</small>' : (un ? '<small>Not cleared</small>' : '&#128274;')) + '</button>';
  });
  html += '</div>';
  html += '<div class="how"><b>Move:</b> WASD / arrows, or drag anywhere on a touchscreen.<br><b>Hustle:</b> hold Shift (or the red button). Fast, but a crash while hustling costs more.<br>' +
    '<b>Score:</b> straight lines beat detours. Efficiency = shortest path / the path you walked. Collisions cost 150 each, close calls pay 25, spare seconds pay 40. Moving walkways are free distance.<br><b>Pause:</b> P or Esc.</div>';
  panel.innerHTML = html;
  panel.querySelectorAll('.lvl').forEach((b) => b.addEventListener('click', () => { ensureAudio(); const i = +b.dataset.i; if (isUnlocked(i)) startLevel(i); }));
}

const ROASTS = {
  S: ['Textbook. Airport staff want to study your footage.', 'Efficient, calm, borderline unsettling.'],
  A: ['Strong. Barely a hair out of place.', 'You walk like you have Global Entry and a purpose.'],
  B: ['Fine. You will make the flight and complain about it.', 'Respectable. Somebody spilled a latte on you, though.'],
  C: ['You took the scenic route. Of a different airport.', 'Made it. The gate agent already hates you.'],
  D: ['You just made it. The plane is 80% sure you were a hallucination.', 'Cardio, accidental. Dignity, gone.'],
  F: ['You missed your flight. It is now a very expensive tomorrow.', 'The plane left. You can watch it from the window, like everybody else.', 'Gate closed. A stranger ate your seat snack.'],
};
function gradeOf(r) {
  if (!g.won) return 'F';
  const s = r.eff * 100 - g.bumps * 7 + (r.timeLeft > 0 ? Math.min(10, r.timeLeft / 3) : 0);
  return s >= 95 ? 'S' : s >= 82 ? 'A' : s >= 68 ? 'B' : s >= 50 ? 'C' : 'D';
}

function renderResult() {
  const r = g.result, won = g.won, grade = gradeOf(r);
  const last = g.levelIdx === LEVELS.length - 1;
  let html = '<div class="grade">' + grade + '</div><h2>' + (won ? 'BOARDED' : 'MISSED IT') + '</h2>';
  if (won) html += '<div>' + stars(r.stars) + (r.record ? ' <span class="new">NEW BEST</span>' : '') + '</div>';
  html += '<div class="roast">' + pick(ROASTS[grade]) + '</div>';
  if (won) {
    html += '<table class="res">' +
      '<tr><td>Level bonus</td><td>' + r.rows.base + '</td></tr>' +
      '<tr><td>Efficiency (' + Math.round(r.eff * 100) + '%)</td><td>+' + r.rows.eff + '</td></tr>' +
      '<tr><td>Time left (' + r.timeLeft.toFixed(1) + 's)</td><td>+' + r.rows.time + '</td></tr>' +
      '<tr><td>Close calls (' + g.close + ')</td><td>+' + r.rows.close + '</td></tr>' +
      '<tr><td>Collisions (' + g.bumps + ')</td><td>' + r.rows.bump + '</td></tr>' +
      '<tr class="tot"><td>Total</td><td>' + r.total + '</td></tr></table>' +
      '<div class="tag">You walked ' + (r.path / PX_PER_M).toFixed(0) + ' m. Ideal was ' + (r.optTotal / PX_PER_M).toFixed(0) + ' m.</div>';
  } else {
    html += '<div class="tag">You walked ' + (r.path / PX_PER_M).toFixed(0) + ' m and bumped into ' + g.bumps + ' people. The gate door is shut.</div>';
  }
  if (won && !last) html += '<button class="btn" id="bNext">Next level</button>';
  html += '<button class="btn alt" id="bRetry">' + (won ? 'Replay' : 'Run it back') + '</button><button class="btn alt" id="bMenu">Levels</button>';
  if (won && last) html += '<div class="tag">That was the last gate. You are free. Go home.</div>';
  panel.innerHTML = html;
  overlay.classList.add('show');
  const q = (id) => document.getElementById(id);
  if (q('bNext')) q('bNext').onclick = () => startLevel(g.levelIdx + 1);
  q('bRetry').onclick = () => startLevel(g.levelIdx);
  q('bMenu').onclick = renderMenu;
}

function startLevel(i) {
  ensureAudio();
  g = buildLevel(i);
  overlay.classList.remove('show');
  document.body.classList.add('playing');
  joy = null;
  showBanner('Level ' + (i + 1) + ': ' + g.L.name + '. Gate ' + g.gate.name + '. Go go go.');
  window.__gd = g;
}

function pause() {
  if (!g || g.state !== 'play') return;
  g.state = 'paused';
  panel.innerHTML = '<h2>Paused</h2><div class="tag">Gate agents are also on a break.</div><button class="btn" id="bRes">Resume</button><button class="btn alt" id="bQuit">Give up</button>';
  overlay.classList.add('show');
  document.getElementById('bRes').onclick = unpause;
  document.getElementById('bQuit').onclick = renderMenu;
}
function unpause() { if (g && g.state === 'paused') { g.state = 'play'; overlay.classList.remove('show'); } }
function togglePause() { if (!g) return; if (g.state === 'play') pause(); else if (g.state === 'paused') unpause(); }

/* ---------- rendering ---------- */
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = Math.round(canvas.clientWidth * dpr), ch = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawPerson(x, y, r, color, face, opts = {}) {
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 3, r + 2, r, 0, 0, 7); ctx.fill();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();         // shoulders
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = opts.head || '#f1c27d'; ctx.beginPath(); ctx.arc(x + Math.cos(face || 0) * r * 0.2, y + Math.sin(face || 0) * r * 0.2, r * 0.52, 0, 7); ctx.fill();
  if (opts.phone) {
    const fx = Math.cos(face || 0), fy = Math.sin(face || 0);
    ctx.save(); ctx.translate(x + fx * r * 0.95, y + fy * r * 0.95); ctx.rotate((face || 0) + Math.PI / 2);
    ctx.fillStyle = '#9be7ff'; ctx.fillRect(-3, -5, 6, 10); ctx.restore();
    ctx.fillStyle = 'rgba(155,231,255,.25)'; ctx.beginPath(); ctx.arc(x + fx * r * 1.1, y + fy * r * 1.1, 11, 0, 7); ctx.fill();
  }
}

function drawFloor(cy) {
  ctx.fillStyle = '#dfe3ea'; ctx.fillRect(0, 0, W, VH);
  const T = 48;
  ctx.fillStyle = '#d3d8e2';
  const y0 = Math.floor(cy / T) * T;
  for (let y = y0; y < cy + VH + T; y += T) for (let x = 0; x < W; x += T) {
    if (((x / T) + (y / T)) % 2 === 0) ctx.fillRect(x, y - cy, T, T);
  }
  // walls
  ctx.fillStyle = '#14213d'; ctx.fillRect(0, 0, WALL, VH); ctx.fillRect(W - WALL, 0, WALL, VH);
  ctx.fillStyle = '#fca311';
  for (let y = Math.floor(cy / 80) * 80; y < cy + VH; y += 80) { ctx.fillRect(WALL - 3, y - cy, 3, 40); ctx.fillRect(W - WALL, y - cy, 3, 40); }
  // top wall
  if (cy < WALL + 10) { ctx.fillStyle = '#14213d'; ctx.fillRect(0, -cy, W, WALL - 4); }
}

function drawZone(z, cy) {
  if (z.type === 'walkway') {
    const y = z.y - cy; if (y > VH || y + z.h < 0) return;
    ctx.fillStyle = '#3d4a63'; ctx.fillRect(z.x, y, z.w, z.h);
    ctx.fillStyle = '#ffd166'; ctx.fillRect(z.x - 3, y, 3, z.h); ctx.fillRect(z.x + z.w, y, 3, z.h);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    const off = (g.t * WALKWAY_DRIFT) % 40;
    for (let k = -1; k < z.h / 40 + 1; k++) {
      const ay = y + z.h - k * 40 - off; if (ay < y + 6 || ay > y + z.h - 2) continue;
      for (const ax of [z.x + 25, z.x + 50, z.x + 75]) { ctx.beginPath(); ctx.moveTo(ax, ay - 10); ctx.lineTo(ax + 8, ay); ctx.lineTo(ax - 8, ay); ctx.closePath(); ctx.fill(); }
    }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('MOVING WALKWAY', z.x + z.w / 2, y + 14);
  } else if (z.type === 'spill') {
    const y = z.y - cy; if (y < -60 || y > VH + 60) return;
    ctx.fillStyle = 'rgba(80,160,255,.45)'; ctx.beginPath(); ctx.ellipse(z.x, y, z.r, z.r * 0.8, 0.3, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.moveTo(z.x, y - 14); ctx.lineTo(z.x + 11, y + 10); ctx.lineTo(z.x - 11, y + 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#000'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', z.x, y + 8);
  } else if (z.type === 'perfume') {
    const y = z.y - cy; if (y < -80 || y > VH + 80) return;
    const pulse = 0.5 + 0.5 * Math.sin(g.t * 2 + z.phase);
    ctx.fillStyle = 'rgba(200,120,255,' + (0.18 + pulse * 0.15) + ')'; ctx.beginPath(); ctx.arc(z.x, y, z.r + pulse * 6, 0, 7); ctx.fill();
    ctx.fillStyle = '#7b2cbf'; ctx.fillRect(z.x - 6, y - 10, 12, 20); ctx.fillStyle = '#e0aaff'; ctx.fillRect(z.x - 3, y - 14, 6, 5);
  }
}

function drawObstacle(o, cy) {
  const y = o.y - cy; if (y > VH || y + o.h < 0) return;
  if (o.kind === 'pillar') { ctx.fillStyle = '#8d99ae'; ctx.fillRect(o.x, y, o.w, o.h); ctx.fillStyle = '#edf2f4'; ctx.fillRect(o.x + 4, y + 4, o.w - 8, o.h - 8); }
  else if (o.kind === 'kiosk') { ctx.fillStyle = '#6d597a'; roundRect(o.x, y, o.w, o.h, 6); ctx.fill(); ctx.fillStyle = '#ffb4a2'; ctx.fillRect(o.x + 6, y + 6, o.w - 12, 8); ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('SHOP', o.x + o.w / 2, y + o.h - 8); }
  else if (o.kind === 'seats') { ctx.fillStyle = '#355070'; roundRect(o.x, y, o.w, o.h, 5); ctx.fill(); ctx.fillStyle = '#6d6875'; for (let i = 0; i < 4; i++) ctx.fillRect(o.x + 6 + i * 29, y + 5, 22, o.h - 10); }
  else if (o.kind === 'rope') { ctx.fillStyle = '#c1121f'; ctx.fillRect(o.x, y, o.w, o.h); ctx.fillStyle = '#ffd166'; for (let x = o.x; x <= o.x + o.w; x += 40) { ctx.beginPath(); ctx.arc(x, y + 4, 6, 0, 7); ctx.fill(); } }
}

function drawEnt(e, cy) {
  const y = e.y - cy; if (y < -80 || y > VH + 80) return;
  if (e.type === 'walker') drawPerson(e.x, y, e.r, e.color, e.face);
  else if (e.type === 'phone') drawPerson(e.x, y, e.r, e.color, e.face, { phone: true });
  else if (e.type === 'kid') {
    drawPerson(e.x, y, e.r, e.color, e.face, { head: '#ffd6a5' });
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(e.x, y - 6); ctx.lineTo(e.x - 3, y - 22); ctx.stroke();
    ctx.fillStyle = '#ff006e'; ctx.beginPath(); ctx.arc(e.x - 3, y - 26, 6, 0, 7); ctx.fill();
  } else if (e.type === 'group') {
    for (const m of e.members) drawPerson(e.x + m.ox, y + m.oy, m.r, m.color, e.face);
  } else if (e.type === 'luggage') {
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(e.x - 9, y - 13, 20, 28);
    ctx.fillStyle = e.color; roundRect(e.x - 10, y - 14, 20, 28, 4); ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(e.x - 5, y - 14); ctx.lineTo(e.x - 5, y - 20); ctx.lineTo(e.x + 5, y - 20); ctx.lineTo(e.x + 5, y - 14); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(e.x - 7, y - 8, 14, 3); ctx.fillRect(e.x - 7, y, 14, 3);
  } else if (e.type === 'cart') {
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(e.x - 14, y - 21, 31, 46);
    ctx.fillStyle = '#ffd166'; roundRect(e.x - 15, y - 22, 30, 44, 6); ctx.fill();
    ctx.fillStyle = '#264653'; ctx.fillRect(e.x - 10, y - 12, 20, 16);
    const blink = Math.floor(g.t * 6) % 2 === 0;
    ctx.fillStyle = blink ? '#ff0000' : '#7f0000'; ctx.beginPath(); ctx.arc(e.x, y - 4, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#000'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('BEEP', e.x, y + 16);
  }
}

function drawGate(cy) {
  const gt = g.gate, y = gt.y - cy;
  if (y > VH || y + gt.h < -20) return;
  const pulse = 0.5 + 0.5 * Math.sin(g.t * 5);
  ctx.fillStyle = '#06d6a0'; ctx.globalAlpha = 0.25 + pulse * 0.2;
  ctx.fillRect(gt.x - 6, y - 6, gt.w + 12, gt.h + 12); ctx.globalAlpha = 1;
  ctx.fillStyle = '#0b132b'; ctx.fillRect(gt.x, y, gt.w, gt.h);
  ctx.strokeStyle = '#06d6a0'; ctx.lineWidth = 3; ctx.strokeRect(gt.x, y, gt.w, gt.h);
  ctx.fillStyle = '#ffd166'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
  if (gt.side === 'top') { ctx.fillText('GATE ' + gt.name, gt.x + gt.w / 2, y + 22); ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#06d6a0'; ctx.fillText('NOW BOARDING', gt.x + gt.w / 2, y + 38); }
  else { ctx.save(); ctx.translate(gt.x + gt.w / 2 + 4, y + gt.h / 2); ctx.rotate(gt.side === 'left' ? -Math.PI / 2 : Math.PI / 2); ctx.fillText('GATE ' + gt.name, 0, 0); ctx.restore(); }
}

function drawPlayer(cy) {
  const p = g.player, y = p.y - cy;
  const blink = p.hitCool > 0 && Math.floor(g.t * 14) % 2 === 0;
  if (blink) ctx.globalAlpha = 0.45;
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(p.x + 2, y + 4, PR + 3, PR, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#e63946'; ctx.beginPath(); ctx.arc(p.x, y, PR, 0, 7); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(p.x + Math.cos(p.face) * 2, y + Math.sin(p.face) * 2, 6, 0, 7); ctx.fill();
  // backpack
  ctx.fillStyle = '#1d3557'; ctx.beginPath(); ctx.arc(p.x - Math.cos(p.face) * 8, y - Math.sin(p.face) * 8, 5, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;
  if (p.stun > 0) { ctx.fillStyle = '#ffd166'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('*  *  *', p.x, y - 18); }
}

function drawHUD() {
  // top bar
  ctx.fillStyle = 'rgba(11,19,43,.82)'; ctx.fillRect(0, 0, W, 44);
  ctx.textAlign = 'left'; ctx.fillStyle = '#a8dadc'; ctx.font = 'bold 12px sans-serif';
  ctx.fillText('LEVEL ' + (g.levelIdx + 1), 10, 17);
  ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.fillText(g.L.name, 10, 34);
  const low = g.timeLeft <= 10;
  ctx.textAlign = 'center'; ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = low && Math.floor(g.t * 4) % 2 === 0 ? '#ff4d6d' : (low ? '#ffd166' : '#fff');
  ctx.fillText(fmtTime(g.timeLeft), W / 2, 31);
  ctx.textAlign = 'right'; ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#ff9eb1';
  ctx.fillText('CRASHES ' + g.bumps, W - 140, 17);
  ctx.fillStyle = '#9be7c4'; ctx.fillText('CLOSE ' + g.close, W - 140, 34);

  // stamina
  const p = g.player;
  ctx.fillStyle = 'rgba(11,19,43,.7)'; roundRect(10, VH - 26, 110, 14, 7); ctx.fill();
  ctx.fillStyle = p.stam > 0.25 ? '#ffd166' : '#ff4d6d'; roundRect(12, VH - 24, 106 * p.stam, 10, 5); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('HUSTLE', 14, VH - 16);

  // progress strip + gate pointer
  const gt = g.gate, gcx = gt.x + gt.w / 2, gcy = gt.y + gt.h / 2;
  const camY = camTop();
  const gy = gcy - camY;
  if (gy < 60 || gy > VH - 10 || gt.side !== 'top') {
    const ang = Math.atan2(gcy - p.y, gcx - p.x);
    const cx = W / 2, cyy = 122;
    ctx.save(); ctx.translate(cx, cyy); ctx.rotate(ang);
    ctx.fillStyle = 'rgba(6,214,160,.92)'; ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-10, -13); ctx.lineTo(-4, 0); ctx.lineTo(-10, 13); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(Math.round(dist(p.x, p.y, gcx, gcy) / PX_PER_M) + ' m to gate ' + gt.name, cx, cyy + 30);
  }
  // banner
  if (g.banner) {
    const b = g.banner, a = Math.min(1, b.t * 5, (4.2 - b.t) * 3);
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = b.danger ? 'rgba(230,57,70,.95)' : 'rgba(20,33,61,.93)';
    roundRect(14, 52, W - 28, 44, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    wrapText(b.text, W / 2, 70, W - 56, 15);
    ctx.globalAlpha = 1;
  }
  // joystick
  if (joy) {
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3; ctx.fillStyle = 'rgba(0,0,0,.12)';
    ctx.beginPath(); ctx.arc(joy.ox, joy.oy, 46, 0, 7); ctx.fill(); ctx.stroke();
    const dx = joy.x - joy.ox, dy = joy.y - joy.oy, l = Math.hypot(dx, dy), m = Math.min(l, 46) / (l || 1);
    ctx.fillStyle = 'rgba(230,57,70,.85)'; ctx.beginPath(); ctx.arc(joy.ox + dx * m, joy.oy + dy * m, 20, 0, 7); ctx.fill();
  }
}

function wrapText(text, x, y, maxW, lh) {
  const words = text.split(' '); let line = '', lines = [];
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  lines.push(line);
  const startY = y - (lines.length - 1) * lh / 2 + 4;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lh));
}

function camTop() {
  const p = g.player;
  return clamp(p.y - VH * 0.62, 0, g.H - VH);
}

function draw() {
  resize();
  const s = canvas.width / W;
  ctx.setTransform(s, 0, 0, canvas.height / VH, 0, 0);
  if (!g) { ctx.fillStyle = '#14213d'; ctx.fillRect(0, 0, W, VH); return; }
  const cy = camTop();
  ctx.save();
  if (g.shake > 0) ctx.translate((Math.random() - 0.5) * 6 * g.shake * 4, (Math.random() - 0.5) * 6 * g.shake * 4);
  drawFloor(cy);
  for (const z of g.zones) drawZone(z, cy);
  drawGate(cy);
  for (const o of g.obs) drawObstacle(o, cy);
  for (const e of g.ents) drawEnt(e, cy);
  drawPlayer(cy);
  for (const f of g.floaters) {
    ctx.globalAlpha = Math.max(0, 1 - f.t / 1.1); ctx.fillStyle = f.color; ctx.textAlign = 'center';
    ctx.font = (f.big ? 'bold 16px' : 'bold 13px') + ' sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3; ctx.strokeText(f.text, f.x, f.y - cy - f.t * 34); ctx.fillText(f.text, f.x, f.y - cy - f.t * 34);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  drawHUD();
}

/* ---------- loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
renderMenu();
requestAnimationFrame(frame);
window.__gateDash = { get state() { return g; }, startLevel, LEVELS };
})();
