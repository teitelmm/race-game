import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LEVELS } from './levels.js';
import { buildLevel, animateCourse, disposeLevel } from './course.js';
import { BALL_R, HOLE_R, makeBall, stepBall, updateMovers } from './physics.js';
import * as sfx from './audio.js';

const STEP = 1 / 240;
const MAX_SPEED = { putt: 18, chip: 16 };
const CHIP_ANGLE = 0.8;
const MAX_STROKES = 10;
const WATER_Y = -3;
const PREVIEW_DOTS = 28;
const BEST_KEY = 'slingshot-golf-best';

const $ = (id) => document.getElementById(id);
const canvas = $('game');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = (() => {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5aa9f0');
  grad.addColorStop(0.6, '#a9d7ff');
  grad.addColorStop(1, '#e8f5ff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
scene.fog = new THREE.Fog(0xcde8ff, 45, 140);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);

scene.add(new THREE.HemisphereLight(0xdff1ff, 0x4a6b3a, 1.1));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x3b9ee6, roughness: 0.25, metalness: 0.1 }),
);
water.position.y = WATER_Y;
scene.add(water);

const clouds = new THREE.Group();
{
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const geo = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(Math.random() * 3);
    for (let j = 0; j < puffs; j++) {
      const m = new THREE.Mesh(geo, mat);
      const s = 1.5 + Math.random() * 1.8;
      m.scale.set(s, s * 0.7, s);
      m.position.set(j * 2 - puffs, Math.random() * 0.8, Math.random() * 1.5);
      cloud.add(m);
    }
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
    const r = 55 + Math.random() * 35;
    cloud.position.set(Math.cos(a) * r, 6 + Math.random() * 14, Math.sin(a) * r);
    cloud.rotation.y = Math.random() * Math.PI;
    clouds.add(cloud);
  }
  scene.add(clouds);
}

// ---------- ball & aim visuals ----------
const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_R, 32, 20),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }),
);
ballMesh.castShadow = true;
scene.add(ballMesh);

const readyRing = new THREE.Mesh(
  new THREE.RingGeometry(0.3, 0.38, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
);
scene.add(readyRing);

const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 10, 8), dotMat, PREVIEW_DOTS);
dots.frustumCulled = false;
dots.visible = false;
scene.add(dots);

const bandMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const band = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8).translate(0, 0.5, 0).rotateX(Math.PI / 2), bandMat);
const handle = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), bandMat);
band.visible = handle.visible = false;
scene.add(band, handle);

// ---------- particles ----------
const MAX_PARTICLES = 220;
const particles = [];
const partMesh = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.14, 0.09),
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  MAX_PARTICLES,
);
partMesh.frustumCulled = false;
partMesh.count = 0;
scene.add(partMesh);

function burst(pos, count, colors, speed, lift) {
  const c = new THREE.Color();
  for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.6);
    particles.push({
      pos: pos.clone(),
      vel: new THREE.Vector3(Math.cos(a) * s, lift * (0.6 + Math.random() * 0.8), Math.sin(a) * s),
      rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0),
      spin: (Math.random() - 0.5) * 12,
      life: 1.6 + Math.random() * 1.2,
      color: c.set(colors[i % colors.length]).clone(),
    });
  }
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vel.y -= 9 * dt;
    p.vel.multiplyScalar(1 - dt * 0.8);
    p.pos.addScaledVector(p.vel, dt);
    p.rot.x += p.spin * dt;
    p.rot.y += p.spin * 0.7 * dt;
  }
  particles.forEach((p, i) => {
    _q.setFromEuler(p.rot);
    _m4.compose(p.pos, _q, _one);
    partMesh.setMatrixAt(i, _m4);
    partMesh.setColorAt(i, p.color);
  });
  partMesh.count = particles.length;
  partMesh.instanceMatrix.needsUpdate = true;
  if (partMesh.instanceColor) partMesh.instanceColor.needsUpdate = true;
}

// ---------- controls ----------
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.enablePan = false;
controls.minDistance = 3;
controls.maxDistance = 32;
controls.maxPolarAngle = Math.PI * 0.46;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

