import * as THREE from 'three';

export const BALL_R = 0.2;
export const HOLE_R = 0.34;
export const GRAVITY = 22;

const ROLL_FRICTION = 2.2;
const ROLL_DRAG = 0.55;
const Y = new THREE.Vector3(0, 1, 0);

const _local = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _n = new THREE.Vector3();
const _surf = new THREE.Vector3();
const _rel = new THREE.Vector3();

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function makeBall(pos) {
  return {
    pos: pos.clone(),
    vel: new THREE.Vector3(),
    groundN: new THREE.Vector3(),
    grounded: false,
    groundNy: 0,
    inBoost: false,
  };
}

export function makeBox({ pos, quat = new THREE.Quaternion(), half, bounce = 0.25, friction = 1, kind = 'ground', spin = 0 }) {
  return {
    type: 'box', pos, half, bounce, friction, kind, spin, angle: 0,
    quat: quat.clone(), baseQuat: quat.clone(), invQuat: quat.clone().invert(),
  };
}

export function makeCylinder({ pos, radius, height, bounce = 0.9, kick = 0, kind = 'bumper' }) {
  return { type: 'cyl', pos, radius, height, bounce, kick, kind };
}

export function updateMovers(world, dt) {
  for (const c of world.colliders) {
    if (!c.spin) continue;
    c.angle += c.spin * dt;
    c.quat.setFromAxisAngle(Y, c.angle).multiply(c.baseQuat);
    c.invQuat.copy(c.quat).invert();
  }
}

function collideBox(ball, c, events) {
  const p = ball.pos;
  const h = c.half;
  _local.copy(p).sub(c.pos).applyQuaternion(c.invQuat);
  if (Math.abs(_local.x) > h.x + BALL_R || Math.abs(_local.y) > h.y + BALL_R || Math.abs(_local.z) > h.z + BALL_R) return null;

  _closest.set(clamp(_local.x, -h.x, h.x), clamp(_local.y, -h.y, h.y), clamp(_local.z, -h.z, h.z));
  _n.copy(_local).sub(_closest);
  const dist = _n.length();
  let pen;
  if (dist > 1e-6) {
    if (dist >= BALL_R) return null;
    _n.divideScalar(dist);
    pen = BALL_R - dist;
  } else {
    const dx = h.x - Math.abs(_local.x), dy = h.y - Math.abs(_local.y), dz = h.z - Math.abs(_local.z);
    if (dy <= dx && dy <= dz) { _n.set(0, Math.sign(_local.y) || 1, 0); pen = dy + BALL_R; }
    else if (dx <= dz) { _n.set(Math.sign(_local.x) || 1, 0, 0); pen = dx + BALL_R; }
    else { _n.set(0, 0, Math.sign(_local.z) || 1); pen = dz + BALL_R; }
  }
  _n.applyQuaternion(c.quat);
  p.addScaledVector(_n, pen);

  const v = ball.vel;
  if (c.spin) _surf.set(c.spin * (p.z - c.pos.z), 0, -c.spin * (p.x - c.pos.x));
  else _surf.set(0, 0, 0);
  _rel.copy(v).sub(_surf);
  const vn = _rel.dot(_n);
  if (vn < 0) {
    const floor = _n.y > 0.6;
    // Soft contacts don't bounce so the ball can settle on the ground.
    const e = floor && -vn < 2.5 ? 0 : c.bounce;
    _rel.addScaledVector(_n, -(1 + e) * vn);
    if (floor && -vn > 2.5) {
      // Hard landings bite into the turf and scrub off some roll.
      const keep = 1 - Math.min(0.35, 0.02 * -vn);
      const along = _rel.dot(_n);
      _rel.addScaledVector(_n, -along).multiplyScalar(keep).addScaledVector(_n, along);
    }
    v.copy(_rel).add(_surf);
    if (events && -vn > 1.5) events.push({ type: c.kind, strength: -vn, collider: c });
  }
  return _n;
}

function collideCyl(ball, c, events) {
  const p = ball.pos, v = ball.vel;
  if (p.y < c.pos.y - BALL_R || p.y > c.pos.y + c.height + BALL_R) return;
  const dx = p.x - c.pos.x, dz = p.z - c.pos.z, min = c.radius + BALL_R;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = dx / d, nz = dz / d;
  p.x = c.pos.x + nx * min;
  p.z = c.pos.z + nz * min;
  const vn = v.x * nx + v.z * nz;
  if (vn < 0) {
    v.x -= (1 + c.bounce) * vn * nx;
    v.z -= (1 + c.bounce) * vn * nz;
    v.x += nx * c.kick;
    v.z += nz * c.kick;
    if (events) events.push({ type: c.kind, strength: -vn, collider: c });
  }
}

function inTrigger(t, p) {
  if (Math.abs(p.y - BALL_R - t.y) > 0.3) return false;
  const dx = p.x - t.x, dz = p.z - t.z;
  return Math.abs(dx * t.ax + dz * t.az) < t.hl && Math.abs(dz * t.ax - dx * t.az) < t.hw;
}

export function stepBall(ball, world, dt, events) {
  const p = ball.pos, v = ball.vel;
  v.y -= GRAVITY * dt;
  p.addScaledVector(v, dt);

  let gy = 0, friction = 1;
  for (const c of world.colliders) {
    if (c.type === 'box') {
      const n = collideBox(ball, c, events);
      if (n && n.y > 0.6 && n.y > gy) { gy = n.y; ball.groundN.copy(n); friction = c.friction; }
    } else {
      collideCyl(ball, c, events);
    }
  }
  ball.grounded = gy > 0;
  ball.groundNy = gy;
  if (!ball.grounded) { ball.inBoost = false; return; }

  let fr = ROLL_FRICTION * friction, drag = ROLL_DRAG, boosting = false;
  for (const t of world.triggers) {
    if (!inTrigger(t, p)) continue;
    if (t.kind === 'sand') { fr += 14; drag += 3; }
    else if (t.kind === 'boost') {
      v.x += t.ax * t.power * dt;
      v.z += t.az * t.power * dt;
      boosting = true;
    }
  }
  if (boosting && !ball.inBoost && events) events.push({ type: 'boost' });
  ball.inBoost = boosting;

  const h = world.hole;
  const hx = h.x - p.x, hz = h.z - p.z, hd = Math.hypot(hx, hz);
  if (hd < HOLE_R + 0.35 && hd > 1e-4 && Math.abs(p.y - BALL_R - h.y) < 0.1) {
    const a = (7 * dt) / hd;
    v.x += hx * a;
    v.z += hz * a;
  }

  const n = ball.groundN;
  const vn = v.dot(n);
  const tx = v.x - n.x * vn, ty = v.y - n.y * vn, tz = v.z - n.z * vn;
  const s = Math.hypot(tx, ty, tz);
  if (s > 0) {
    const k = Math.max(0, s - (fr + drag * s) * dt) / s;
    v.set(tx * k + n.x * vn, ty * k + n.y * vn, tz * k + n.z * vn);
  }
}
