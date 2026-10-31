/* ===================== SYSTEM SOUND // ÁUDIO SINTETIZADO (SEM ARQUIVOS) ===================== */
/* Gera todos os efeitos via Web Audio API. Funciona offline, sem baixar assets.            */
(function (global) {
  'use strict';

  const AudioCtx = global.AudioContext || global.webkitAudioContext;
  let ctx = null;
  let master = null;
  let enabled = true;
  let voiceEnabled = true;
  let unlocked = false;
  let lastPlay = {};
  const listeners = [];

  function ensureCtx() {
    if (!AudioCtx) return null;
    if (!ctx) {
      try {
        ctx = new AudioCtx();
        master = ctx.createGain();
        master.gain.value = 0.18;
        master.connect(ctx.destination);
      } catch (err) {
        console.warn('Áudio indisponível:', err);
        return null;
      }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    const c = ensureCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }

  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => {
    global.addEventListener(ev, unlock, { passive: true });
  });

  function tone(opts) {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    const o = opts || {};
    const freq = o.freq || 440;
    const dur = o.dur || 0.12;
    const when = o.when || 0;
    const gain = o.gain === undefined ? 0.5 : o.gain;
    const type = o.type || 'sine';
    const t0 = c.currentTime + when;

    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function noise(dur, gain) {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    const size = Math.floor(c.sampleRate * (dur || 0.05));
    const buffer = c.createBuffer(1, size, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
    const src = c.createBufferSource();
    const g = c.createGain();
    g.gain.value = gain === undefined ? 0.12 : gain;
    src.buffer = buffer;
    src.connect(g);
    g.connect(master);
    src.start();
  }

  const PRESETS = {
    boot: () => {
      tone({ freq: 180, slideTo: 720, dur: 0.55, type: 'triangle', gain: 0.28 });
      tone({ freq: 523.25, dur: 0.18, when: 0.35, type: 'sine', gain: 0.32 });
      tone({ freq: 783.99, dur: 0.30, when: 0.45, type: 'sine', gain: 0.26 });
    },
    click: () => {
      tone({ freq: 1180, dur: 0.028, type: 'square', gain: 0.10 });
      tone({ freq: 1560, dur: 0.02, when: 0.02, type: 'square', gain: 0.06 });
    },
    confirm: () => {
      tone({ freq: 660, dur: 0.07, type: 'triangle', gain: 0.22 });
      tone({ freq: 990, dur: 0.10, when: 0.06, type: 'triangle', gain: 0.22 });
    },
    toast: () => {
      tone({ freq: 740, slideTo: 920, dur: 0.10, type: 'sine', gain: 0.18 });
    },
    xp: () => {
      tone({ freq: 880, dur: 0.06, type: 'sine', gain: 0.20 });
      tone({ freq: 1108.73, dur: 0.06, when: 0.055, type: 'sine', gain: 0.20 });
      tone({ freq: 1318.51, dur: 0.10, when: 0.11, type: 'sine', gain: 0.20 });
    },
    levelup: () => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        tone({ freq: f, dur: 0.18, when: i * 0.10, type: 'triangle', gain: 0.30 });
      });
      tone({ freq: 1046.5, dur: 0.5, when: 0.42, type: 'sine', gain: 0.22 });
      tone({ freq: 1318.51, dur: 0.5, when: 0.42, type: 'sine', gain: 0.16 });
    },
    rankup: () => {
      [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        tone({ freq: f, dur: 0.22, when: i * 0.12, type: 'sawtooth', gain: 0.18 });
        tone({ freq: f * 2, dur: 0.22, when: i * 0.12, type: 'sine', gain: 0.12 });
      });
      noise(0.35, 0.05);
    },
    quest: () => {
      tone({ freq: 659.25, dur: 0.09, type: 'triangle', gain: 0.24 });
      tone({ freq: 880, dur: 0.09, when: 0.08, type: 'triangle', gain: 0.24 });
      tone({ freq: 1174.66, dur: 0.16, when: 0.16, type: 'triangle', gain: 0.24 });
    },
    achievement: () => {
      [783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => {
        tone({ freq: f, dur: 0.13, when: i * 0.085, type: 'sine', gain: 0.24 });
      });
      noise(0.12, 0.04);
    },
    penalty: () => {
      tone({ freq: 220, dur: 0.18, type: 'sawtooth', gain: 0.20 });
      tone({ freq: 174.61, dur: 0.20, when: 0.16, type: 'sawtooth', gain: 0.20 });
      tone({ freq: 130.81, dur: 0.34, when: 0.32, type: 'sawtooth', gain: 0.20 });
    },
    gate: () => {
      tone({ freq: 320, slideTo: 1200, dur: 0.42, type: 'sine', gain: 0.20 });
      tone({ freq: 640, slideTo: 2400, dur: 0.42, type: 'triangle', gain: 0.10 });
      noise(0.18, 0.05);
    },
    trial: () => {
      tone({ freq: 130.81, dur: 0.5, type: 'sawtooth', gain: 0.16 });
      tone({ freq: 196, dur: 0.5, type: 'sawtooth', gain: 0.14 });
      tone({ freq: 261.63, slideTo: 523.25, dur: 0.7, when: 0.2, type: 'triangle', gain: 0.18 });
    },
    gpsStart: () => {
      tone({ freq: 440, slideTo: 880, dur: 0.24, type: 'sine', gain: 0.22 });
      tone({ freq: 1320, dur: 0.08, when: 0.22, type: 'sine', gain: 0.16 });
    },
    gpsStop: () => {
      tone({ freq: 660, slideTo: 330, dur: 0.28, type: 'sine', gain: 0.22 });
    },
    error: () => {
      tone({ freq: 196, dur: 0.12, type: 'square', gain: 0.16 });
      tone({ freq: 146.83, dur: 0.18, when: 0.13, type: 'square', gain: 0.16 });
    },
    ai: () => {
      [523.25, 783.99, 1046.5, 1318.51].forEach((f, i) => {
        tone({ freq: f, dur: 0.16, when: i * 0.07, type: 'sine', gain: 0.16 });
      });
      tone({ freq: 1567.98, dur: 0.35, when: 0.28, type: 'sine', gain: 0.10 });
    },
    timer: () => {
      tone({ freq: 1000, dur: 0.04, type: 'square', gain: 0.08 });
    }
  };

  function play(name) {
    if (!enabled) return;
    const preset = PRESETS[name];
    if (!preset) return;
    const now = Date.now();
    if (lastPlay[name] && now - lastPlay[name] < 70) return;
    lastPlay[name] = now;
    try { preset(); } catch (err) { /* áudio nunca deve quebrar o app */ }
  }

  function speak(text) {
    if (!enabled || !voiceEnabled || !text || !('speechSynthesis' in global)) return;
    try {
      const synth = global.speechSynthesis;
      const utter = new SpeechSynthesisUtterance(String(text));
      utter.lang = 'pt-BR';
      utter.rate = 1.02;
      utter.pitch = 0.82;
      utter.volume = 0.95;
      const voices = synth.getVoices ? synth.getVoices() : [];
      const pt = voices.find(v => /pt[-_]BR/i.test(v.lang)) || voices.find(v => /^pt/i.test(v.lang));
      if (pt) utter.voice = pt;
      synth.cancel();
      synth.speak(utter);
    } catch (err) { /* ignora */ }
  }

  function attachClicks() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      if (btn.id === 'soundBtn') return;
      // A tela de acesso tem som próprio (zelda_botw.mp3), sem duplicar o clique sintetizado.
      if (btn.closest('.auth-card')) return;
      play(btn.classList.contains('primary-btn') ? 'confirm' : 'click');
    }, true);
  }

  global.SystemSound = {
    play,
    speak,
    unlock,
    setEnabled(v) {
      enabled = !!v;
      if (enabled) unlock();
      try {
        global.dispatchEvent(new CustomEvent('system:sound', { detail: { enabled } }));
      } catch (err) { /* ignora */ }
    },
    setVoice(v) { voiceEnabled = !!v; },
    isEnabled() { return enabled; },
    attachClicks
  };

  attachClicks();
})(typeof window !== 'undefined' ? window : globalThis);