// ---------- game state ----------
const state = {
  phase: 'title', // title | intro | ready | aiming | rolling | penalty | sinking | between | done
  levelIndex: 0,
  strokes: 0,
  scores: [],
  mode: 'putt',
  restTime: 0,
  rollTime: 0,
  introT: 0,
  sinkT: 0,
  time: 0,
};
let level = null;
let ball = makeBall(new THREE.Vector3());
const lastSafe = new THREE.Vector3();
const events = [];
const timers = [];
let aim = null;
const touches = new Set();
const keys = new Set();

const intro = { fromPos: new THREE.Vector3(), fromTarget: new THREE.Vector3(), toPos: new THREE.Vector3(), toTarget: new THREE.Vector3() };

function later(sec, fn) {
  timers.push({ t: sec, fn });
}

// ---------- HUD ----------
const hud = {
  hole: $('holeNum'), holeTotal: $('holeTotal'), name: $('holeName'), par: $('par'), strokes: $('strokes'),
  total: $('total'), power: $('power'), powerFill: $('powerFill'), hint: $('hint'), banner: $('banner'),
  bannerTitle: $('bannerTitle'), bannerSub: $('bannerSub'),
};
hud.holeTotal.textContent = `/${LEVELS.length}`;

function relToPar(n) {
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`;
}

function updateHud() {
  const def = LEVELS[state.levelIndex];
  hud.hole.textContent = state.levelIndex + 1;
  hud.name.textContent = def.name;
  hud.par.textContent = def.par;
  hud.strokes.textContent = state.strokes;
  let played = 0, par = 0;
  state.scores.forEach((s, i) => { played += s; par += LEVELS[i].par; });
  hud.total.textContent = relToPar(played - par);
  hud.total.style.color = played < par ? 'var(--good)' : played > par ? 'var(--accent)' : 'inherit';
}

let bannerTimer = 0;
function showBanner(title, sub = '', seconds = 1.8, tone = '') {
  hud.bannerTitle.textContent = title;
  hud.bannerSub.textContent = sub;
  hud.banner.className = `show ${tone}`;
  bannerTimer = seconds;
}

function setHint(text) {
  hud.hint.textContent = text;
  hud.hint.classList.toggle('hidden', !text);
}

function setMode(mode) {
  state.mode = mode;
  $('modePutt').classList.toggle('active', mode === 'putt');
  $('modeChip').classList.toggle('active', mode === 'chip');
  if (aim) updateAim();
}

// ---------- level flow ----------
function loadLevel(i) {
  if (level) {
    scene.remove(level.group);
    disposeLevel(level);
  }
  timers.length = 0;
  state.levelIndex = i;
  state.strokes = 0;
  level = buildLevel(LEVELS[i]);
  scene.add(level.group);

  ball = makeBall(level.tee);
  lastSafe.copy(level.tee);
  ballMesh.visible = true;
  ballMesh.scale.setScalar(1);

  const b = level.bounds;
  const center = b.getCenter(new THREE.Vector3());
  const size = b.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z);
  sun.position.copy(center).add(new THREE.Vector3(12, 25, 10));
  sun.target.position.copy(center);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -span * 0.75;
  sc.right = sc.top = span * 0.75;
  sc.near = 1;
  sc.far = 80;
  sc.updateProjectionMatrix();

  const away = level.tee.clone().sub(level.world.hole).setY(0).normalize();
  intro.fromTarget.copy(center);
  intro.fromPos.copy(center).addScaledVector(away, span * 0.55).add(new THREE.Vector3(0, span * 0.95, 0));
  intro.toTarget.copy(level.tee);
  intro.toPos.copy(level.tee).addScaledVector(away, 7).add(new THREE.Vector3(0, 4.2, 0));
  camera.position.copy(intro.fromPos);
  controls.target.copy(intro.fromTarget);

  state.introT = 0;
  if (state.phase !== 'title') {
    state.phase = 'intro';
    controls.enabled = false;
    showBanner(`Hole ${i + 1} · ${LEVELS[i].name}`, `Par ${LEVELS[i].par}`, 2.2);
    setHint('');
  }
  updateHud();
}

function startRound() {
  state.scores = [];
  state.phase = 'intro';
  $('title').classList.add('hidden');
  $('scorecard').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('dock').classList.remove('hidden');
  loadLevel(0);
}

function finishIntro() {
  state.phase = 'rolling';
  state.rollTime = 0;
  camera.position.copy(intro.toPos);
  controls.target.copy(intro.toTarget);
  controls.enabled = true;
}

function onRest() {
  if (state.strokes >= MAX_STROKES) {
    state.phase = 'between';
    state.scores[state.levelIndex] = MAX_STROKES;
    showBanner('Picked up', `${MAX_STROKES} strokes max`, 1.8, 'bad');
    updateHud();
    later(2, nextLevel);
    return;
  }
  state.phase = 'ready';
  setHint(state.strokes === 0 && state.levelIndex === 0
    ? 'Pull back anywhere, release to shoot'
    : '');
}

function shoot({ dir, power }) {
  const speed = MAX_SPEED[state.mode] * power;
  if (state.mode === 'chip') {
    ball.vel.set(dir.x * speed * Math.cos(CHIP_ANGLE), speed * Math.sin(CHIP_ANGLE), dir.z * speed * Math.cos(CHIP_ANGLE));
  } else {
    ball.vel.set(dir.x * speed, 0, dir.z * speed);
  }
  lastSafe.copy(ball.pos);
  state.strokes++;
  state.phase = 'rolling';
  state.rollTime = 0;
  state.restTime = 0;
  sfx.hit(power);
  setHint('');
  updateHud();
}

function waterHazard() {
  state.phase = 'penalty';
  sfx.splash();
  burst(new THREE.Vector3(ball.pos.x, WATER_Y + 0.1, ball.pos.z), 40, ['#bfe6ff', '#ffffff', '#7cc4f5'], 2.5, 5);
  ballMesh.visible = false;
  state.strokes++;
  updateHud();
  showBanner('Splash!', '+1 stroke penalty', 1.4, 'bad');
  later(1.2, () => {
    ball = makeBall(lastSafe);
    ballMesh.visible = true;
    state.phase = 'rolling';
    state.rollTime = 0;
  });
}

const sinkFrom = new THREE.Vector3();
function sinkBall() {
  state.phase = 'sinking';
  state.sinkT = 0;
  sinkFrom.copy(ball.pos);
  sfx.sink();
  later(0.55, holeResult);
}

const TERMS = { '-4': 'Condor!', '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double Bogey', 3: 'Triple Bogey' };
function holeResult() {
  const def = LEVELS[state.levelIndex];
  const diff = state.strokes - def.par;
  state.scores[state.levelIndex] = state.strokes;
  updateHud();
  const hio = state.strokes === 1;
  const title = hio ? 'HOLE IN ONE!' : TERMS[diff] ?? `+${diff}`;
  const sub = `${state.strokes} stroke${state.strokes === 1 ? '' : 's'} · ${relToPar(diff)}`;
  showBanner(title, sub, 2.3, diff < 0 || hio ? 'great' : diff === 0 ? '' : 'bad');
  if (diff < 0 || hio) {
    sfx.fanfare();
    const h = level.world.hole;
    burst(new THREE.Vector3(h.x, h.y + 0.3, h.z), hio ? 160 : 90, ['#ff4d6d', '#ffd23f', '#3bceac', '#4d8bff', '#ffffff'], 4, 9);
  }
  state.phase = 'between';
  later(2.5, nextLevel);
}

function nextLevel() {
  if (state.levelIndex + 1 < LEVELS.length) loadLevel(state.levelIndex + 1);
  else finishRound();
}

function readBest() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY)); } catch { return null; }
}

function finishRound() {
  state.phase = 'done';
  setHint('');
  const total = state.scores.reduce((a, b) => a + b, 0);
  const par = LEVELS.reduce((a, l) => a + l.par, 0);
  const best = readBest();
  const isBest = best == null || total < best;
  if (isBest) {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(total)); } catch { /* storage unavailable */ }
  }
  const row = (label, cells, cls = '') => `<tr class="${cls}"><th>${label}</th>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  const scoreCells = state.scores.map((s, i) => {
    const d = s - LEVELS[i].par;
    const cls = s === 1 ? 'ace' : d < 0 ? 'under' : d > 0 ? 'over' : '';
    return `<span class="${cls}">${s}</span>`;
  });
  $('cardTable').innerHTML =
    row('Hole', LEVELS.map((_, i) => i + 1).concat('Tot'), 'head') +
    row('Par', LEVELS.map((l) => l.par).concat(par)) +
    row('You', scoreCells.concat(`<b>${total}</b>`));
  $('cardTotal').textContent = relToPar(total - par);
  $('cardBest').textContent = isBest ? 'New personal best!' : `Personal best: ${best} (${relToPar(best - par)})`;
  $('cardBest').classList.toggle('pb', isBest);
  $('scorecard').classList.remove('hidden');
  $('dock').classList.add('hidden');
  if (isBest) sfx.fanfare();
}

