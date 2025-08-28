/*
Usage example:
import DesertAmbientAudio from './src/audio.js';
const audio = new DesertAmbientAudio({ seed: 'dune42', tempo: 64, masterGainDb: -18 });
audio.onready = () => console.log('ready');
// Call inside a user gesture (e.g. button click): audio.start();
// Later: audio.setVolume(0.5); audio.reseed('other'); audio.stop();
*/

// Desert ambient audio engine (CC0 assets embedded). No external dependencies.
// Design: lightweight sample-based generator with deterministic PRNG when seeded.
export default class DesertAmbientAudio {
  constructor(options = {}) {
    this.options = options;
  // Defer creating AudioContext until needed (reduces autoplay warnings)
  this.context = options.context || null;
    this.seed = this._normalizeSeed(options.seed || Date.now());
    this.tempo = options.tempo || 64; // BPM
    this.root = (options.root || 'A').toUpperCase();
  // Slightly louder but still background-safe
  // Louder default (previously -16). Raised by +6 dB as requested.
  this.masterGainDb = options.masterGainDb != null ? options.masterGainDb : -10;
  this.started = false;
    this._suspendedByPage = false;

    // Callbacks
    this.onready = null; // () => {}
    this.onstarted = null;
    this.onstopped = null;
    this.onerror = null;

    // PRNG state
    this._rng = this._makeRng(this.seed);

    // Scheduling
    this.lookAhead = 0.025; // sec
    this.scheduleAheadTime = 0.10; // sec
    this._nextNoteTime = 0;
    this._currentStep = 0; // 0..15 for 16th notes frame
    this._schedulerId = null;

    // Melody state
    this._scale = ['A','C','D','E','G'];
    this._colorTones = ['Bb','C#','F'];
    this._rootMidi = this._noteToMidi(this.root + '3'); // base octave 3
    this._lastDegreeIndex = 0; // index in combined scale for walk

    // Volume
    this._userVolume = 1.0; // linear 0..1 applied after masterGainDb
    this._muted = false;
  // Drone dynamics enabled by default
  this.droneDynamics = this.options.droneDynamics !== false;

    // Buffers / nodes
    this.buffers = { pluck: null, wind: null, pad: null };
    this._voice = {};

  // Generate procedural sample buffers (replaces embedded WAVs)
    this._ready = false;
    if (this.context) {
      this._init();
      document.addEventListener('visibilitychange', () => this._handleVisibility());
    }
  }

  // Public API -----------------------------------------------------------
  start() {
    if (this.started) return;
    this._ensureContext();
    this._resumeContext().then(() => this._completeStart()).catch(err => {
      // If blocked, attach one-time gesture listeners to retry
      if (err && /gesture|suspend|allowed/i.test(err.message || '')) {
        this._attachGestureRetry();
      } else {
        this._fireError(err);
      }
    });
  }
  stop() {
    if (!this.started) return;
    this.started = false;
    this._stopScheduler();
    const endTime = this.context.currentTime + 0.4;
    this.masterGain.gain.cancelScheduledValues(this.context.currentTime);
    this.masterGain.gain.linearRampToValueAtTime(0.00001, endTime);
    setTimeout(() => { this._stopPadAndWind(); this._fire('onstopped'); }, 420);
  }
  pause() { this.stop(); }
  resume() { if (!this.started) this.start(); }
  setVolume(v) { this._userVolume = Math.max(0, Math.min(1, v)); this._updateMasterGain(); }
  mute(m) { this._muted = !!m; this._updateMasterGain(); }
  setTempo(bpm) { this.tempo = Math.max(30, Math.min(120, bpm)); }
  setRoot(note) { this.root = (note||'A').toUpperCase(); this._rootMidi = this._noteToMidi(this.root + '3'); }
  reseed(seed) { this.seed = this._normalizeSeed(seed); this._rng = this._makeRng(this.seed); this._lastDegreeIndex = 0; }
  setDroneLevel(level) {
    if (!this.context || !this._voice) return;
    const l = Math.max(0, Math.min(1, level));
    if (this._voice.windGain) this._voice.windGain.gain.setTargetAtTime((this.options.windLevel!=null?this.options.windLevel:0.12)*l, this.context.currentTime, 0.6);
    if (this._voice.padGain) this._voice.padGain.gain.setTargetAtTime(0.15*l, this.context.currentTime, 1.0);
  }
  destroy() { this.stop(); this._disconnectAll(); document.removeEventListener('visibilitychange', this._handleVisibility); if (this.context && this.context.state !== 'closed') { try { this.context.close(); } catch(e){} } }

