# SignalGuard: Biomedical IoT Signal Quality and Sensor Fault Detection System

A software-based Medical IoT project (course **22BM2022 – Medical Internet of Things**, Division of Biomedical Engineering, Karunya Institute of Technology and Sciences).

SignalGuard simulates an ECG sensor node and an edge processor in the browser. It injects common sensor faults, detects which fault is present from lightweight features, and reports a Signal Quality Index (SQI) so that downstream services know whether the data can be trusted.

## Features

* Virtual single-lead ECG at 250 Hz (Gaussian P-QRS-T model, 72 bpm)
* 7 injectable faults: packet dropout, flatline, saturation, motion artifact, 50 Hz interference, baseline drift, EMG noise
* 5 s edge ring buffer, analysis of the latest 2 s window every 200 ms
* 7 features: NaN ratio, standard deviation, clipping ratio, range, 50 Hz power ratio (Goertzel), block-mean drift, median |Δx|
* Priority-based rule classifier and SQI (0–100) with status GOOD / DEGRADED / FAULT
* Heart rate shown only when the signal is GOOD (quality gating)
* Live dashboard with detection latency, feature cards and event log, plus an Auto demo mode

## How to run

**Dashboard:** open `index.html` in any modern browser (Chrome, Edge, Firefox, Safari). No installation or server needed.

**Headless test (optional, needs Node.js 16+):**

```bash
node test/simulate.js
```

This injects each fault 20 times and prints the detection rate, latency and SQI, plus the false-alarm rate on a clean signal.

## Project structure

```
signalguard/
├── index.html          Dashboard page
├── src/
│   ├── core.js         Signal generation, fault injection, features, classifier, SQI (pure functions)
│   ├── app.js          Dashboard logic: streaming loop, canvas drawing, log, auto demo
│   └── style.css       Layout and light/dark theme
├── test/
│   └── simulate.js     Headless detection and latency test
├── package.json
└── LICENSE
```

## How it works

```
Virtual ECG sensor (250 Hz) -> Fault injector -> Edge buffer (5 s)
   -> Feature extraction (2 s window, every 200 ms) -> Rule classifier + SQI -> Dashboard and log
```

|Fault|Feature|Threshold|
|-|-|-|
|Packet dropout|NaN ratio|> 0.02|
|Flatline|Standard deviation|< 0.02 mV|
|Saturation|Clipping ratio (|x|
|Motion artifact|Range (max − min)|> 2.4 mV|
|50 Hz interference|Goertzel power ratio|> 0.20|
|Baseline drift|Block-mean drift|> 0.25 mV|
|EMG noise|Median absolute first difference|> 0.04 mV|

Faults are checked in the order above and the first threshold exceeded is reported.

**SQI** = 100 × (1 − 0.7 × worst penalty − 0.3 × average penalty), where each feature's penalty is `clamp((ratio − 0.5) / 1.5, 0, 1)` and `ratio` is the feature value divided by its threshold (inverted for flatline).

## Sample test results

Output of `node test/simulate.js` (20 trials per fault; values vary slightly between runs):

|Fault|Detected (of 20)|Mean latency (ms)|Mean SQI|
|-|-|-|-|
|Packet dropout|20|200|26|
|Flatline|20|2000|26|
|Saturation|20|400|21|
|Motion artifact|20|200|46|
|50 Hz interference|20|1400|23|
|Baseline drift|20|200|62|
|EMG noise|20|1220|63|

On a clean signal: 0 false alarms in 1500 analyses (5 minutes of simulated time).

Notes: flatline needs the whole 2 s window to become flat before the standard deviation falls below its threshold, and while the window fills it can briefly be labelled as drift. 50 Hz interference can be labelled as noise for the first moments until the 50 Hz power dominates the window.

## Limitations

* Simulated data, not patient recordings
* Thresholds are hand-tuned for the simulator and need recalibration for real devices
* Single ECG channel; simultaneous faults are reported as the highest-priority fault only
* Constant heart rate, no arrhythmias

## Future work

Validate on MIT-BIH / PhysioNet recordings, build a hardware node (AD8232 + ESP32 over MQTT), add a machine-learning classifier on the same features, multi-label fault output, and more sensors (PPG, SpO₂).

## Authors

Ketzi L, Dhanu Shree S, Fathimathu Liya PP 
Guide: Dr.Jothiraj Selvaraj, Assistant Professor, Division of Biomedical Engineering, Karunya Institute of Technology and Sciences

## License

MIT, see `LICENSE`.

