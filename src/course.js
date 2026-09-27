import * as THREE from 'three';
import { BALL_R, HOLE_R, makeBox, makeCylinder } from './physics.js';

const THICK = 0.6;

let mats = null;

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function materials() {
  if (mats) return mats;
  const grass = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#5cc24a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#4fb33f';
    g.fillRect(0, 0, w, h / 2);
  });
  const chevron = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#ff8a1f';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff3a8';
    g.lineWidth = 9;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(10, 44);
    g.lineTo(32, 20);
    g.lineTo(54, 44);
    g.stroke();
  });
  chevron.repeat.set(1, 2);
  mats = {
    grass: new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 }),
    dirt: new THREE.MeshStandardMaterial({ color: 0x8a5d3b, roughness: 1 }),
    fence: new THREE.MeshStandardMaterial({ color: 0xf6f1e7, roughness: 0.6 }),
    bumper: new THREE.MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.35, emissive: 0x551020 }),
    bumperTop: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }),
    spinner: new THREE.MeshStandardMaterial({ color: 0xffb400, roughness: 0.45 }),
    hub: new THREE.MeshStandardMaterial({ color: 0x3a3f58, roughness: 0.5 }),
    sand: new THREE.MeshStandardMaterial({ color: 0xecd49a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }),
    boost: new THREE.MeshStandardMaterial({ map: chevron, emissive: 0x7a3000, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1 }),
    cup: new THREE.MeshBasicMaterial({ color: 0x0b0d12, polygonOffset: true, polygonOffsetFactor: -2 }),
    cupRim: new THREE.MeshStandardMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2 }),
    pole: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xff3b3b, side: THREE.DoubleSide, roughness: 0.8 }),
    chevronTex: chevron,
  };
  return mats;
}

// Stripe the top face in world-ish units so every platform mows the same way.
function stripeUVs(geo) {
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 2, pos.getZ(i) / 2);
  uv.needsUpdate = true;
}

function slab(ctx, w, len, pos, quat) {
  const m = materials();
  const geo = new THREE.BoxGeometry(w, THICK, len);
  stripeUVs(geo);
  const mesh = new THREE.Mesh(geo, [m.dirt, m.dirt, m.grass, m.dirt, m.dirt, m.dirt]);
  mesh.position.copy(pos);
  mesh.quaternion.copy(quat);
  mesh.receiveShadow = true;
  ctx.group.add(mesh);
  ctx.colliders.push(makeBox({ pos: pos.clone(), quat, half: new THREE.Vector3(w / 2, THICK / 2, len / 2), bounce: 0.25 }));
}

const builders = {
  plat(ctx, p) {
    slab(ctx, p.w, p.d, new THREE.Vector3(p.x, p.y - THICK / 2, p.z), new THREE.Quaternion());
  },

  rampZ(ctx, p) {
    const k = (p.y1 - p.y0) / (p.z1 - p.z0);
    const theta = Math.atan(-k);
    const len = Math.abs(p.z1 - p.z0) * Math.sqrt(1 + k * k);
    const n = new THREE.Vector3(0, Math.cos(theta), Math.sin(theta));
    const pos = new THREE.Vector3(p.x, (p.y0 + p.y1) / 2, (p.z0 + p.z1) / 2).addScaledVector(n, -THICK / 2);
    slab(ctx, p.w, len, pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(theta, 0, 0)));
  },

  fence(ctx, p) {
    const a = new THREE.Vector3(...p.a), b = new THREE.Vector3(...p.b);
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
    const right = new THREE.Vector3().crossVectors(up, dir);
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, dir));
    const pos = a.clone().add(b).multiplyScalar(0.5).addScaledVector(up, p.h / 2);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, p.h, len + 0.3), materials().fence);
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    mesh.castShadow = mesh.receiveShadow = true;
    ctx.group.add(mesh);
    ctx.colliders.push(makeBox({ pos, quat, half: new THREE.Vector3(0.15, p.h / 2, len / 2 + 0.15), bounce: 0.65, kind: 'wall' }));
  },

  bumper(ctx, p) {
    const m = materials();
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 1.08, 0.6, 28), m.bumper);
    body.position.y = 0.3;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.6, p.r * 0.6, 0.64, 20), m.bumperTop);
    cap.position.y = 0.3;
    body.castShadow = cap.castShadow = true;
    g.add(body, cap);
    g.position.set(p.x, p.y, p.z);
    ctx.group.add(g);
    const c = makeCylinder({ pos: new THREE.Vector3(p.x, p.y, p.z), radius: p.r, height: 0.6, bounce: 0.9, kick: 3.5 });
    c.mesh = g;
    c.flash = 0;
    ctx.colliders.push(c);
    ctx.bumpers.push(c);
  },

  spinner(ctx, p) {
    const m = materials();
    const pos = new THREE.Vector3(p.x, p.y + 0.3, p.z);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(p.len, 0.4, 0.3), m.spinner);
    blade.position.copy(pos);
    blade.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 20), m.hub);
    hub.position.set(p.x, p.y + 0.35, p.z);
    hub.castShadow = true;
    ctx.group.add(blade, hub);
    const c = makeBox({ pos, half: new THREE.Vector3(p.len / 2, 0.2, 0.15), bounce: 0.5, kind: 'wall', spin: p.speed });
    c.mesh = blade;
    ctx.colliders.push(c);
    ctx.colliders.push(makeCylinder({ pos: new THREE.Vector3(p.x, p.y, p.z), radius: 0.28, height: 0.7, bounce: 0.5, kind: 'wall' }));
    ctx.spinners.push(c);
  },

  sand(ctx, p) {
    const geo = new THREE.PlaneGeometry(p.w, p.d).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, materials().sand);
    mesh.position.set(p.x, p.y + 0.004, p.z);
    mesh.receiveShadow = true;
    ctx.group.add(mesh);
    ctx.triggers.push({ kind: 'sand', x: p.x, y: p.y, z: p.z, ax: 1, az: 0, hl: p.w / 2, hw: p.d / 2 });
  },

  boost(ctx, p) {
    const [dx, dz] = p.dir;
    const l = Math.hypot(dx, dz);
    const ax = dx / l, az = dz / l;
    const w = 1.6, d = 2.6;
    const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, materials().boost);
    mesh.position.set(p.x, p.y + 0.004, p.z);
    mesh.rotation.y = Math.atan2(-ax, -az);
    mesh.receiveShadow = true;
    ctx.group.add(mesh);
    ctx.triggers.push({ kind: 'boost', x: p.x, y: p.y, z: p.z, ax, az, hl: d / 2, hw: w / 2, power: p.power });
  },
};