  // Internal init --------------------------------------------------------
  _init() {
  if (this._initialized) return; // guard
  this._initialized = true;
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0.00001; // start silent
    this.masterGain.connect(this.context.destination);

    // Reverb
    this.reverb = this.context.createConvolver();
    this.reverb.buffer = this._makeImpulseResponse(2.5, 2.2);

    // Voice buses
    this._voice.pluckGain = this.context.createGain(); this._voice.pluckGain.gain.value = 0.8;
  this._voice.pluckFilter = this.context.createBiquadFilter(); this._voice.pluckFilter.type = 'lowpass'; this._voice.pluckFilter.frequency.value = 4200; // a bit brighter
    this._voice.pluckGain.connect(this._voice.pluckFilter);

    this._voice.padGain = this.context.createGain(); this._voice.padGain.gain.value = 0.15;
  this._voice.padFilter = this.context.createBiquadFilter(); this._voice.padFilter.type = 'lowpass'; this._voice.padFilter.frequency.value = 2000;
    this._voice.padGain.connect(this._voice.padFilter);

  // Softer wind so plucks are clearer
  const windLevel = this.options.windLevel != null ? this.options.windLevel : 0.12; // user adjustable
  this._voice.windGain = this.context.createGain(); this._voice.windGain.gain.value = windLevel;
    this._voice.windShape = this.context.createGain(); this._voice.windShape.gain.value = 1.0; // dynamic envelope layer
    this._voice.windFilter = this.context.createBiquadFilter(); this._voice.windFilter.type = 'bandpass'; this._voice.windFilter.frequency.value = 1000; this._voice.windFilter.Q.value = 0.7;
    this._voice.windPan = (this.context.createStereoPanner) ? this.context.createStereoPanner() : null;
    this._voice.windGain.connect(this._voice.windShape);
    this._voice.windShape.connect(this._voice.windFilter);
    if (this._voice.windPan) this._voice.windFilter.connect(this._voice.windPan);

    // Connect to reverb
    this._voice.pluckFilter.connect(this.reverb);
    this._voice.padFilter.connect(this.reverb);
  (this._voice.windPan || this._voice.windFilter).connect(this.reverb);
    this.reverb.connect(this.masterGain);

    // Also send some dry signal lightly
    this._dryMix = this.context.createGain(); this._dryMix.gain.value = 0.3;
    this._voice.pluckFilter.connect(this._dryMix);
    this._voice.padFilter.connect(this._dryMix);
  (this._voice.windPan || this._voice.windFilter).connect(this._dryMix);
    this._dryMix.connect(this.masterGain);

  this._updateMasterGain();

  this._lastWindMod = 0; // for periodic organic modulation

  this._loadSamples().then(() => { this._ready = true; this._fire('onready'); }).catch(e => { this._ready = true; this._fireError(e); this._fire('onready'); });
  }

  _disconnectAll() { try { this.masterGain.disconnect(); } catch(e){} }

