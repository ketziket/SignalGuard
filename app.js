/**
 * SignalGuard dashboard: streams the virtual sensor, runs the analysis every 200 ms
 * and draws the UI. All signal-processing logic lives in core.js.
 */
(function () {
  'use strict';
  const { FS, N, W, FAULTS, TH, gen, classify, heartRate } = window.SignalGuard;
  const $ = (s) => document.querySelector(s);
  const LBL = Object.fromEntries(FAULTS);
  const META = {
    dropout: ['NaN ratio', 2], flatline: ['Std dev (mV)', 3], clip: ['Clipping ratio', 3],
    motion: ['Range (mV)', 2], powerline: ['50 Hz power ratio', 3], drift: ['Block-mean drift', 2], noise: ['Median |Δx|', 3],
  };

  // ---- state ----
  const buf = new Float32Array(N);
  let idx = 0, tick = 0, inj = 'none', injT = 0, detT = null, cls = 'none';
  let sqi = 100, status = 'GOOD', hr = NaN, demo = null;
  const t0 = Date.now();

  // ---- fault buttons and log ----
  const fb = $('#fb');
  FAULTS.forEach(([k, l]) => {
    const b = document.createElement('button');
    b.textContent = l;
    b.dataset.k = k;
    b.onclick = () => setInj(k);
    fb.appendChild(b);
  });

  function setInj(k, auto) {
    if (!auto && demo) stopDemo();
    inj = k; injT = Date.now(); detT = null;
    $('#ij').textContent = LBL[k];
    fb.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    log('Injected: ' + LBL[k]);
  }

  function log(s) {
    const d = document.createElement('div');
    d.textContent = '[' + ((Date.now() - t0) / 1000).toFixed(1) + 's] ' + s;
    const L = $('#log');
    L.prepend(d);
    while (L.children.length > 60) L.lastChild.remove();
  }

  // ---- analysis (every 200 ms) ----
  function analyse() {
    const res = classify(Array.from(buf.slice(N - W)));
    sqi = res.sqi; status = res.status;
    if (res.cls !== cls) {
      log(res.cls === 'none' ? 'Signal restored · SQI ' + sqi : 'DETECTED: ' + LBL[res.cls] + ' · SQI ' + sqi);
      if (res.cls !== 'none' && res.cls === inj && detT === null) {
        detT = Date.now() - injT;
        log('Detection latency ' + detT + ' ms');
      }
      cls = res.cls;
    }
    hr = status === 'GOOD' ? heartRate(buf) : NaN;   // heart rate only when signal is good
    updateUI(res.f);
  }

  function updateUI(f) {
    const col = status === 'GOOD' ? 'var(--ok)' : status === 'DEGRADED' ? 'var(--wn)' : 'var(--bad)';
    $('#sqi').textContent = sqi; $('#sqi').style.color = col;
    const sb = $('#sb'); sb.style.width = sqi + '%'; sb.style.background = col;
    const st = $('#st'); st.textContent = status; st.style.background = col;
    $('#dt').textContent = LBL[cls];
    $('#lt').textContent = inj === 'none' ? '–' : detT === null ? 'pending…' : detT + ' ms';
    $('#hr').textContent = isNaN(hr) ? '–' : Math.round(hr) + ' bpm';
    $('#pk').textContent = idx;
    $('#mt').innerHTML = Object.keys(TH).map((k) => {
      const inv = k === 'flatline';
      const tripped = inv ? f[k] < TH[k] : f[k] > TH[k];
      return `<div class="${tripped ? 't' : ''}"><small>${META[k][0]}</small><b>${f[k].toFixed(META[k][1])}</b> <em>${inv ? 'min ' : 'max '}${TH[k]}</em></div>`;
    }).join('');
  }

  // ---- canvas drawing ----
  const cv = $('#cv'), cx = cv.getContext('2d');
  function draw() {
    const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, w, h);
    const y = (v) => h / 2 - (v * h) / 6.4;
    cx.fillStyle = 'rgba(90,169,255,.12)';
    cx.fillRect((w * (N - W)) / N, 0, (w * W) / N, h);
    cx.strokeStyle = 'rgba(255,255,255,.1)'; cx.lineWidth = 1; cx.setLineDash([4, 4]);
    [1.5, -1.5].forEach((v) => { cx.beginPath(); cx.moveTo(0, y(v)); cx.lineTo(w, y(v)); cx.stroke(); });
    cx.setLineDash([]);
    cx.fillStyle = 'rgba(255,255,255,.5)'; cx.font = '11px system-ui';
    cx.fillText('ADC rail ±1.5 mV', 6, y(1.5) - 4);
    cx.fillText('analysis window (2 s)', (w * (N - W)) / N + 6, 14);
    cx.strokeStyle = status === 'GOOD' ? '#37e2a0' : status === 'DEGRADED' ? '#f0a93b' : '#ff6b76';
    cx.lineWidth = 1.6; cx.beginPath();
    let pen = false;
    for (let i = 0; i < N; i++) {
      const v = buf[i];
      if (!Number.isFinite(v)) { pen = false; continue; }   // gap for missing samples
      const X = (i * w) / N;
      pen ? cx.lineTo(X, y(v)) : cx.moveTo(X, y(v));
      pen = true;
    }
    cx.stroke();
    requestAnimationFrame(draw);
  }

  // ---- auto demo ----
  function stopDemo() { clearInterval(demo); demo = null; $('#auto').textContent = '▶ Auto demo'; }
  $('#auto').onclick = () => {
    if (demo) return stopDemo();
    let i = 0;
    $('#auto').textContent = '■ Stop demo';
    const step = () => { setInj(FAULTS[i % FAULTS.length][0], true); i++; };
    step();
    demo = setInterval(step, 6000);
  };

  // ---- start streaming: 10 samples every 40 ms = 250 Hz ----
  for (let i = 0; i < N; i++) buf[i] = gen(i / FS, 'none');
  idx = N;
  setInterval(() => {
    buf.copyWithin(0, 10);
    for (let i = 0; i < 10; i++) { buf[N - 10 + i] = gen(idx / FS, inj); idx++; }
    if (++tick % 5 === 0) analyse();
  }, 40);

  analyse();
  requestAnimationFrame(draw);
  log('Sensor online · streaming at 250 Hz');
})();
