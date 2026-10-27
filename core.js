/**
 * SignalGuard core: synthetic ECG, fault injection, feature extraction,
 * rule-based fault classifier and Signal Quality Index (SQI).
 * Pure functions only (no DOM), so the same code runs in the browser and in Node tests.
 */
(function (root) {
  'use strict';

  const FS = 250;       // sampling rate (Hz)
  const N = 1250;       // edge ring buffer length (5 s)
  const W = 500;        // analysis window length (2 s)

  const FAULTS = [
    ['none', 'Normal'], ['dropout', 'Packet dropout'], ['flatline', 'Flatline'],
    ['clip', 'Saturation'], ['motion', 'Motion artifact'], ['powerline', '50 Hz interference'],
    ['drift', 'Baseline drift'], ['noise', 'EMG noise'],
  ];

  // Thresholds, listed in classifier priority order.
  // For 'flatline' the feature (std dev) must be BELOW its threshold; for all others ABOVE.
  const TH = { dropout: 0.02, flatline: 0.02, clip: 0.05, motion: 2.4, powerline: 0.2, drift: 0.25, noise: 0.04 };

  /** Standard normal random number (Box-Muller). */
  function gauss() {
    let u = 0;
    while (!u) u = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  }

  /** Clean ECG: sum of five Gaussian waves (P, Q, R, S, T) at 72 bpm. */
  function ecg(t) {
    const p = (t * 1.2) % 1;
    const g = (c, a, w) => a * Math.exp(-((p - c) ** 2) / (2 * w * w));
    return g(0.2, 0.12, 0.025) + g(0.37, -0.12, 0.01) + g(0.4, 1, 0.012) + g(0.43, -0.2, 0.012) + g(0.65, 0.3, 0.05);
  }

  /** One sensor sample at time t (seconds) with the given fault injected. */
  function gen(t, fault) {
    const x = ecg(t) + (Math.random() - 0.5) * 0.02;
    switch (fault) {
      case 'dropout':   return (t % 1.2) < 0.3 ? NaN : x;
      case 'flatline':  return 0.35 + Math.random() * 0.003;
      case 'clip':      return Math.max(-1.5, Math.min(1.5, x * 3 + 1.4));
      case 'motion':    return x + 1.6 * Math.sin(2 * Math.PI * 2.3 * t) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.7 * t));
      case 'powerline': return x + 0.4 * Math.sin(2 * Math.PI * 50 * t);
      case 'drift':     return x + 0.8 * Math.sin(2 * Math.PI * 0.2 * t);
      case 'noise':     return x + 0.12 * gauss();
      default:          return x;
    }
  }

  /** Seven features from a window of W samples (NaN = missing sample). */
  function features(w) {
    const v = w.filter(Number.isFinite);
    const n = v.length || 1;
    const mean = v.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    const clip = v.filter((x) => Math.abs(x) >= 1.499).length / n;
    const range = Math.max(...v) - Math.min(...v);

    // Median absolute first difference (robust to sharp QRS peaks)
    const d = [];
    for (let i = 1; i < v.length; i++) d.push(Math.abs(v[i] - v[i - 1]));
    d.sort((a, b) => a - b);

    // Goertzel algorithm at 50 Hz (bin 100 for N = 500, fs = 250 -> no leakage)
    const k = (2 * Math.PI * 50) / FS, co = 2 * Math.cos(k);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < W; i++) {
      const x = Number.isFinite(w[i]) ? w[i] - mean : 0;
      const s = x + co * s1 - s2;
      s2 = s1; s1 = s;
    }
    const power = (s1 * s1 + s2 * s2 - co * s1 * s2) / (W * W);

    // Four 0.5 s block means -> baseline wander
    const bm = [0, 1, 2, 3].map((b) => {
      let a = 0;
      for (let i = b * 125; i < b * 125 + 125; i++) a += Number.isFinite(w[i]) ? w[i] : 0;
      return a / 125;
    });

    return {
      dropout: 1 - v.length / W,
      flatline: sd,
      clip,
      motion: range,
      powerline: power / (sd * sd + 1e-9),
      drift: Math.max(...bm) - Math.min(...bm),
      noise: d[d.length >> 1] || 0,
    };
  }

  /** Classify a window: fault label (first threshold exceeded), SQI 0-100 and status. */
  function classify(w) {
    const f = features(w);
    let cls = 'none';
    const pen = [];
    for (const key of Object.keys(TH)) {
      const r = key === 'flatline' ? TH[key] / Math.max(f[key], 1e-6) : f[key] / TH[key];
      pen.push(Math.min(1, Math.max(0, (r - 0.5) / 1.5)));
      if (cls === 'none' && r > 1) cls = key;
    }
    const worst = Math.max(...pen);
    const avg = pen.reduce((a, b) => a + b, 0) / pen.length;
    const sqi = Math.round(100 * (1 - 0.7 * worst - 0.3 * avg));
    const status = cls !== 'none' ? (sqi < 50 ? 'FAULT' : 'DEGRADED') : (sqi < 80 ? 'DEGRADED' : 'GOOD');
    return { f, cls, sqi, status };
  }

  /** Heart rate (bpm) from R-peaks in the whole buffer; NaN if fewer than 3 peaks. */
  function heartRate(buf) {
    const pk = [];
    for (let i = 2; i < buf.length - 2; i++) {
      const x = buf[i];
      if (x > 0.6 && x >= buf[i - 1] && x > buf[i + 1] && (!pk.length || i - pk[pk.length - 1] > 60)) pk.push(i);
    }
    if (pk.length < 3) return NaN;
    return (60 * FS * (pk.length - 1)) / (pk[pk.length - 1] - pk[0]);
  }

  const api = { FS, N, W, FAULTS, TH, ecg, gen, features, classify, heartRate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SignalGuard = api;
})(typeof window !== 'undefined' ? window : globalThis);