  // Procedural sample generation (acts like pre-recorded one-shots / loops)
  _loadSamples() {
    return new Promise((resolve) => {
      const sr = this.context.sampleRate;
      const rng = this._rng; // deterministic part of texture

      // Pluck one-shot (~450ms) improved Karplus-Strong style (clearer transient)
      const pluckDur = 0.45; const pluckLen = Math.floor(sr * pluckDur);
      const pluck = this.context.createBuffer(1, pluckLen, sr);
      const p = pluck.getChannelData(0);
      const freq = 220; // A3 base
      const period = Math.floor(sr / freq);
      for (let i=0;i<period;i++) p[i] = (rng()*2-1)*0.65; // initial burst
      let decay = 0.9985;
      for (let i=period;i<pluckLen;i++) {
        const a = p[i-period];
        const b = p[i-period+1] || a;
        // slight high-frequency emphasis by mixing original noise occasionally
        const blend = (i % 32===0) ? (rng()*0.3-0.15) : 0;
        p[i] = ((a + b)*0.5 + blend) * decay;
        decay *= 0.99994; // progressive damping
      }
      for (let i=0;i<pluckLen;i++) {
        const t = i / sr;
        const ampEnv = Math.exp(-4.2*t);
        const bright = Math.exp(-55*t); // very short bright click
        p[i] = p[i]*ampEnv + p[i]*0.4*bright;
      }
      // Normalize
      let pk=0; for (let i=0;i<pluckLen;i++) if (Math.abs(p[i])>pk) pk=Math.abs(p[i]); if (pk>0) { const g=0.95/pk; for (let i=0;i<pluckLen;i++) p[i]*=g; }
      this.buffers.pluck = pluck;

      // Wind loop (~12s) stereo, multi-layer fractal noise + gentle gusts
      const windDur = 12.0; const windLen = Math.floor(sr * windDur);
      const wind = this.context.createBuffer(2, windLen, sr);
      const wL = wind.getChannelData(0); const wR = wind.getChannelData(1);
      let l1=0,l2=0,l3=0, r1=0,r2=0,r3=0;
      for (let i=0;i<windLen;i++) {
        const t = i / sr;
        // base white
        const baseL = (rng()*2-1);
        const baseR = (rng()*2-1);
        // three smoothing layers (low, mid, high movement)
        l1 += 0.0025 * (baseL - l1);
        l2 += 0.015  * (baseL - l2);
        l3 += 0.06   * (baseL - l3);
        r1 += 0.0025 * (baseR - r1);
        r2 += 0.015  * (baseR - r2);
        r3 += 0.06   * (baseR - r3);
        // slow random gust shape (nested sines + slight jitter)
        const gust = 0.55 + 0.45 * Math.sin(t*0.07*2*Math.PI + Math.sin(t*0.011*2*Math.PI)*1.7);
        const shimmer = 0.12 * Math.sin(2*Math.PI* (0.3 + 0.02*Math.sin(t*0.17))* t);
        const baseMixL = (0.55*l1 + 0.32*l2 + 0.13*l3);
        const baseMixR = (0.55*r1 + 0.32*r2 + 0.13*r3);
        // gentle stereo decorrelation + slight high band difference
        wL[i] = (baseMixL + shimmer) * 0.36 * gust;
        wR[i] = (baseMixR - shimmer) * 0.36 * gust * (0.96 + 0.04*Math.sin(t*0.5));
      }
      this.buffers.wind = wind;

      // Pad loop (~8s) airy additive partials around A (220Hz) with subtle beating
      const padDur = 8.0; const padLen = Math.floor(sr * padDur);
      const pad = this.context.createBuffer(1, padLen, sr); const pd = pad.getChannelData(0);
      const base = 220;
      const partials = [1,2,3,4.2,5.1];
      for (let i=0;i<padLen;i++) {
        const t = i/sr;
        let v = 0;
        // layered slow envelopes for more organic drift
        const slowEnv = 0.45 + 0.25*Math.sin(2*Math.PI*0.045*t + 1.2) + 0.18*Math.sin(2*Math.PI*0.009*t + 0.4);
        for (let k=0;k<partials.length;k++) {
          const detune = 1 + (k===0?0:(rng()*0.002-0.001));
            v += Math.sin(2*Math.PI*base*partials[k]*detune*t + k*0.6) * (1/(partials[k]**1.2));
        }
        // gentle band-limit by soft low-pass shaping
        pd[i] = (v/partials.length) * 0.28 * slowEnv;
      }
  // Light normalization of pad to keep headroom
  let ppk=0; for (let i=0;i<padLen;i++) if (Math.abs(pd[i])>ppk) ppk=Math.abs(pd[i]); if (ppk>0.7) { const g=0.7/ppk; for (let i=0;i<padLen;i++) pd[i]*=g; }
  this.buffers.pad = pad;
      resolve();
    });
  }

  // Scheduling -----------------------------------------------------------
  _startScheduler() { if (this._schedulerId) return; this._schedulerId = setInterval(() => this._schedulerTick(), this.lookAhead*1000); }
  _stopScheduler() { if (this._schedulerId) { clearInterval(this._schedulerId); this._schedulerId = null; } }
  _schedulerTick() {
    if (!this.started) return;
    const currentTime = this.context.currentTime;
  if (this.droneDynamics) this._organicDroneMod(currentTime);
    // Occasional wind filter drift for organic motion
    if (currentTime - this._lastWindMod > 4 && this._voice.windFilter) {
      this._lastWindMod = currentTime;
      const targetFreq = 700 + this._rng()*900; // 700-1600 Hz
      const targetQ = 0.5 + this._rng()*0.9;
      const t = currentTime + 0.5;
      this._voice.windFilter.frequency.setTargetAtTime(targetFreq, t, 1.5);
      this._voice.windFilter.Q.setTargetAtTime(targetQ, t, 1.5);
    }
    while (this._nextNoteTime < currentTime + this.scheduleAheadTime) {
      this._scheduleStep(this._currentStep, this._nextNoteTime);
      this._advanceStep();
    }
  }
  _advanceStep() {
    const sixteenth = 60 / this.tempo / 4; // duration of one 16th
    this._nextNoteTime += sixteenth; // move time pointer
    this._currentStep = (this._currentStep + 1) % 16;
  }
  _scheduleStep(step, time) {
    const pattern = this._euclideanPattern(5,16); // cached? small cost fine
    if (!pattern[step]) return; // no pulse
    // Decide rest injection 10-20%
    const restProb = 0.10 + 0.10*this._rng();
    if (this._rng() < restProb) return;
    // Melody
    const noteInfo = this._nextNote();
    const durationSteps = 1 + Math.floor(this._rng()*3); // 1-3 sixteenths
    const sixteenth = 60 / this.tempo / 4;
    const dur = durationSteps * sixteenth * 0.9; // slightly shorter than grid
    this._playPluck(noteInfo.midi, time, dur, noteInfo.velocityDb);
  }

