import * as THREE from 'three';

export const COLORS = [
  { id: 'white', name: 'Tour White', hex: '#f5f5ef' },
  { id: 'red', name: 'Cherry', hex: '#ef3b4f' },
  { id: 'orange', name: 'Tangerine', hex: '#ff8a1f' },
  { id: 'yellow', name: 'Lemon', hex: '#ffd23f' },
  { id: 'lime', name: 'Lime', hex: '#8fdc3c' },
  { id: 'teal', name: 'Lagoon', hex: '#19c2b0' },
  { id: 'blue', name: 'Cobalt', hex: '#3d6bff' },
  { id: 'purple', name: 'Grape', hex: '#8f5cff' },
  { id: 'pink', name: 'Bubblegum', hex: '#ff6fb5' },
  { id: 'black', name: 'Midnight', hex: '#23263a' },
];

export const PATTERNS = [
  { id: 'classic', name: 'Classic' },
  { id: 'stripe', name: 'Stripe' },
  { id: 'split', name: 'Split' },
  { id: 'dots', name: 'Dots' },
  { id: 'checker', name: 'Checker' },
  { id: 'stars', name: 'Stars' },
  { id: 'smiley', name: 'Smiley' },
  { id: 'eye', name: 'Eyeball' },
];

export const FINISHES = [
  { id: 'matte', name: 'Matte' },
  { id: 'gloss', name: 'Gloss' },
  { id: 'metal', name: 'Chrome' },
  { id: 'glow', name: 'Glow' },
];

export const TRAILS = [
  { id: 'none', name: 'Off' },
  { id: 'color', name: 'Color' },
  { id: 'rainbow', name: 'Rainbow' },
  { id: 'fire', name: 'Fire' },
];

export const DEFAULT_STYLE = { color: 'white', pattern: 'classic', finish: 'gloss', trail: 'color' };

const STYLE_KEY = 'slingshot-golf-ball';

export function loadStyle() {
  try {
    const s = JSON.parse(localStorage.getItem(STYLE_KEY));
    if (s && typeof s === 'object') {
      return {
        color: COLORS.some((c) => c.id === s.color) ? s.color : DEFAULT_STYLE.color,
        pattern: PATTERNS.some((p) => p.id === s.pattern) ? s.pattern : DEFAULT_STYLE.pattern,
        finish: FINISHES.some((f) => f.id === s.finish) ? s.finish : DEFAULT_STYLE.finish,
        trail: TRAILS.some((t) => t.id === s.trail) ? s.trail : DEFAULT_STYLE.trail,
      };
    }
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_STYLE };
}

export function saveStyle(style) {
  try { localStorage.setItem(STYLE_KEY, JSON.stringify(style)); } catch { /* storage unavailable */ }
}

export function colorHex(style) {
  return COLORS.find((c) => c.id === style.color).hex;
}

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const INK = rgb('#1d2440');
const WHITE = rgb('#fafaf5');

function isLight([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}

// Evenly spread points over a sphere; used for dots, stars and dimples.
function fibonacciSphere(n) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    pts.push([Math.cos(golden * i) * r, y, Math.sin(golden * i) * r]);
  }
  return pts;
}
const DOT_PTS = fibonacciSphere(12);
const DIMPLE_PTS = fibonacciSphere(280);

function nearest(pts, x, y, z) {
  let best = -2, bi = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const d = p[0] * x + p[1] * y + p[2] * z;
    if (d > best) { best = d; bi = i; }
  }
  return [bi, best];
}

// Returns the surface color for a unit direction on the ball.
function makeSampler(style) {
  const primary = rgb(colorHex(style));
  const secondary = isLight(primary) ? (style.color === 'white' ? rgb('#ef3b4f') : INK) : WHITE;
  switch (style.pattern) {
    case 'stripe': {
      const band = style.color === 'white' ? secondary : primary;
      return (x, y) => (Math.abs(y) < 0.42 ? band : WHITE);
    }
    case 'split':
      return (x, y) => (y > 0 ? primary : secondary);
    case 'dots':
      return (x, y, z) => (nearest(DOT_PTS, x, y, z)[1] > 0.93 ? secondary : primary);
    case 'checker':
      return (x, y, z) => {
        const lon = Math.atan2(z, x), lat = Math.asin(Math.max(-1, Math.min(1, y)));
        const a = Math.floor((lon + Math.PI) / (Math.PI / 4));
        const b = Math.floor((lat + Math.PI / 2) / (Math.PI / 4));
        return (a + b) % 2 ? primary : secondary;
      };
    case 'stars':
      return (x, y, z) => {
        const [i, d] = nearest(DOT_PTS, x, y, z);
        if (d < 0.8) return primary;
        const c = DOT_PTS[i];
        // Local 2D coordinates on the tangent plane around the star's center.
        const ux = [c[2], 0, -c[0]];
        const ul = Math.hypot(ux[0], ux[2]) || 1;
        ux[0] /= ul; ux[2] /= ul;
        const uy = [c[1] * ux[2] - c[2] * ux[1], c[2] * ux[0] - c[0] * ux[2], c[0] * ux[1] - c[1] * ux[0]];
        const px = x * ux[0] + y * ux[1] + z * ux[2];
        const py = x * uy[0] + y * uy[1] + z * uy[2];
        const r = Math.hypot(px, py);
        const seg = (Math.PI * 2) / 5;
        const t = (((Math.atan2(py, px) + Math.PI / 2) % seg) + seg) % seg / seg;
        const edge = 0.1 + 0.16 * Math.abs(1 - 2 * t);
        return r < edge ? secondary : primary;
      };
    case 'smiley': {
      const face = style.color === 'white' ? rgb('#ffd23f') : primary;
      return (x, y, z) => {
        if (z < 0.2) return face;
        const eye = (ex) => Math.hypot(x - ex, y - 0.26) < 0.1;
        const m = Math.hypot(x, y - 0.08);
        const mouth = y < 0.0 && m > 0.44 && m < 0.55;
        return eye(-0.27) || eye(0.27) || mouth ? INK : face;
      };
    }
    case 'eye': {
      const iris = style.color === 'white' ? rgb('#3d6bff') : primary;
      return (x, y, z) => {
        if (z < 0.5) return WHITE;
        const d = Math.hypot(x, y);
        if (Math.hypot(x + 0.1, y - 0.1) < 0.06) return WHITE;
        if (d < 0.2) return INK;
        if (d < 0.46) return iris;
        if (d < 0.5) return INK;
        return WHITE;
      };
    }
    default:
      return () => primary;
  }
}

