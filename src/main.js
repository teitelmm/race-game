import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LEVELS } from './levels.js';
import { buildLevel, animateCourse, disposeLevel } from './course.js';
import { BALL_R, HOLE_R, makeBall, stepBall, updateMovers } from './physics.js';
import * as sfx from './audio.js';
import {
  loadStyle, saveStyle, colorHex, createBallTexture, createDimpleTexture, createBallMaterial, paintBallTexture, styleMaterial,
} from './ball.js';
import { Trail, Shockwaves, Particles, createAimRing, popup } from './fx.js';
import { createLocker } from './locker.js';

const STEP = 1 / 240;
const MAX_SPEED = { putt: 20, chip: 17 };
const CHIP_ANGLE = 0.7;
const CAPTURE_SPEED = 7;
const MAX_STROKES = 10;
const WATER_Y = -3;
const FULL_PULL = 0.36; // fraction of the shorter screen side for a full-power pull
const PREVIEW_DOTS = 32;
const PREVIEW_DT = 1 / 120;
const PREVIEW_STRIDE = 4;
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

// ---------- the ball ----------
const ballStyle = loadStyle();
const ballTex = createBallTexture(ballStyle);
const ballMat = createBallMaterial(ballTex, createDimpleTexture());
ballMat.envMap = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

// The pivot faces along the ball's travel so it can squash and stretch; the mesh inside rolls.
const ballPivot = new THREE.Group();
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 48, 28), ballMat);
ballMesh.castShadow = true;
ballPivot.add(ballMesh);
const glowLight = new THREE.PointLight(0xffffff, 0, 3, 2);
ballPivot.add(glowLight);
scene.add(ballPivot);

const trail = new Trail();
scene.add(trail.mesh);

function applyBallStyle(changed) {
  if (changed === 'color' || changed === 'pattern') paintBallTexture(ballTex, ballStyle);
  styleMaterial(ballMat, ballStyle);
  trail.setStyle(ballStyle.trail, colorHex(ballStyle));
  glowLight.color.set(colorHex(ballStyle));
  glowLight.intensity = ballStyle.finish === 'glow' ? 4 : 0;
  document.documentElement.style.setProperty('--ball', colorHex(ballStyle));
}
applyBallStyle();

// ---------- aim visuals ----------
const aimRing = createAimRing();
scene.add(aimRing);

const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 10, 8), dotMat, PREVIEW_DOTS);
dots.frustumCulled = false;
dots.visible = false;
scene.add(dots);

const bandMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const band = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8).translate(0, 0.5, 0).rotateX(Math.PI / 2), bandMat);
const handle = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), bandMat);
const landMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.16, 0.26, 36).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }),
);
band.visible = handle.visible = landMarker.visible = false;
scene.add(band, handle, landMarker);

const shockwaves = new Shockwaves(scene);
const particles = new Particles(scene);

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
  session: 'round', // round | practice
  inFlight: false,
  showcaseT: 0,
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
const fx = { shake: 0, fovKick: 0, freeze: 0, squash: 0, squashVel: 0, timeScale: 1, yaw: 0 };
let level = null;
let ball = makeBall(new THREE.Vector3());
let shot = newShot();
let sinkTags = [];
let resume = null;
const lastSafe = new THREE.Vector3();
const events = [];
const timers = [];
let aim = null;
const touches = new Set();
const keys = new Set();
const lastPop = {};

const intro = { fromPos: new THREE.Vector3(), fromTarget: new THREE.Vector3(), toPos: new THREE.Vector3(), toTarget: new THREE.Vector3() };

function newShot(from = new THREE.Vector3()) {
  return { from: from.clone(), walls: 0, bumpers: 0, airTime: 0, lastAir: -10, lipped: false };
}

function later(sec, fn) {
  timers.push({ t: sec, fn });
}

function vibrate(ms) {
  try { navigator.vibrate?.(ms); } catch { /* not allowed here */ }
}