  _playPluck(midi, time, dur, velocityDb) {
    if (!this.buffers.pluck) return;
    const src = this.context.createBufferSource();
    src.buffer = this.buffers.pluck;
    const baseMidi = this._noteToMidi(this.root + '3'); // assume sample at root A3-ish
    const semitones = midi - baseMidi;
    src.playbackRate.value = Math.pow(2, semitones/12);

    const gain = this.context.createGain();
    const velLin = Math.pow(10, (velocityDb)/20);
    gain.gain.setValueAtTime(0.00001, time);
    gain.gain.linearRampToValueAtTime(velLin, time + 0.005);
    gain.gain.setTargetAtTime(0.00001, time + dur*0.3, 0.25); // smooth decay

    src.connect(gain); gain.connect(this._voice.pluckGain);
    src.start(time);
    src.stop(time + dur + 1.0);
  }

  _startPadAndWind(now) {
    // Pad root + fifth
    if (this.buffers.pad && !this._padRoot) {
      this._padRoot = this.context.createBufferSource();
      this._padRoot.buffer = this.buffers.pad; this._padRoot.loop = true;
      this._padRoot.connect(this._voice.padGain);
      this._padRoot.start(now);
      this._padFifth = this.context.createBufferSource();
      this._padFifth.buffer = this.buffers.pad; this._padFifth.loop = true;
      this._padFifth.playbackRate.value = Math.pow(2, 7/12); // fifth
      this._padFifth.connect(this._voice.padGain);
      this._padFifth.start(now + 0.05);
      // Slow filter LFO
      this._padLFOStart = now;
      if (!this._padLFO) this._padLFO = this._makeLFO(this._voice.padFilter.frequency, 0.15, 800, 1400);
      // Gentle vibrato via detune param (cents) if available
      if (this._padRoot.detune && !this._padVibrato) {
        const vibOsc = this.context.createOscillator(); vibOsc.frequency.value = 0.18; // slow
        const vibGain = this.context.createGain(); vibGain.gain.value = 4; // +/-4 cents
        vibOsc.connect(vibGain).connect(this._padRoot.detune);
        const vibOsc2 = this.context.createOscillator(); vibOsc2.frequency.value = 0.145; const vibGain2 = this.context.createGain(); vibGain2.gain.value = 3;
        vibOsc2.connect(vibGain2).connect(this._padFifth.detune);
        vibOsc.start(); vibOsc2.start();
        this._padVibrato = { vibOsc, vibGain, vibOsc2, vibGain2 };
      }
    }
    if (this.buffers.wind && !this._wind) {
      this._wind = this.context.createBufferSource();
      this._wind.buffer = this.buffers.wind; this._wind.loop = true;
      this._wind.connect(this._voice.windGain);
      this._wind.start(now + 0.02);
      if (!this._windLFO) this._windLFO = this._makeLFO(this._voice.windGain.gain, 0.07, 0.15, 0.28);
    }
  }
  _stopPadAndWind() {
    const t = this.context.currentTime;
    const fade = node => { if (!node) return; try { node.stop(t+0.1); } catch(e){} };
    fade(this._padRoot); fade(this._padFifth); fade(this._wind);
    this._padRoot = this._padFifth = this._wind = null;
    // LFOs continue harmlessly; could cancel but negligible CPU
  }

