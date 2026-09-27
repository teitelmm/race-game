import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { COLORS, PATTERNS, FINISHES, TRAILS, drawThumb, styleMaterial } from './ball.js';

export function createLocker({ style, material, onChange, onOpen, onClose }) {
  const $ = (id) => document.getElementById(id);
  const root = $('locker');
  const canvas = $('lockerPreview');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
  camera.position.set(0, 0.25, 1.6);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-1, 1.5, 1.5);
  scene.add(key);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const previewMat = material.clone();
  previewMat.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 64, 40), previewMat);
  scene.add(ball);

  const swatches = $('lockerColors');
  const patterns = $('lockerPatterns');
  const finishes = $('lockerFinish');
  const trails = $('lockerTrail');

  const makeButton = (parent, cls, label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  };

  const colorBtns = COLORS.map((c) => {
    const b = makeButton(swatches, 'swatch', c.name, () => set('color', c.id));
    b.style.setProperty('--swatch', c.hex);
    b.dataset.id = c.id;
    return b;
  });

  const patternBtns = PATTERNS.map((p) => {
    const b = makeButton(patterns, 'pattern', p.name, () => set('pattern', p.id));
    const cv = document.createElement('canvas');
    cv.width = cv.height = 72;
    const label = document.createElement('span');
    label.textContent = p.name;
    b.append(cv, label);
    b.dataset.id = p.id;
    return b;
  });

  const segButtons = (parent, list, keyName) => list.map((it) => {
    const b = makeButton(parent, '', it.name, () => set(keyName, it.id));
    b.textContent = it.name;
    b.dataset.id = it.id;
    return b;
  });
  const finishBtns = segButtons(finishes, FINISHES, 'finish');
  const trailBtns = segButtons(trails, TRAILS, 'trail');

  function refresh() {
    const mark = (btns, id) => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    mark(colorBtns, style.color);
    mark(patternBtns, style.pattern);
    mark(finishBtns, style.finish);
    mark(trailBtns, style.trail);
    patternBtns.forEach((b) => drawThumb(b.querySelector('canvas'), { ...style, pattern: b.dataset.id }));
    $('lockerName').textContent = `${COLORS.find((c) => c.id === style.color).name} ${PATTERNS.find((p) => p.id === style.pattern).name}`;
    styleMaterial(previewMat, style);
  }

  function set(keyName, value) {
    if (style[keyName] === value) return;
    style[keyName] = value;
    onChange(style, keyName);
    refresh();
  }

  let open = false;
  let raf = 0;
  const clock = new THREE.Clock();
  function loop() {
    if (!open) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    ball.rotation.y += dt * 0.9;
    ball.rotation.x = Math.sin(clock.elapsedTime * 0.7) * 0.25;
    const size = canvas.clientWidth;
    if (size && canvas.width !== Math.round(size * renderer.getPixelRatio())) {
      renderer.setSize(size, size, false);
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }

  function show() {
    open = true;
    root.classList.remove('hidden');
    refresh();
    clock.getDelta();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    onOpen?.();
    $('lockerDone').focus({ preventScroll: true });
  }

  function hide() {
    open = false;
    cancelAnimationFrame(raf);
    root.classList.add('hidden');
    onClose?.();
  }

  $('lockerDone').addEventListener('click', hide);
  root.addEventListener('click', (e) => { if (e.target === root) hide(); });
  window.addEventListener('keydown', (e) => { if (open && e.code === 'Escape') hide(); });

  return { show, hide, get isOpen() { return open; } };
}