// ---------- HUD ----------
const hud = {
  hole: $('holeNum'), holeTotal: $('holeTotal'), name: $('holeName'), par: $('par'), strokes: $('strokes'),
  total: $('total'), powerTag: $('powerTag'), hint: $('hint'), banner: $('banner'),
  bannerTitle: $('bannerTitle'), bannerSub: $('bannerSub'), bannerTags: $('bannerTags'), pops: $('pops'),
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
function showBanner(title, sub = '', seconds = 1.8, tone = '', tags = []) {
  hud.bannerTitle.textContent = title;
  hud.bannerSub.textContent = sub;
  hud.bannerTags.replaceChildren(...tags.map((t) => Object.assign(document.createElement('span'), { textContent: t })));
  hud.banner.className = `show ${tone}`;
  bannerTimer = seconds;
}

function setHint(text) {
  hud.hint.textContent = text;
  hud.hint.classList.toggle('hidden', !text);
}

const _proj = new THREE.Vector3();
function popAt(text, pos, cls = '', throttleKey = null) {
  if (throttleKey) {
    if (state.time - (lastPop[throttleKey] ?? -10) < 0.5) return;
    lastPop[throttleKey] = state.time;
  }
  _proj.copy(pos).project(camera);
  if (_proj.z > 1) return;
  popup(hud.pops, text, ((_proj.x + 1) / 2) * window.innerWidth, ((1 - _proj.y) / 2) * window.innerHeight - 34, cls);
}

function setMode(mode) {
  state.mode = mode;
  $('modePutt').setAttribute('aria-pressed', String(mode === 'putt'));
  $('modeChip').setAttribute('aria-pressed', String(mode === 'chip'));
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
  shot = newShot(level.tee);
  lastSafe.copy(level.tee);
  ballPivot.visible = true;
  trail.reset();

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
    showBanner(`Hole ${i + 1}`, `${LEVELS[i].name} · Par ${LEVELS[i].par}`, 1.8);
    setHint('');
  }
  updateHud();
}

const MENUS = ['home', 'holes', 'how', 'scorecard', 'practiceCard'];
function showOnly(id) {
  for (const m of MENUS) $(m).classList.toggle('hidden', m !== id);
}

function enterPlay() {
  showOnly(null);
  $('hud').classList.remove('hidden');
  $('dock').classList.remove('hidden');
  state.phase = 'intro';
}

function startRound() {
  state.session = 'round';
  state.scores = [];
  resume = null;
  enterPlay();
  loadLevel(0);
}

function startPractice(i) {
  state.session = 'practice';
  state.scores = [];
  enterPlay();
  loadLevel(i);
}

function goHome() {
  if (aim) cancelAim();
  const playing = ['intro', 'ready', 'aiming', 'rolling', 'penalty'].includes(state.phase);
  // A shot still rolling is taken back so resuming replays it from where it was hit.
  resume = state.session === 'round' && playing
    ? {
      levelIndex: state.levelIndex,
      scores: state.scores.slice(),
      strokes: state.inFlight ? state.strokes - 1 : state.strokes,
      pos: (state.inFlight || state.phase === 'penalty' ? lastSafe : ball.pos).clone(),
      lastSafe: lastSafe.clone(),
    }
    : null;
  state.inFlight = false;
  timers.length = 0;
  state.phase = 'title';
  state.showcaseT = 0;
  if (!resume) loadLevel(state.levelIndex);
  controls.enabled = false;
  setHint('');
  hud.banner.className = '';
  $('hud').classList.add('hidden');
  $('dock').classList.add('hidden');
  renderHome();
  showOnly('home');
}

function resumeRound() {
  const r = resume;
  resume = null;
  state.session = 'round';
  enterPlay();
  loadLevel(r.levelIndex);
  state.scores = r.scores;
  state.strokes = r.strokes;
  ball = makeBall(r.pos);
  lastSafe.copy(r.lastSafe);
  const away = r.pos.clone().sub(level.world.hole).setY(0).normalize();
  intro.toTarget.copy(r.pos);
  intro.toPos.copy(r.pos).addScaledVector(away, 7).add(new THREE.Vector3(0, 4.2, 0));
  updateHud();
}

// ---------- persistent stats ----------
const STATS_KEY = 'slingshot-golf-stats';
function readStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY));
    if (s && Array.isArray(s.holeBest)) return s;
  } catch { /* storage unavailable */ }
  return { holeBest: [], aces: 0, rounds: 0 };
}
function writeStats(s) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
function recordHole(i, strokes) {
  const s = readStats();
  const prev = s.holeBest[i];
  const isBest = prev == null || strokes < prev;
  if (isBest) s.holeBest[i] = strokes;
  if (strokes === 1) s.aces++;
  writeStats(s);
  return { isBest, prev };
}

