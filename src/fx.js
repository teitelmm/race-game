import * as THREE from 'three';
import { BALL_R } from './physics.js';

// ---------- ribbon trail ----------
const TRAIL_LIFE = 0.42;

export class Trail {
  constructor(max = 56) {
    this.max = max;
    this.points = [];
    this.mode = 'color';
    this.color = new THREE.Color();
    this.positions = new Float32Array(max * 2 * 3);
    this.colors = new Float32Array(max * 2 * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < max - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this._side = new THREE.Vector3();
    this._tan = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  setStyle(mode, hex) {
    this.mode = mode;
    this.color.set(hex);
    // A white trail vanishes against the sky; tint it slightly.
    if (this.color.getHSL({}).l > 0.85) this.color.set('#bfe3ff');
  }

  reset() {
    this.points.length = 0;
  }

  update(pos, speed, camera, dt, time) {
    const pts = this.points;
    for (const p of pts) p.age += dt;
    while (pts.length && pts[pts.length - 1].age > TRAIL_LIFE) pts.pop();
    if (this.mode !== 'none' && speed > 1.2) {
      pts.unshift({ pos: pos.clone(), age: 0, speed });
      if (pts.length > this.max) pts.length = this.max;
    }
    const n = pts.length;
    const geo = this.mesh.geometry;
    if (n < 2 || this.mode === 'none') { geo.setDrawRange(0, 0); return; }

    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)].pos, b = pts[Math.min(n - 1, i + 1)].pos;
      this._tan.subVectors(a, b);
      this._view.subVectors(camera.position, p.pos);
      this._side.crossVectors(this._tan, this._view).normalize();
      const k = i / (n - 1);
      const life = 1 - p.age / TRAIL_LIFE;
      const w = BALL_R * 0.95 * (1 - k * 0.85) * Math.min(1, p.speed / 5);
      this.positions.set([
        p.pos.x + this._side.x * w, p.pos.y + this._side.y * w, p.pos.z + this._side.z * w,
        p.pos.x - this._side.x * w, p.pos.y - this._side.y * w, p.pos.z - this._side.z * w,
      ], i * 6);
      const c = this._c;
      if (this.mode === 'rainbow') c.setHSL((time * 0.6 + k * 0.9) % 1, 0.95, 0.6);
      else if (this.mode === 'fire') c.setHSL(0.14 - k * 0.14, 1, 0.62 - k * 0.2);
      else c.copy(this.color);
      const alpha = Math.max(0, life) * (1 - k) * 0.9;
      this.colors.set([c.r, c.g, c.b, alpha, c.r, c.g, c.b, alpha], i * 8);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
  }
}

// ---------- expanding ground rings ----------
export class Shockwaves {
  constructor(scene) {
    this.items = [];
    const geo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      this.items.push({ mesh: m, t: 1, size: 1 });
    }
    this.next = 0;
  }

  spawn(pos, size, color = 0xffffff) {
    const it = this.items[this.next++ % this.items.length];
    it.t = 0;
    it.size = size;
    it.mesh.position.copy(pos);
    it.mesh.material.color.set(color);
    it.mesh.visible = true;
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.t += dt / 0.4;
      if (it.t >= 1) { it.mesh.visible = false; continue; }
      const e = 1 - (1 - it.t) ** 3;
      it.mesh.scale.setScalar(0.25 + e * it.size);
      it.mesh.material.opacity = (1 - it.t) * 0.9;
    }
  }
}

// ---------- confetti / grass / splash bits ----------
export class Particles {
  constructor(scene, max = 320) {
    this.max = max;
    this.list = [];
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 0.65),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      max,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  burst(pos, count, colors, { speed = 4, lift = 6, size = 0.14, gravity = 9, life = 2 } = {}) {
    for (let i = 0; i < count && this.list.length < this.max; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.list.push({
        pos: pos.clone(),
        vel: new THREE.Vector3(Math.cos(a) * s, lift * (0.5 + Math.random() * 0.8), Math.sin(a) * s),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0),
        spin: (Math.random() - 0.5) * 14,
        life: life * (0.6 + Math.random() * 0.6),
        size: size * (0.7 + Math.random() * 0.6),
        gravity,
        color: this._c.set(colors[i % colors.length]).clone(),
      });
    }
  }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L.splice(i, 1); continue; }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(1 - dt * 0.9);
      p.pos.addScaledVector(p.vel, dt);
      p.rot.x += p.spin * dt;
      p.rot.y += p.spin * 0.7 * dt;
    }
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      const s = p.size * Math.min(1, p.life * 3);
      this._q.setFromEuler(p.rot);
      this._m.compose(p.pos, this._q, this._s.set(s, s, s));
      this.mesh.setMatrixAt(i, this._m);
      this.mesh.setColorAt(i, p.color);
    }
    this.mesh.count = L.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------- power ring drawn on the ground around the ball ----------
export function createAimRing() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uPower: { value: 0 },
      uAngle: { value: 0 },
      uColor: { value: new THREE.Color(0xffffff) },
      uOpacity: { value: 1 },
      uMax: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uPower, uAngle, uOpacity, uMax;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv - 0.5;
        float a = atan(p.y, p.x);
        float d = abs(mod(a - uAngle + 3.14159265, 6.2831853) - 3.14159265);
        float fill = step(d, uPower * 3.14159265 + 0.0001);
        vec3 col = mix(vec3(1.0), uColor, fill);
        col = mix(col, vec3(1.0), uMax * 0.35);
        float alpha = mix(0.35, 0.95, fill) * uOpacity;
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.5, 72).rotateX(-Math.PI / 2), mat);
  mesh.renderOrder = 1;
  return mesh;
}

// ---------- floating text ----------
export function popup(container, text, x, y, cls = '') {
  const el = document.createElement('div');
  el.className = `pop ${cls}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  container.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}