// ---------- aiming ----------
const _fwd = new THREE.Vector3();
function updateAim(x = aim.x, y = aim.y) {
  aim.x = x;
  aim.y = y;
  const dx = x - aim.sx, dy = y - aim.sy;
  const len = Math.hypot(dx, dy);
  const full = Math.min(window.innerWidth, window.innerHeight) * 0.32;
  aim.power = Math.min(len / full, 1);
  camera.getWorldDirection(_fwd).setY(0).normalize();
  if (len > 1) {
    // Pulling toward the viewer shoots away from them; pulling left shoots right.
    aim.dir.set(_fwd.x * dy + _fwd.z * dx, 0, _fwd.z * dy - _fwd.x * dx).normalize();
  }
  hud.powerFill.style.width = `${aim.power * 100}%`;
  hud.powerFill.style.background = `hsl(${120 - aim.power * 120}, 85%, 52%)`;
  updatePreview();
}

function cancelAim() {
  aim = null;
  if (state.phase === 'aiming') state.phase = 'ready';
  controls.enabled = true;
  dots.visible = band.visible = handle.visible = false;
  hud.power.classList.add('hidden');
}

const previewBall = makeBall(new THREE.Vector3());
const _dotColor = new THREE.Color();
function updatePreview() {
  const active = aim.power > 0.04;
  dots.visible = band.visible = handle.visible = active;
  if (!active) return;
  const speed = MAX_SPEED[state.mode] * aim.power;
  previewBall.pos.copy(ball.pos);
  if (state.mode === 'chip') previewBall.vel.set(aim.dir.x * speed * Math.cos(CHIP_ANGLE), speed * Math.sin(CHIP_ANGLE), aim.dir.z * speed * Math.cos(CHIP_ANGLE));
  else previewBall.vel.set(aim.dir.x * speed, 0, aim.dir.z * speed);
  previewBall.inBoost = false;

  _dotColor.setHSL((120 - aim.power * 120) / 360, 0.9, 0.6);
  dotMat.color.copy(_dotColor);
  bandMat.color.copy(_dotColor);
  const dt = 1 / 120;
  let n = 0;
  for (let i = 1; i <= PREVIEW_DOTS * 3 && n < PREVIEW_DOTS; i++) {
    stepBall(previewBall, level.world, dt, null);
    if (i % 3 === 0) {
      const s = 1 - n / PREVIEW_DOTS;
      _m4.makeScale(s, s, s).setPosition(previewBall.pos);
      dots.setMatrixAt(n++, _m4);
    }
  }
  dots.count = n;
  dots.instanceMatrix.needsUpdate = true;

  const pull = ball.pos.clone().addScaledVector(aim.dir, -0.5 - aim.power * 2.2);
  handle.position.copy(pull);
  band.position.copy(ball.pos);
  band.lookAt(pull);
  band.scale.set(1, 1, ball.pos.distanceTo(pull));
}

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (e.pointerType === 'touch') touches.add(e.pointerId);
  if (state.phase === 'intro') {
    e.stopImmediatePropagation();
    finishIntro();
    return;
  }
  if (aim) {
    if (touches.size > 1) cancelAim();
    return;
  }
  if (e.button !== 0 || state.phase !== 'ready' || touches.size > 1) return;
  aim = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, power: 0, dir: new THREE.Vector3() };
  state.phase = 'aiming';
  controls.enabled = false;
  hud.power.classList.remove('hidden');
  updateAim();
}, { capture: true });