function renderHome() {
  const s = readStats();
  const best = readBest();
  const par = LEVELS.reduce((a, l) => a + l.par, 0);
  const chips = [];
  if (best != null) chips.push(`Best round <b>${best}</b> (${relToPar(best - par)})`);
  chips.push(`Holes in one <b>${s.aces}</b>`);
  chips.push(`Rounds <b>${s.rounds}</b>`);
  $('homeStats').innerHTML = chips.map((c) => `<span>${c}</span>`).join('');
  $('homePar').textContent = `Par ${par}`;
  const r = resume;
  $('homeResume').classList.toggle('hidden', !r);
  $('homePlay').classList.toggle('primary', !r);
  $('homePlayLabel').textContent = r ? 'New round' : 'Play 9 holes';
  if (r) $('homeResumeSub').textContent = `Hole ${r.levelIndex + 1} · ${r.strokes} stroke${r.strokes === 1 ? '' : 's'}`;
}

function renderHoleSelect() {
  const s = readStats();
  const grid = $('holeGrid');
  grid.replaceChildren(...LEVELS.map((l, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hole-card';
    const best = s.holeBest[i];
    const badge = best === 1 ? '<em class="ace">Ace</em>' : best != null && best < l.par ? '<em>Under</em>' : '';
    b.innerHTML = `<span class="num">${i + 1}</span><span class="name">${l.name}</span>` +
      `<span class="meta">Par ${l.par} · Best ${best ?? '–'}</span>${badge}`;
    b.addEventListener('click', () => { sfx.unlock(); startPractice(i); });
    return b;
  }));
}

function showPracticeCard(title, sub, bestLine) {
  state.phase = 'done';
  $('hud').classList.add('hidden');
  $('dock').classList.add('hidden');
  $('pcTitle').textContent = title;
  $('pcSub').textContent = sub;
  $('pcBest').textContent = bestLine;
  $('pcNext').textContent = `Next: Hole ${((state.levelIndex + 1) % LEVELS.length) + 1}`;
  showOnly('practiceCard');
}

function finishIntro() {
  state.phase = 'rolling';
  state.rollTime = 0;
  camera.position.copy(intro.toPos);
  controls.target.copy(intro.toTarget);
  controls.enabled = true;
}

function onRest() {
  state.inFlight = false;
  if (state.strokes >= MAX_STROKES) {
    state.phase = 'between';
    state.scores[state.levelIndex] = MAX_STROKES;
    showBanner('Picked up', `${MAX_STROKES} strokes max`, 1.6, 'bad');
    updateHud();
    later(1.7, () => {
      if (state.session === 'practice') showPracticeCard('Picked up', `${MAX_STROKES} strokes max`, 'Give it another go');
      else nextLevel();
    });
    return;
  }
  state.phase = 'ready';
  const firstShot = state.strokes === 0 && (state.levelIndex === 0 || state.session === 'practice');
  setHint(firstShot ? 'Drag the ball back to shoot · drag anywhere else to look around' : '');
}

function launchVelocity(out, dir, power, mode) {
  const s = MAX_SPEED[mode] * power;
  if (mode === 'chip') out.set(dir.x * s * Math.cos(CHIP_ANGLE), s * Math.sin(CHIP_ANGLE), dir.z * s * Math.cos(CHIP_ANGLE));
  else out.set(dir.x * s, 0, dir.z * s);
  return out;
}

function shoot({ dir, power }) {
  launchVelocity(ball.vel, dir, power, state.mode);
  lastSafe.copy(ball.pos);
  shot = newShot(ball.pos);
  state.strokes++;
  state.inFlight = true;
  state.phase = 'rolling';
  state.rollTime = 0;
  state.restTime = 0;

  const foot = ball.pos.clone();
  foot.y -= BALL_R - 0.02;
  shockwaves.spawn(foot, 0.8 + power * 1.8);
  particles.burst(foot, Math.round(6 + power * 24), ['#5cc24a', '#8fdc6c', '#e9ffe0'], { speed: 1.2 + power * 3.8, lift: 1.5 + power * 4.5, size: 0.08, life: 1 });
  fx.shake = Math.max(fx.shake, 0.03 + 0.22 * power * power);
  fx.fovKick = 8 * power;
  fx.squashVel -= 3 * power;
  if (power >= 0.995) {
    fx.freeze = 0.07;
    popAt('MAX POWER!', ball.pos, 'hot');
  }
  sfx.hit(power);
  if (power > 0.55) sfx.whoosh(power);
  vibrate(10 + power * 25);
  setHint('');
  updateHud();
}

function waterHazard() {
  state.phase = 'penalty';
  state.inFlight = false;
  sfx.splash();
  const splashAt = new THREE.Vector3(ball.pos.x, WATER_Y + 0.1, ball.pos.z);
  particles.burst(splashAt, 50, ['#bfe6ff', '#ffffff', '#7cc4f5'], { speed: 2.5, lift: 6, size: 0.14 });
  shockwaves.spawn(splashAt, 2.5, 0xdff3ff);
  ballPivot.visible = false;
  trail.reset();
  state.strokes++;
  updateHud();
  showBanner('Splash!', '+1 stroke penalty', 1.2, 'bad');
  later(0.9, () => {
    ball = makeBall(lastSafe);
    ballPivot.visible = true;
    state.phase = 'rolling';
    state.rollTime = 0;
  });
}