  // Melody generation ----------------------------------------------------
  _nextNote() {
    // Build combined scale with occasional color tones
    const useColor = this._rng() < 0.12; // <=15%
    const scale = useColor ? this._scale.concat(this._colorTones) : this._scale;
    // Constrained random walk
    let moveRand = this._rng();
    let newIndex = this._lastDegreeIndex;
    if (moveRand < 0.70) { // stepwise bias
      newIndex += (this._rng() < 0.5 ? -1 : 1);
    } else if (moveRand < 0.80) { // leap <=3 steps
      const leap = 2 + Math.floor(this._rng()*2); // 2 or 3
      newIndex += (this._rng() < 0.5 ? -leap : leap);
    } // else stay
    if (newIndex < 0) newIndex = 0; if (newIndex >= scale.length) newIndex = scale.length -1;
    this._lastDegreeIndex = newIndex;
    const noteName = scale[newIndex];

    // Map to midi within A3-A5 (48..69) choose an octave that keeps range
    const baseMidi = this._noteToMidi(noteName + '3');
    // Shift by 0,12,24 while in range
    let octaveShift = 0;
    const targetLow=48, targetHigh=69;
    if (baseMidi + 24 <= targetHigh && this._rng() < 0.25) octaveShift = 24; else if (baseMidi+12 <= targetHigh && this._rng()<0.5) octaveShift=12;
    let midi = baseMidi + octaveShift;
    if (midi < targetLow) midi = targetLow;
    if (midi > targetHigh) midi = targetHigh;

  // Slightly louder pluck window (-15..-9 dB)
  const velocityDb = -12 + (this._rng()*6 - 3); // -15..-9
    return { midi, velocityDb };
  }

  // Utilities ------------------------------------------------------------
  _euclideanPattern(pulses, steps) {
    // Simple Bjorklund algorithm (not optimized). For small numbers fine.
    let pattern = [];
    let counts = [];
    let remainders = [];
    let divisor = steps - pulses;
    remainders.push(pulses);
    let level = 0;
    while (true) {
      counts.push(Math.floor(divisor / remainders[level]));
      remainders.push(divisor % remainders[level]);
      divisor = remainders[level];
      level++;
      if (remainders[level] <= 1) break;
    }
    counts.push(divisor);
    const build = (lvl) => {
      if (lvl === -1) return [0];
      if (lvl === -2) return [1];
      let seq = [];
      for (let i=0;i<counts[lvl];i++) seq = seq.concat(build(lvl-1));
      if (remainders[lvl] !== 0) seq = seq.concat(build(lvl-2));
      return seq;
    };
    let seq = build(level);
    // Rotate to start with a hit
    while (seq[0] !== 1) seq.push(seq.shift());
    pattern = seq.slice(0, steps);
    return pattern.map(v => v===1);
  }

