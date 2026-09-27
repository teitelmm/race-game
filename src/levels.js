// Coordinates: x is left/right, z runs from the tee (+z) toward the hole (-z), y is up.
const plat = (x, z, w, d, y = 0) => ({ t: 'plat', x, z, w, d, y });
const rampZ = (x, w, z0, z1, y0, y1) => ({ t: 'rampZ', x, w, z0, z1, y0, y1 });
const fence = (x0, z0, x1, z1, y0 = 0, y1 = y0, h = 0.6) => ({ t: 'fence', a: [x0, y0, z0], b: [x1, y1, z1], h });
const rim = (x0, z0, x1, z1, y = 0) => fence(x0, z0, x1, z1, y, y, 0.3);
const bumper = (x, z, y = 0, r = 0.45) => ({ t: 'bumper', x, z, y, r });
const spinner = (x, z, len, speed, y = 0) => ({ t: 'spinner', x, z, y, len, speed });
const sand = (x, z, w, d, y = 0) => ({ t: 'sand', x, z, w, d, y });
const boost = (x, z, dx, dz, power = 30, y = 0) => ({ t: 'boost', x, z, y, dir: [dx, dz], power });

function box(x0, z0, x1, z1, y = 0, open = '') {
  const out = [];
  if (!open.includes('n')) out.push(fence(x0, z0, x1, z0, y));
  if (!open.includes('s')) out.push(fence(x0, z1, x1, z1, y));
  if (!open.includes('w')) out.push(fence(x0, z0, x0, z1, y));
  if (!open.includes('e')) out.push(fence(x1, z0, x1, z1, y));
  return out;
}