const sinkFrom = new THREE.Vector3();
function sinkBall() {
  state.phase = 'sinking';
  state.inFlight = false;
  state.sinkT = 0;
  sinkFrom.copy(ball.pos);
  const h = level.world.hole;
  sinkTags = [];
  if (shot.airTime > 0.2 && state.time - shot.lastAir < 0.2) sinkTags.push('Slam dunk');
  if (shot.bumpers) sinkTags.push(shot.bumpers > 1 ? `${shot.bumpers}× bumper` : 'Bumper shot');
  else if (shot.walls > 1) sinkTags.push(`${shot.walls}× bank shot`);
  else if (shot.walls === 1) sinkTags.push('Bank shot');
  if (Math.hypot(shot.from.x - h.x, shot.from.z - h.z) > 12) sinkTags.push('Long bomb');
  shockwaves.spawn(new THREE.Vector3(h.x, h.y + 0.02, h.z), 1.6, 0xffe066);
  fx.shake = Math.max(fx.shake, 0.08);
  sfx.sink();
  vibrate(30);
  later(0.45, holeResult);
}

const TERMS = { '-4': 'Condor!', '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double Bogey', 3: 'Triple Bogey' };
function holeResult() {
  const def = LEVELS[state.levelIndex];
  const diff = state.strokes - def.par;
  state.scores[state.levelIndex] = state.strokes;
  const record = recordHole(state.levelIndex, state.strokes);
  updateHud();
  const hio = state.strokes === 1;
  const title = hio ? 'HOLE IN ONE!' : TERMS[diff] ?? `+${diff}`;
  const sub = `${state.strokes} stroke${state.strokes === 1 ? '' : 's'} · ${relToPar(diff)}`;
  const great = diff < 0 || hio;
  showBanner(title, sub, 2, great ? 'great' : diff === 0 ? '' : 'bad', sinkTags);
  if (great || sinkTags.length) {
    if (great) sfx.fanfare();
    const h = level.world.hole;
    const n = hio ? 170 : great ? 100 : 45;
    particles.burst(new THREE.Vector3(h.x, h.y + 0.3, h.z), n, ['#ff4d6d', '#ffd23f', '#3bceac', '#4d8bff', '#ffffff'], { speed: 4, lift: 9 });
  }
  state.phase = 'between';
  if (state.session === 'practice') {
    const bestLine = record.isBest
      ? (record.prev == null ? 'First clear of this hole' : `New best! Was ${record.prev}`)
      : `Your best: ${record.prev}`;
    later(2.1, () => showPracticeCard(title, sub, bestLine));
  } else {
    later(2.1, nextLevel);
  }
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
  const stats = readStats();
  stats.rounds++;
  writeStats(stats);
  resume = null;
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
  showOnly('scorecard');
  $('hud').classList.add('hidden');
  $('dock').classList.add('hidden');
  if (isBest) sfx.fanfare();
}

// ---------- aiming ----------
const _fwd = new THREE.Vector3();
const powerColor = new THREE.Color();
function updateAim(x = aim.x, y = aim.y) {
  aim.x = x;
  aim.y = y;
  const dx = x - aim.sx, dy = y - aim.sy;
  const len = Math.hypot(dx, dy);
  const full = Math.min(window.innerWidth, window.innerHeight) * FULL_PULL;
  const prev = aim.power;
  const raw = len / full;
  aim.power = raw >= 0.98 ? 1 : raw;
  camera.getWorldDirection(_fwd).setY(0).normalize();
  if (len > 1) {
    // Pulling toward the viewer shoots away from them; pulling left shoots right.
    aim.dir.set(_fwd.x * dy + _fwd.z * dx, 0, _fwd.z * dy - _fwd.x * dx).normalize();
  }
  if (aim.power >= 1 && prev < 1) {
    sfx.maxPower();
    vibrate(15);
  }
  sfx.chargeSet(aim.power);
  powerColor.setHSL((120 - aim.power * 120) / 360, 0.9, 0.55);

  const tag = hud.powerTag;
  const max = aim.power >= 1;
  tag.textContent = max ? 'MAX' : `${Math.round(aim.power * 100)}%`;
  tag.classList.toggle('max', max);
  tag.classList.toggle('hidden', aim.power < 0.04);
  // Sit beside the finger, on whichever side has room, so it never covers the ball.
  const side = x + 70 < window.innerWidth - 16 ? 60 : -60;
  tag.style.left = `${x + side}px`;
  tag.style.top = `${Math.max(40, y - 44)}px`;
  tag.style.setProperty('--power', `#${powerColor.getHexString()}`);
  updatePreview();
}