window.addEventListener('pointermove', (e) => {
  if (aim && e.pointerId === aim.id) updateAim(e.clientX, e.clientY);
});

function endPointer(e) {
  touches.delete(e.pointerId);
  if (!aim || e.pointerId !== aim.id) return;
  const ready = aim.power > 0.04 && state.phase === 'aiming' && e.type === 'pointerup';
  const shot = { dir: aim.dir.clone(), power: aim.power };
  cancelAim();
  if (ready) shoot(shot);
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Escape' && aim) cancelAim();
  if (e.code === 'KeyC' || e.code === 'Space') {
    if (state.phase !== 'title' && state.phase !== 'done') { setMode(state.mode === 'putt' ? 'chip' : 'putt'); sfx.click(); }
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

$('modePutt').addEventListener('click', () => { sfx.unlock(); setMode('putt'); sfx.click(); });
$('modeChip').addEventListener('click', () => { sfx.unlock(); setMode('chip'); sfx.click(); });
$('play').addEventListener('click', () => { sfx.unlock(); startRound(); });
$('again').addEventListener('click', () => { sfx.unlock(); startRound(); });
{
  const btn = $('restart');
  let armedUntil = 0;
  btn.addEventListener('click', () => {
    if (state.phase === 'title' || state.phase === 'done') return;
    sfx.click();
    if (performance.now() < armedUntil) {
      armedUntil = 0;
      btn.classList.remove('armed');
      startRound();
      return;
    }
    armedUntil = performance.now() + 3000;
    btn.classList.add('armed');
    showBanner('Restart round?', 'Tap restart again to go back to hole 1', 3);
    setTimeout(() => { if (performance.now() >= armedUntil) btn.classList.remove('armed'); }, 3050);
  });
}
{
  let muted = false;
  try { muted = localStorage.getItem('slingshot-golf-muted') === '1'; } catch { /* ignore */ }
  const btn = $('mute');
  const apply = () => { sfx.setMuted(muted); btn.classList.toggle('muted', muted); btn.setAttribute('aria-pressed', String(muted)); };
  apply();
  btn.addEventListener('click', () => {
    sfx.unlock();
    muted = !muted;
    try { localStorage.setItem('slingshot-golf-muted', muted ? '1' : '0'); } catch { /* ignore */ }
    apply();
  });
}
{
  const best = readBest();
  if (best != null) $('titleBest').textContent = `Personal best: ${best} strokes`;
}

// ---------- simulation ----------
function handleEvents() {
  for (const ev of events) {
    if (ev.type === 'bumper') {
      sfx.bumper();
      ev.collider.flash = 1;
    } else if (ev.type === 'wall') sfx.bounce(ev.strength);
    else if (ev.type === 'ground') sfx.thud(ev.strength);
    else if (ev.type === 'boost') sfx.boost();
  }
  events.length = 0;
}

function tick(dt) {
  updateMovers(level.world, dt);
  const p = state.phase;
  if (p !== 'ready' && p !== 'aiming' && p !== 'rolling') return;

  stepBall(ball, level.world, dt, events);
  handleEvents();

  const h = level.world.hole;
  const hs = Math.hypot(ball.vel.x, ball.vel.z);
  const hd = Math.hypot(ball.pos.x - h.x, ball.pos.z - h.z);
  if (hd < HOLE_R - 0.04 && Math.abs(ball.pos.y - BALL_R - h.y) < 0.15 && hs < 6) {
    if (aim) cancelAim();
    sinkBall();
    return;
  }
  if (ball.pos.y < WATER_Y + 0.5) {
    if (aim) cancelAim();
    waterHazard();
    return;
  }

  const still = ball.grounded && ball.groundNy > 0.99 && hs < 0.15 && Math.abs(ball.vel.y) < 0.5;
  state.restTime = still ? state.restTime + dt : 0;
  if (state.restTime > 0.25) ball.vel.set(0, 0, 0);

  if (p === 'rolling') {
    state.rollTime += dt;
    if (state.restTime > 0.3 || state.rollTime > 25) onRest();
  } else if (hs > 0.6) {
    // Something (a spinner) knocked the ball while the player was lining up.
    if (aim) cancelAim();
    state.phase = 'rolling';
    state.rollTime = 0;
  }
}

// ---------- camera ----------
const _delta = new THREE.Vector3();
const _off = new THREE.Vector3();
const smooth = (t) => t * t * (3 - 2 * t);
function updateCamera(dt) {
  if (state.phase === 'title') {
    const b = level.bounds.getCenter(new THREE.Vector3());
    const a = state.time * 0.12;
    camera.position.set(b.x + Math.cos(a) * 22, b.y + 13, b.z + Math.sin(a) * 22);
    camera.lookAt(b);
    return;
  }
  if (state.phase === 'intro') {
    state.introT += dt / 2.4;
    const t = smooth(Math.min(state.introT, 1));
    camera.position.lerpVectors(intro.fromPos, intro.toPos, t);
    controls.target.lerpVectors(intro.fromTarget, intro.toTarget, t);
    camera.lookAt(controls.target);
    if (state.introT >= 1) finishIntro();
    return;
  }
  const focus = state.phase === 'sinking' || state.phase === 'between' ? level.world.hole : ball.pos;
  const k = 1 - Math.exp(-5 * dt);
  _delta.copy(focus).sub(controls.target).multiplyScalar(k);
  controls.target.add(_delta);
  camera.position.add(_delta);

  const turn = (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0) - (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0);
  if (turn && !aim) {
    _off.copy(camera.position).sub(controls.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn * 1.8 * dt);
    camera.position.copy(controls.target).add(_off);
  }
  controls.update();
}

// ---------- visuals ----------
function updateVisuals(dt) {
  animateCourse(level, state.time, dt);
  clouds.rotation.y += dt * 0.004;
  updateParticles(dt);

  for (let i = timers.length - 1; i >= 0; i--) {
    timers[i].t -= dt;
    if (timers[i].t <= 0) timers.splice(i, 1)[0].fn();
  }

  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) hud.banner.className = '';
  }

  if (state.phase === 'sinking') {
    state.sinkT += dt;
    const h = level.world.hole;
    const t = Math.min(state.sinkT / 0.3, 1);
    ballMesh.position.set(
      THREE.MathUtils.lerp(sinkFrom.x, h.x, t),
      THREE.MathUtils.lerp(sinkFrom.y, h.y - BALL_R * 1.4, smooth(t)),
      THREE.MathUtils.lerp(sinkFrom.z, h.z, t),
    );
  } else if (state.phase !== 'between') {
    ballMesh.position.copy(ball.pos);
    // Roll the ball visually around the axis perpendicular to its motion.
    const hs = Math.hypot(ball.vel.x, ball.vel.z);
    if (hs > 0.01) {
      _off.set(ball.vel.z, 0, -ball.vel.x).normalize();
      ballMesh.rotateOnWorldAxis(_off, (hs * dt) / BALL_R);
    }
  }
  if (state.phase === 'between') ballMesh.visible = false;

  const showRing = state.phase === 'ready' || state.phase === 'aiming';
  readyRing.visible = showRing;
  if (showRing) {
    readyRing.position.set(ball.pos.x, ball.pos.y - BALL_R + 0.02, ball.pos.z);
    const pulse = state.phase === 'ready' ? 1 + Math.sin(state.time * 5) * 0.12 : 1.1;
    readyRing.scale.setScalar(pulse);
  }
}

// ---------- main loop ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 70 : 55;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let acc = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  state.time += dt;
  acc += dt;
  while (acc >= STEP) {
    acc -= STEP;
    tick(STEP);
  }
  updateVisuals(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

loadLevel(0);
requestAnimationFrame(frame);