function fillEquirect(canvas, fn) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const img = g.createImageData(W, H);
  let o = 0;
  for (let py = 0; py < H; py++) {
    const theta = ((py + 0.5) / H) * Math.PI;
    const st = Math.sin(theta), ct = Math.cos(theta);
    for (let px = 0; px < W; px++) {
      const phi = ((px + 0.5) / W) * Math.PI * 2;
      // Matches three.js SphereGeometry's UV layout.
      const c = fn(-Math.cos(phi) * st, ct, Math.sin(phi) * st);
      img.data[o++] = c[0];
      img.data[o++] = c[1];
      img.data[o++] = c[2];
      img.data[o++] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

export function paintBallTexture(texture, style) {
  const sample = makeSampler(style);
  fillEquirect(texture.image, sample);
  texture.needsUpdate = true;
}

export function createBallTexture(style) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  paintBallTexture(tex, style);
  return tex;
}

export function createDimpleTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const R = 0.095;
  fillEquirect(c, (x, y, z) => {
    const d = Math.acos(Math.min(1, nearest(DIMPLE_PTS, x, y, z)[1]));
    const v = d < R ? Math.round(150 + 105 * (d / R) ** 2) : 255;
    return [v, v, v];
  });
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

export function styleMaterial(mat, style) {
  const f = style.finish;
  mat.roughness = f === 'matte' ? 0.7 : f === 'metal' ? 0.22 : f === 'glow' ? 0.45 : 0.28;
  mat.metalness = f === 'metal' ? 1 : 0;
  mat.clearcoat = f === 'gloss' ? 1 : 0;
  mat.clearcoatRoughness = 0.12;
  mat.emissive.set(f === 'glow' ? 0xffffff : 0x000000);
  mat.emissiveMap = f === 'glow' ? mat.map : null;
  mat.emissiveIntensity = f === 'glow' ? 0.85 : 0;
  mat.envMapIntensity = f === 'metal' ? 1.2 : 0.5;
  mat.needsUpdate = true;
}

export function createBallMaterial(map, bumpMap) {
  return new THREE.MeshPhysicalMaterial({ map, bumpMap, bumpScale: 2 });
}

// Flat shaded sphere drawn on a 2D canvas, for the pattern buttons.
export function drawThumb(canvas, style) {
  const g = canvas.getContext('2d');
  const S = canvas.width;
  const img = g.createImageData(S, S);
  const sample = makeSampler(style);
  const tilt = -0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
  const light = [-0.45, 0.6, 0.66];
  let o = 0;
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++, o += 4) {
      const x = ((px + 0.5) / S) * 2 - 1, y = 1 - ((py + 0.5) / S) * 2;
      const r2 = x * x + y * y;
      if (r2 > 1) { img.data[o + 3] = 0; continue; }
      const z = Math.sqrt(1 - r2);
      // Tilt the ball toward the viewer so the top and face both show.
      const c = sample(x, y * ct - z * st, y * st + z * ct);
      const lam = Math.max(0, x * light[0] + y * light[1] + z * light[2]);
      const shade = 0.55 + 0.5 * lam;
      const spec = Math.pow(lam, 24) * 90;
      img.data[o] = Math.min(255, c[0] * shade + spec);
      img.data[o + 1] = Math.min(255, c[1] * shade + spec);
      img.data[o + 2] = Math.min(255, c[2] * shade + spec);
      img.data[o + 3] = r2 > 0.96 ? Math.round(255 * (1 - (r2 - 0.96) / 0.04)) : 255;
    }
  }
  g.putImageData(img, 0, 0);
}