function cancelAim() {
  aim = null;
  if (state.phase === 'aiming') state.phase = 'ready';
  controls.enabled = true;
  dots.visible = band.visible = handle.visible = landMarker.visible = false;
  hud.powerTag.classList.add('hidden');
  sfx.chargeStop();
}

const previewBall = makeBall(new THREE.Vector3());
const _m4 = new THREE.Matrix4();
function updatePreview() {
  const active = aim.power > 0.04;
  dots.visible = band.visible = handle.visible = active;
  landMarker.visible = false;
  aimRing.material.uniforms.uPower.value = active ? aim.power : 0;
  aimRing.material.uniforms.uColor.value.copy(powerColor);
  aimRing.material.uniforms.uAngle.value = Math.atan2(aim.dir.z, -aim.dir.x);
  if (!active) return;

  previewBall.pos.copy(ball.pos);
  launchVelocity(previewBall.vel, aim.dir, aim.power, state.mode);
  previewBall.inBoost = false;
  previewBall.grounded = false;
  dotMat.color.copy(powerColor);
  bandMat.color.copy(powerColor);

  let n = 0, airborne = 0, landed = false;
  for (let i = 1; i <= PREVIEW_DOTS * PREVIEW_STRIDE && n < PREVIEW_DOTS; i++) {
    stepBall(previewBall, level.world, PREVIEW_DT, null);
    if (!previewBall.grounded) airborne += PREVIEW_DT;
    else if (!landed && airborne > 0.1) {
      landed = true;
      landMarker.visible = true;
      landMarker.position.set(previewBall.pos.x, previewBall.pos.y - BALL_R + 0.02, previewBall.pos.z);
    }
    if (i % PREVIEW_STRIDE === 0) {
      const s = 1 - (n / PREVIEW_DOTS) * 0.7;
      _m4.makeScale(s, s, s).setPosition(previewBall.pos);
      dots.setMatrixAt(n++, _m4);
    }
  }
  dots.count = n;
  dots.instanceMatrix.needsUpdate = true;

  const pull = ball.pos.clone().addScaledVector(aim.dir, -0.5 - aim.power * 2.4);
  handle.position.copy(pull);
  band.position.copy(ball.pos);
  band.lookAt(pull);
  const thick = 1.6 - aim.power * 0.9;
  band.scale.set(thick, thick, ball.pos.distanceTo(pull));
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
  // Only a press on the ball starts a shot; anything else falls through to the camera controls.
  if (!overBall(e.clientX, e.clientY, e.pointerType === 'touch')) return;
  e.stopImmediatePropagation();
  aim = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, power: 0, dir: new THREE.Vector3() };
  state.phase = 'aiming';
  controls.enabled = false;
  canvas.style.cursor = 'grabbing';
  sfx.chargeStart();
  updateAim();
}, { capture: true });

const _ballPx = new THREE.Vector3();
const _edgePx = new THREE.Vector3();
const _right = new THREE.Vector3();
function overBall(x, y, touch) {
  _ballPx.copy(ball.pos).project(camera);
  if (_ballPx.z > 1) return false;
  _right.setFromMatrixColumn(camera.matrixWorld, 0);
  _edgePx.copy(ball.pos).addScaledVector(_right, BALL_R).project(camera);
  const w = window.innerWidth / 2, h = window.innerHeight / 2;
  const bx = (_ballPx.x + 1) * w, by = (1 - _ballPx.y) * h;
  const r = Math.abs(_edgePx.x - _ballPx.x) * w;
  // Generous grab zone: the ball is small on screen, fingers are not.
  const grab = Math.max(touch ? 56 : 40, r * 3);
  return Math.hypot(x - bx, y - by) <= grab;
}

window.addEventListener('pointermove', (e) => {
  if (aim && e.pointerId === aim.id) updateAim(e.clientX, e.clientY);
  else if (e.pointerType === 'mouse' && e.target === canvas && !e.buttons) {
    const hover = state.phase === 'ready' && overBall(e.clientX, e.clientY, false);
    canvas.style.cursor = hover ? 'grab' : '';
  }
});

