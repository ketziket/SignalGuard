/**
 * Headless test: injects each fault into the virtual sensor and reports
 * detection rate, detection latency, SQI and false-alarm rate on a clean signal.
 * Run with:  node test/simulate.js
 */
const SG = require('../src/core.js');
const { FS, N, W, FAULTS, gen, classify } = SG;

const TRIALS = 20;          // trials per fault
const CHUNK = 10;           // samples per tick (40 ms)
const EVERY = 5;            // analysis every 5 ticks (200 ms)
const TICK_MS = (CHUNK / FS) * 1000;

function newStream() {
  const buf = new Float32Array(N);
  let idx = 0;
  for (; idx < N; idx++) buf[idx] = gen(idx / FS, 'none');
  let tick = 0;
  // Advance one tick; returns the analysis result every EVERY ticks, otherwise null.
  return function step(fault) {
    buf.copyWithin(0, CHUNK);
    for (let i = 0; i < CHUNK; i++) { buf[N - CHUNK + i] = gen(idx / FS, fault); idx++; }
    return ++tick % EVERY === 0 ? classify(Array.from(buf.slice(N - W))) : null;
  };
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const rows = [];

for (const [fault, label] of FAULTS.filter(([k]) => k !== 'none')) {
  const lat = [], sqis = [];
  let detected = 0;
  const confusions = {};
  for (let t = 0; t < TRIALS; t++) {
    const step = newStream();
    for (let i = 0; i < 25; i++) step('none');          // warm-up, 1 s clean
    let found = false;
    for (let i = 1; i <= 250 && !found; i++) {           // up to 10 s after injection
      const r = step(fault);
      if (!r) continue;
      if (r.cls === fault) { found = true; detected++; lat.push(i * TICK_MS); sqis.push(r.sqi); }
      else if (r.cls !== 'none') confusions[r.cls] = (confusions[r.cls] || 0) + 1;
    }
  }
  rows.push({
    Fault: label,
    ['Detected (of ' + TRIALS + ')']: detected,
    'Mean latency (ms)': Math.round(mean(lat)),
    'Max latency (ms)': lat.length ? Math.round(Math.max(...lat)) : NaN,
    'Mean SQI': Math.round(mean(sqis)),
    'Other labels seen first': Object.keys(confusions).join(', ') || '-',
  });
}
console.table(rows);

// False alarms on a clean signal (5 minutes of simulated time)
const step = newStream();
let n = 0, alarms = 0, minSqi = 100;
for (let i = 0; i < (5 * 60 * FS) / CHUNK; i++) {
  const r = step('none');
  if (!r) continue;
  n++;
  if (r.cls !== 'none' || r.status !== 'GOOD') alarms++;
  minSqi = Math.min(minSqi, r.sqi);
}
console.log(`Clean signal: ${alarms} false alarms in ${n} analyses (${((alarms / n) * 100).toFixed(2)} %), lowest SQI ${minSqi}`);