export const LEVELS = [
  {
    name: 'Warm Up',
    par: 2,
    tee: [0, 0, 9],
    hole: [0, 0, -8],
    parts: [plat(0, 0, 5, 22), ...box(-2.5, -11, 2.5, 11)],
  },
  {
    name: 'Dogleg',
    par: 3,
    tee: [0, 0, 9],
    hole: [11.5, 0, -5.5],
    parts: [
      plat(0, 4, 5, 14),
      plat(5.75, -5.5, 16.5, 5),
      fence(-2.5, 11, 2.5, 11),
      fence(-2.5, 11, -2.5, -8),
      fence(2.5, 11, 2.5, -3),
      fence(-2.5, -8, 14, -8),
      fence(2.5, -3, 14, -3),
      fence(14, -3, 14, -8),
      fence(-2.5, -5.5, 0, -8),
      bumper(7, -4.3),
    ],
  },
  {
    name: 'Bumper Alley',
    par: 3,
    tee: [0, 0, 11],
    hole: [0, 0, -10.5],
    parts: [
      plat(0, 0, 7, 26),
      ...box(-3.5, -13, 3.5, 13),
      bumper(-1.5, 5), bumper(1.5, 5),
      bumper(0, 1),
      bumper(-2, -3), bumper(2, -3),
      bumper(0, -6.5),
    ],
  },
  {
    name: 'Leap of Faith',
    par: 3,
    tee: [0, 0, 7.5],
    hole: [0, 0, -9],
    parts: [
      plat(0, 6, 5, 6),
      fence(-2.5, 9, 2.5, 9), fence(-2.5, 9, -2.5, 3), fence(2.5, 9, 2.5, 3),
      fence(-2.5, 3, -1.5, 3), fence(1.5, 3, 2.5, 3),
      rampZ(0, 3, 3, 0, 0, 0.8),
      fence(-1.5, 3, -1.5, 0, 0, 0.8, 0.35), fence(1.5, 3, 1.5, 0, 0, 0.8, 0.35),
      plat(0, -8, 7, 10),
      fence(-3.5, -3, -3.5, -13), fence(3.5, -3, 3.5, -13), fence(-3.5, -13, 3.5, -13),
    ],
  },
  {
    name: 'The Sweeper',
    par: 3,
    tee: [0, 0, 10],
    hole: [0, 0, -9],
    parts: [
      plat(0, 0, 6, 24),
      ...box(-3, -12, 3, 12),
      fence(-3, 0, -2, 0), fence(2, 0, 3, 0),
      spinner(0, 0, 3.6, 1.5),
    ],
  },
  {
    name: 'Island Green',
    par: 3,
    tee: [0, 0, 8],
    hole: [0, 0, -4.5],
    parts: [
      plat(0, 7, 4, 5),
      ...box(-2, 4.5, 2, 9.5, 0, 'n'),
      plat(0, -4, 6, 6),
      rim(-3, -1, 3, -1), rim(-3, -7, 3, -7), rim(-3, -1, -3, -7), rim(3, -1, 3, -7),
    ],
  },
  {
    name: 'Switchback',
    par: 4,
    tee: [0, 2, 10],
    hole: [10, 1.5, 9],
    parts: [
      plat(0, 8, 5, 8, 2),
      fence(-2.5, 12, 2.5, 12, 2), fence(-2.5, 12, -2.5, 4, 2), fence(2.5, 12, 2.5, 4, 2),
      rampZ(0, 5, 4, -2, 2, 0),
      fence(-2.5, 4, -2.5, -2, 2, 0), fence(2.5, 4, 2.5, -2, 2, 0),
      plat(5, -5, 15, 6),
      fence(-2.5, -2, -2.5, -8), fence(-2.5, -8, 12.5, -8), fence(12.5, -8, 12.5, -2), fence(2.5, -2, 7.5, -2),
      sand(4.5, -6.3, 3, 3),
      boost(10, -4.5, 0, 1, 34),
      rampZ(10, 5, -2, 4, 0, 1.5),
      fence(7.5, -2, 7.5, 4, 0, 1.5), fence(12.5, -2, 12.5, 4, 0, 1.5),
      plat(10, 8, 5, 8, 1.5),
      fence(7.5, 4, 7.5, 12, 1.5), fence(12.5, 4, 12.5, 12, 1.5), fence(7.5, 12, 12.5, 12, 1.5),
    ],
  },
  {
    name: 'Pinball',
    par: 3,
    tee: [0, 0, 10],
    hole: [0, 0, -10],
    parts: [
      plat(0, 0, 10, 24),
      ...box(-5, -12, 5, 12),
      fence(-5, -9, -2, -12), fence(5, -9, 2, -12),
      bumper(0, 5), bumper(-2.5, 1), bumper(2.5, 1),
      bumper(0, -3), bumper(-3, -6.5), bumper(3, -6.5),
      boost(-3.8, 7, 0, -1, 32), boost(3.8, 7, 0, -1, 32),
    ],
  },
  {
    name: 'Summit',
    par: 4,
    tee: [0, 0, 10],
    hole: [0, 2, -16],
    parts: [
      plat(0, 3, 5, 18),
      fence(-2.5, 12, 2.5, 12), fence(-2.5, 12, -2.5, -6), fence(2.5, 12, 2.5, -6),
      fence(-2.5, -6, -1.5, -6), fence(1.5, -6, 2.5, -6),
      spinner(0, 3, 4.2, 1.2),
      boost(0, -3.8, 0, -1, 36),
      rampZ(0, 3, -6, -11, 0, 2),
      fence(-1.5, -6, -1.5, -11, 0, 2), fence(1.5, -6, 1.5, -11, 0, 2),
      plat(0, -14.5, 7, 7, 2),
      fence(-3.5, -11, -1.5, -11, 2), fence(1.5, -11, 3.5, -11, 2),
      fence(-3.5, -11, -3.5, -18, 2), fence(3.5, -11, 3.5, -18, 2), fence(-3.5, -18, 3.5, -18, 2),
      bumper(-1.5, -14, 2), bumper(1.5, -14, 2),
    ],
  },
];