function endPointer(e) {
  touches.delete(e.pointerId);
  if (!aim || e.pointerId !== aim.id) return;
  const fire = aim.power > 0.04 && state.phase === 'aiming' && e.type === 'pointerup';
  const s = { dir: aim.dir.clone(), power: aim.power };
  cancelAim();
  canvas.style.cursor = '';
  if (fire) shoot(s);
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.repeat || locker.isOpen) return;
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
const onClick = (id, fn) => $(id).addEventListener('click', () => { sfx.unlock(); sfx.click(); fn(); });
onClick('homePlay', startRound);
onClick('homeResume', resumeRound);
onClick('homePractice', () => { renderHoleSelect(); showOnly('holes'); });
onClick('homeHow', () => showOnly('how'));
onClick('holesBack', () => showOnly('home'));
onClick('howBack', () => showOnly('home'));
onClick('again', startRound);
onClick('cardHome', goHome);
onClick('homeBtn', goHome);
onClick('pcRetry', () => startPractice(state.levelIndex));
onClick('pcNext', () => startPractice((state.levelIndex + 1) % LEVELS.length));
onClick('pcHome', goHome);
{
  const btn = $('restart');
  let armedUntil = 0;
  btn.addEventListener('click', () => {
    if (state.phase === 'title' || state.phase === 'done') return;
    sfx.click();
    const practice = state.session === 'practice';
    if (performance.now() < armedUntil) {
      armedUntil = 0;
      btn.classList.remove('armed');
      if (practice) startPractice(state.levelIndex);
      else startRound();
      return;
    }
    armedUntil = performance.now() + 3000;
    btn.classList.add('armed');
    showBanner(practice ? 'Restart hole?' : 'Restart round?', `Tap restart again to go back to ${practice ? 'the tee' : 'hole 1'}`, 3);
    setTimeout(() => { if (performance.now() >= armedUntil) btn.classList.remove('armed'); }, 3050);
  });
}
{
  let muted = false;
  try { muted = localStorage.getItem('slingshot-golf-muted') === '1'; } catch { /* ignore */ }
  const btns = document.querySelectorAll('.mute-btn');
  const apply = () => {
    sfx.setMuted(muted);
    btns.forEach((b) => { b.classList.toggle('muted', muted); b.setAttribute('aria-pressed', String(muted)); });
  };
  apply();
  btns.forEach((b) => b.addEventListener('click', () => {
    sfx.unlock();
    muted = !muted;
    try { localStorage.setItem('slingshot-golf-muted', muted ? '1' : '0'); } catch { /* ignore */ }
    apply();
  }));
}

const locker = createLocker({
  style: ballStyle,
  material: ballMat,
  onChange: (style, key) => {
    applyBallStyle(key);
    saveStyle(style);
    sfx.click();
  },
  onOpen: () => { if (aim) cancelAim(); },
});
for (const id of ['ballBtn', 'homeShop']) {
  $(id).addEventListener('click', () => { sfx.unlock(); locker.show(); });
}

// ---------- simulation ----------
function handleEvents() {
  for (const ev of events) {
    if (ev.type === 'bumper') {
      shot.bumpers++;
      ev.collider.flash = 1;
      sfx.bumper();
      fx.shake = Math.max(fx.shake, 0.07);
      particles.burst(ball.pos, 8, ['#ff4d6d', '#ffffff'], { speed: 3, lift: 2, size: 0.07, life: 0.6 });
      popAt('Boing!', ball.pos, 'boing', 'bumper');
    } else if (ev.type === 'wall') {
      if (ev.strength > 2) shot.walls++;
      sfx.bounce(ev.strength);
      if (ev.strength > 6) {
        fx.shake = Math.max(fx.shake, Math.min(0.12, ev.strength * 0.008));
        particles.burst(ball.pos, 5, ['#ffffff', '#fff3b0'], { speed: 2.5, lift: 1.5, size: 0.06, life: 0.5 });
      }
    } else if (ev.type === 'ground') {
      sfx.thud(ev.strength);
      fx.squashVel += Math.min(4, ev.strength * 0.3);
      if (ev.strength > 6) {
        const foot = ball.pos.clone();
        foot.y -= BALL_R;
        particles.burst(foot, 8, ['#5cc24a', '#9be27f'], { speed: 1.8, lift: 2, size: 0.07, life: 0.7 });
        shockwaves.spawn(foot, 0.6 + ev.strength * 0.06);
      }
    } else if (ev.type === 'boost') {
      sfx.boost();
      popAt('Boost!', ball.pos, 'boost', 'boost');
    }
  }
  events.length = 0;
}

