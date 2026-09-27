let ctx = null;
let master = null;
let noiseBuf = null;
let lastBounce = 0;
let muted = false;

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.55;
}

function envelope(g, t, dur, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function tone(f0, f1, dur, type = 'sine', peak = 0.3, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  envelope(g, t, dur, peak);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, peak, freq, type = 'bandpass', delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  envelope(g, t, dur, peak);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

export function hit(power) {
  tone(260 + power * 160, 110, 0.14, 'triangle', 0.4);
  noise(0.06, 0.2 + power * 0.25, 2400);
}

export function bounce(strength) {
  const now = performance.now();
  if (now - lastBounce < 60) return;
  lastBounce = now;
  tone(620 + strength * 25, 380, 0.07, 'square', Math.min(0.14, 0.02 + strength * 0.012));
}

export function thud(strength) {
  const now = performance.now();
  if (now - lastBounce < 60) return;
  lastBounce = now;
  noise(0.09, Math.min(0.3, strength * 0.03), 500, 'lowpass');
}

export function bumper() {
  tone(320, 980, 0.16, 'sine', 0.35);
  tone(640, 1400, 0.1, 'triangle', 0.12);
}

export function boost() {
  tone(300, 1300, 0.3, 'sawtooth', 0.07);
}

export function sink() {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0, 0.22, 'triangle', 0.28, i * 0.08));
}

export function fanfare() {
  [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0, 0.26, 'triangle', 0.3, 0.35 + i * 0.1));
}

export function splash() {
  noise(0.6, 0.45, 900, 'lowpass');
  tone(180, 60, 0.3, 'sine', 0.2);
}

export function click() {
  tone(880, 0, 0.04, 'square', 0.05);
}

let hum = null;
let lastTick = -1;

export function chargeStart() {
  if (!ctx || hum) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = 140;
  g.gain.value = 0.0001;
  g.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 0.05);
  o.connect(g).connect(master);
  o.start();
  hum = { o, g };
  lastTick = -1;
}

export function chargeSet(power) {
  if (!ctx || !hum) return;
  hum.o.frequency.setTargetAtTime(140 + power * 360, ctx.currentTime, 0.03);
  const step = Math.floor(power * 10);
  if (step !== lastTick) {
    if (step > lastTick && step > 0) tone(420 + step * 70, 0, 0.035, 'square', 0.045);
    lastTick = step;
  }
}

export function chargeStop() {
  if (!ctx || !hum) return;
  const { o, g } = hum;
  g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.02);
  o.stop(ctx.currentTime + 0.1);
  hum = null;
}

export function maxPower() {
  tone(1200, 1800, 0.12, 'square', 0.08);
}

export function whoosh(power) {
  noise(0.35, 0.12 + power * 0.18, 1400, 'bandpass');
}

export function lipOut() {
  tone(700, 380, 0.12, 'square', 0.1);
  tone(500, 260, 0.14, 'triangle', 0.12, 0.05);
}