  _noteToMidi(note) {
    // note like A3, C#4
    const m = note.match(/^([A-G])(#|B|b)?(\d)$/i);
    if (!m) return 57; // A3 fallback
    const n = m[1].toUpperCase();
    let acc = m[2]||''; acc = acc.replace('b','B');
    const octave = parseInt(m[3]);
    const map = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
    let val = map[n];
    if (acc === '#') val +=1; else if (acc==='B') val -=1; // flat
    return (octave+1)*12 + val;
  }

  _makeImpulseResponse(seconds, decay) {
    const rate = this.context.sampleRate;
    const length = rate * seconds;
    const impulse = this.context.createBuffer(2, length, rate);
    for (let c=0;c<2;c++) {
      const ch = impulse.getChannelData(c);
      for (let i=0;i<length;i++) {
        const t = i/length;
        ch[i] = (Math.random()*2-1) * Math.pow(1 - t, decay);
      }
    }
    return impulse;
  }

  _makeLFO(param, freq, min, max) {
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.frequency.value = freq; gain.gain.value = (max-min)/2; // amplitude
    const offset = this.context.createConstantSource();
    offset.offset.value = (max+min)/2;
    osc.connect(gain).connect(param);
    offset.connect(param);
    osc.start(); offset.start();
    return { osc, gain, offset };
  }

  _updateMasterGain() { if (!this.masterGain) return; const target = this._masterTargetGain(); this.masterGain.gain.setTargetAtTime(target, this.context.currentTime, 0.05); }
  _masterTargetGain() { if (this._muted) return 0.00001; const base = Math.pow(10, this.masterGainDb/20); return Math.max(0.00001, base * this._userVolume); }
  _fadeMaster(from, to, time) { const now = this.context.currentTime; this.masterGain.gain.cancelScheduledValues(now); this.masterGain.gain.setValueAtTime(Math.max(0.00001, from), now); this.masterGain.gain.linearRampToValueAtTime(Math.max(0.00001,to), now + time); }

  _resumeContext() { if (this.context.state === 'suspended') return this.context.resume(); return Promise.resolve(); }
  _ensureContext() {
    if (!this.context) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.context = new AC({ latencyHint: 'interactive' });
      document.addEventListener('visibilitychange', () => this._handleVisibility());
      this._init();
    }
  }
  _attachGestureRetry() {
    const retry = () => { this.start(); window.removeEventListener('pointerdown', retry); window.removeEventListener('keydown', retry); window.removeEventListener('touchstart', retry); };
    window.addEventListener('pointerdown', retry, { once: true });
    window.addEventListener('keydown', retry, { once: true });
    window.addEventListener('touchstart', retry, { once: true });
  }
  _completeStart() {
    if (this.started) return;
    if (!this._ready) {
      const waiter = () => { if (this._ready) this._completeStart(); else requestAnimationFrame(waiter); };
      requestAnimationFrame(waiter); return;
    }
    this.started = true;
    const now = this.context.currentTime;
    this._nextNoteTime = now + 0.1;
    this._currentStep = 0;
    this._startPadAndWind(now);
    this._fadeMaster(0, this._masterTargetGain(), 0.4);
    this._startScheduler();
    this._fire('onstarted');
  }
  // Organic modulation for wind & pad to avoid robotic static timbre
  _organicDroneMod(now) {
    if (!this._nextDroneMod) this._nextDroneMod = 0;
    if (now < this._nextDroneMod) return;
    // run roughly every ~0.8-1.4s
    this._nextDroneMod = now + 0.8 + this._rng()*0.6;
    const r = this._rng;
    // Wind amplitude shaping (gusts / lulls)
    if (this._voice.windShape) {
      const g = this._voice.windShape.gain;
      const baseTarget = 0.7 + r()*0.5; // 0.7..1.2
      g.setTargetAtTime(baseTarget, now, 1.2 + r()*0.6);
      // occasional quick lull dip
      if (r() < 0.12) {
        const lullAt = now + 0.3 + r()*0.4;
        g.setTargetAtTime(0.3 + r()*0.15, lullAt, 0.4);
        g.setTargetAtTime(baseTarget, lullAt + 1.2 + r(), 1.0 + r()*0.8);
      }
      // occasional soft gust swell
      if (r() < 0.10) {
        const gustAt = now + 0.15 + r()*0.3;
        g.setTargetAtTime(1.3 + r()*0.4, gustAt, 0.25);
        g.setTargetAtTime(baseTarget, gustAt + 0.9 + r()*0.6, 1.2 + r()*0.5);
      }
    }
    // Wind stereo movement
    if (this._voice.windPan) {
      const panParam = this._voice.windPan.pan;
      const dest = (r()*2 - 1) * 0.5; // -0.5..0.5
      try { panParam.setTargetAtTime(dest, now, 2.5 + r()*1.5); } catch(e){}
    }
    // Pad slow breathing amplitude & subtle filter jitter
    if (this._voice.padGain) {
      const pg = this._voice.padGain.gain;
      const base = 0.15;
      const dest = base * (0.75 + r()*0.6); // ~0.11..0.24
      pg.setTargetAtTime(dest, now, 2.5 + r()*2.0);
    }
    if (this._voice.padFilter) {
      const pf = this._voice.padFilter.frequency;
      const newF = 1500 + r()*700; // wander 1500-2200
      pf.setTargetAtTime(newF, now + 0.2, 3.0 + r()*1.5);
    }
  }
  _handleVisibility() { if (document.hidden) { if (this.started) { this._suspendedByPage = true; this.context.suspend(); } } else { if (this._suspendedByPage) { this._suspendedByPage = false; this._resumeContext(); } } }

  _normalizeSeed(seed) { if (typeof seed === 'number') return seed >>> 0; if (typeof seed === 'string') { let h=2166136261>>>0; for (let i=0;i<seed.length;i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); } return h>>>0; } return Math.floor(Math.random()*0xFFFFFFFF); }
  _makeRng(seed) { let s = seed>>>0; return function() { // xorshift32
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s>>>0) / 4294967296); }; }

  _fire(name) { try { const cb = this[name]; if (typeof cb === 'function') cb(); } catch(e) { this._fireError(e); } }
  _fireError(err) { if (this.onerror) try { this.onerror(err); } catch(e){} }
}