function tick(dt) {
  updateMovers(level.world, dt);
  const p = state.phase;
  if (p !== 'ready' && p !== 'aiming' && p !== 'rolling') return;

  stepBall(ball, level.world, dt, events);
  if (!ball.grounded) {
    shot.airTime += dt;
    shot.lastAir = state.time;
  }
  handleEvents();

  const h = level.world.hole;
  const hs = Math.hypot(ball.vel.x, ball.vel.z);
  const hd = Math.hypot(ball.pos.x - h.x, ball.pos.z - h.z);
  const atCupHeight = Math.abs(ball.pos.y - BALL_R - h.y) < 0.15;
  if (hd < HOLE_R - 0.04 && atCupHeight) {
    if (hs < CAPTURE_SPEED) {
      if (aim) cancelAim();
      sinkBall();
      return;
    }
    if (!shot.lipped && p === 'rolling') {
      shot.lipped = true;
      sfx.lipOut();
      popAt('Too hot!', ball.pos, 'hot');
    }
  }
  if (ball.pos.y < WATER_Y + 0.5) {
    if (aim) cancelAim();
    waterHazard();
    return;
  }

  const still = ball.grounded && ball.groundNy > 0.99 && hs < 0.15 && Math.abs(ball.vel.y) < 0.5;
  state.restTime = still ? state.restTime + dt : 0;
  if (state.restTime > 0.15) ball.vel.set(0, 0, 0);

  if (p === 'rolling') {
    state.rollTime += dt;
    if (state.restTime > 0.2 || state.rollTime > 25) onRest();
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
const _focus = new THREE.Vector3();
const _shake = new THREE.Vector3();
const smooth = (t) => t * t * (3 - 2 * t);
let baseFov = 55;

function updateCamera(dt) {
  camera.position.sub(_shake);
  _shake.set(0, 0, 0);

  const w = window.innerWidth, h = window.innerHeight;
  if (state.phase === 'title') {
    // Home screen: slow orbit, cycling through the course unless a round is waiting to resume.
    state.showcaseT += dt;
    if (!resume && state.showcaseT > 9) {
      state.showcaseT = 0;
      loadLevel((state.levelIndex + 1) % LEVELS.length);
    }
    const b = level.bounds.getCenter(new THREE.Vector3());
    const size = level.bounds.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z);
    const a = state.time * 0.1;
    const r = span * 0.75 + 9;
    camera.position.set(b.x + Math.cos(a) * r, b.y + span * 0.4 + 6, b.z + Math.sin(a) * r);
    camera.lookAt(b);
    // Shift the course to the right of the menu on wide screens.
    if (w > 820) camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else camera.clearViewOffset();
    return;
  }
  if (camera.view?.enabled) camera.clearViewOffset();
  if (state.phase === 'intro') {
    state.introT += dt / 1.8;
    const t = smooth(Math.min(state.introT, 1));
    camera.position.lerpVectors(intro.fromPos, intro.toPos, t);
    controls.target.lerpVectors(intro.fromTarget, intro.toTarget, t);
    camera.lookAt(controls.target);
    if (state.introT >= 1) finishIntro();
    return;
  }

  const hs = Math.hypot(ball.vel.x, ball.vel.z);
  if (state.phase === 'sinking' || state.phase === 'between') _focus.copy(level.world.hole);
  else {
    // Lead the ball a little so fast shots read as fast instead of the world sliding under a pinned ball.
    _focus.copy(ball.pos);
    if (state.phase === 'rolling') {
      _off.set(ball.vel.x, 0, ball.vel.z).multiplyScalar(0.18);
      if (_off.length() > 2.5) _off.setLength(2.5);
      _focus.add(_off);
    }
  }
  const k = 1 - Math.exp(-3.2 * dt);
  _delta.copy(_focus).sub(controls.target).multiplyScalar(k);
  controls.target.add(_delta);
  camera.position.add(_delta);

  const turn = (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0) - (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0);
  if (turn && !aim) {
    _off.copy(camera.position).sub(controls.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn * 1.8 * dt);
    camera.position.copy(controls.target).add(_off);
  }
  controls.update();

  fx.fovKick *= Math.exp(-5 * dt);
  const fovTarget = baseFov + Math.min(9, state.phase === 'rolling' ? hs * 0.45 : 0) + fx.fovKick;
  camera.fov += (fovTarget - camera.fov) * (1 - Math.exp(-6 * dt));
  camera.updateProjectionMatrix();

  if (fx.shake > 0.001) {
    _shake.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(fx.shake * 2);
    camera.position.add(_shake);
  }
  fx.shake *= Math.exp(-9 * dt);
}

// ---------- visuals ----------
const _axis = new THREE.Vector3(1, 0, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

function updateBallVisual(dt) {
  if (state.phase === 'sinking') {
    state.sinkT += dt;
    const h = level.world.hole;
    const t = Math.min(state.sinkT / 0.28, 1);
    ballPivot.position.set(
      THREE.MathUtils.lerp(sinkFrom.x, h.x, t),
      THREE.MathUtils.lerp(sinkFrom.y, h.y - BALL_R * 1.4, smooth(t)),
      THREE.MathUtils.lerp(sinkFrom.z, h.z, t),
    );
    ballPivot.scale.setScalar(1);
    return;
  }
  if (state.phase === 'between') {
    ballPivot.visible = false;
    return;
  }
  ballPivot.position.copy(ball.pos);
  const hs = Math.hypot(ball.vel.x, ball.vel.z);
  if (hs > 0.05) {
    const yaw = Math.atan2(ball.vel.x, ball.vel.z);
    // Keep the ball's pattern fixed in the world when the pivot turns to a new heading.
    _q.setFromAxisAngle(_yAxis, fx.yaw - yaw);
    ballMesh.quaternion.premultiply(_q);
    fx.yaw = yaw;
    ballPivot.rotation.set(0, yaw, 0);
    if (ball.grounded) ballMesh.quaternion.premultiply(_q.setFromAxisAngle(_axis, (hs * dt) / BALL_R));
  }

  fx.squashVel += (-320 * fx.squash - 14 * fx.squashVel) * dt;
  fx.squash = THREE.MathUtils.clamp(fx.squash + fx.squashVel * dt, -0.3, 0.35);
  const stretch = Math.min(0.2, Math.hypot(hs, ball.grounded ? 0 : ball.vel.y) * 0.008);
  const side = 1 / Math.sqrt(1 + stretch);
  ballPivot.scale.set(side * (1 + fx.squash * 0.45), side * (1 - fx.squash), (1 + stretch) * (1 + fx.squash * 0.45));
}

function updateVisuals(dt) {
  animateCourse(level, state.time, dt);
  clouds.rotation.y += dt * 0.004;
  particles.update(dt);
  shockwaves.update(dt);

  for (let i = timers.length - 1; i >= 0; i--) {
    timers[i].t -= dt;
    if (timers[i].t <= 0) timers.splice(i, 1)[0].fn();
  }

  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) hud.banner.className = '';
  }

  updateBallVisual(dt);
  const moving = state.phase === 'rolling' ? ball.vel.length() : 0;
  trail.update(ball.pos, moving, camera, dt, state.time);

  const showRing = state.phase === 'ready' || state.phase === 'aiming';
  aimRing.visible = showRing;
  if (showRing) {
    aimRing.position.set(ball.pos.x, ball.pos.y - BALL_R + 0.02, ball.pos.z);
    const u = aimRing.material.uniforms;
    if (state.phase === 'ready') {
      u.uPower.value = 0;
      u.uMax.value = 0;
      aimRing.scale.setScalar(1 + Math.sin(state.time * 5) * 0.08);
    } else {
      const p = u.uPower.value;
      u.uMax.value = p >= 1 ? 0.5 + 0.5 * Math.sin(state.time * 30) : 0;
      aimRing.scale.setScalar(1 + p * 0.25);
    }
  }
  if (landMarker.visible) landMarker.scale.setScalar(1 + Math.sin(state.time * 8) * 0.12);
}

// ---------- main loop ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  baseFov = w < h ? 70 : 55;
  camera.fov = baseFov;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let acc = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  state.time += dt;

  // A touch of slow motion when the ball is about to reach the cup.
  let slow = 1;
  if (state.phase === 'rolling') {
    const h = level.world.hole;
    const hd = Math.hypot(ball.pos.x - h.x, ball.pos.z - h.z);
    const hs = Math.hypot(ball.vel.x, ball.vel.z);
    if (hd < 1.4 && hs > 0.6 && Math.abs(ball.pos.y - BALL_R - h.y) < 0.4) slow = 0.5;
  }
  fx.timeScale += (slow - fx.timeScale) * Math.min(1, dt * 10);

  if (fx.freeze > 0) fx.freeze -= dt;
  else {
    acc += dt * fx.timeScale;
    while (acc >= STEP) {
      acc -= STEP;
      tick(STEP);
    }
  }
  updateVisuals(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

loadLevel(0);
renderHome();
showOnly('home');
requestAnimationFrame(frame);