function buildFlag(ctx, hole) {
  const m = materials();
  const cup = new THREE.Mesh(new THREE.CircleGeometry(HOLE_R, 32).rotateX(-Math.PI / 2), m.cup);
  cup.position.set(hole.x, hole.y + 0.003, hole.z);
  const rimMesh = new THREE.Mesh(new THREE.RingGeometry(HOLE_R, HOLE_R + 0.05, 32).rotateX(-Math.PI / 2), m.cupRim);
  rimMesh.position.copy(cup.position);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 8), m.pole);
  pole.position.set(hole.x, hole.y + 1.2, hole.z);
  pole.castShadow = true;
  const clothGeo = new THREE.PlaneGeometry(0.9, 0.55, 12, 4).translate(0.45, 0, 0);
  const cloth = new THREE.Mesh(clothGeo, m.flag);
  cloth.position.set(hole.x + 0.03, hole.y + 2.12, hole.z);
  cloth.castShadow = true;
  cloth.userData.base = Float32Array.from(clothGeo.attributes.position.array);
  ctx.group.add(cup, rimMesh, pole, cloth);
  ctx.flag = cloth;
}

export function buildLevel(def) {
  const ctx = { group: new THREE.Group(), colliders: [], triggers: [], bumpers: [], spinners: [], flag: null };
  for (const part of def.parts) builders[part.t](ctx, part);
  const hole = new THREE.Vector3(...def.hole);
  buildFlag(ctx, hole);
  const bounds = new THREE.Box3().setFromObject(ctx.group);
  return {
    def,
    group: ctx.group,
    world: { colliders: ctx.colliders, triggers: ctx.triggers, hole },
    tee: new THREE.Vector3(def.tee[0], def.tee[1] + BALL_R, def.tee[2]),
    bumpers: ctx.bumpers,
    spinners: ctx.spinners,
    flag: ctx.flag,
    bounds,
  };
}

export function animateCourse(level, time, dt) {
  const m = materials();
  m.chevronTex.offset.y = (m.chevronTex.offset.y - dt * 1.6) % 1;
  for (const c of level.spinners) c.mesh.quaternion.copy(c.quat);
  for (const b of level.bumpers) {
    b.flash = Math.max(0, b.flash - dt * 4);
    const s = 1 + b.flash * 0.25;
    b.mesh.scale.set(s, 1, s);
  }
  const cloth = level.flag;
  const pos = cloth.geometry.attributes.position, base = cloth.userData.base;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    pos.setZ(i, Math.sin(x * 5 - time * 6) * 0.08 * x);
  }
  pos.needsUpdate = true;
  cloth.rotation.y = Math.sin(time * 0.7) * 0.4;
}

export function disposeLevel(level) {
  level.group.traverse((o) => o.geometry?.dispose());
}
