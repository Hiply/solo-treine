/* ===================== SYSTEM MUSIC // MÚSICA DE FUNDO ===================== */
/* Música contínua em todo o sistema, com fade-in suave e respeito ao botão    */
/* de som. Se o navegador bloquear o autoplay, o primeiro toque libera o áudio. */
(function (global) {
  'use strict';

  const TRACK = 'assets/musica_de_fundo.mp3';
  const BUTTON_TRACK = 'assets/zelda_botw.mp3';
  const VOLUME = 0.24;
  const BUTTON_VOLUME = 0.38;

  let audio = null;
  let buttonAudio = null;
  let enabled = true;
  let fadeTimer = null;
  let started = false;

  function createAudio() {
    if (audio) return audio;
    audio = new Audio(TRACK);
    audio.loop = true;
    audio.volume = 0;
    audio.preload = 'auto';

    buttonAudio = new Audio(BUTTON_TRACK);
    buttonAudio.preload = 'auto';
    buttonAudio.volume = BUTTON_VOLUME;
    buttonAudio.playbackRate = 1.12;
    return audio;
  }

  function fadeIn() {
    if (!audio) return;
    clearInterval(fadeTimer);
    audio.volume = 0;
    const step = VOLUME / 28;
    fadeTimer = setInterval(() => {
      if (!audio || audio.paused) {
        clearInterval(fadeTimer);
        fadeTimer = null;
        return;
      }
      audio.volume = Math.min(VOLUME, audio.volume + step);
      if (audio.volume >= VOLUME) {
        clearInterval(fadeTimer);
        fadeTimer = null;
      }
    }, 70);
  }

  function play() {
    if (!enabled) return;
    const track = createAudio();
    if (!track.paused) return;
    const attempt = track.play();
    if (attempt && attempt.then) {
      attempt.then(() => {
        started = true;
        fadeIn();
      }).catch(() => { /* autoplay bloqueado: o primeiro gesto tenta de novo */ });
    } else {
      started = true;
      fadeIn();
    }
  }

  function pause() {
    if (!audio) return;
    clearInterval(fadeTimer);
    fadeTimer = null;
    if (!audio.paused) audio.pause();
  }

  function setEnabled(value) {
    enabled = !!value;
    if (enabled) play();
    else pause();
    updateButtons();
  }

  function toggle() {
    setEnabled(!enabled);
    return enabled;
  }

  function playButton() {
    if (!enabled) return;
    createAudio();
    try {
      buttonAudio.currentTime = 0;
      const attempt = buttonAudio.play();
      if (attempt && attempt.catch) attempt.catch(() => {});
    } catch (err) { /* ignora */ }
  }

  function updateButtons() {
    const label = enabled ? '♪ MÚSICA: ON' : '♪ MÚSICA: OFF';
    document.querySelectorAll('[data-music-toggle]').forEach(btn => {
      btn.textContent = label;
      btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    });
  }

  function readSavedPreference() {
    try {
      const session = JSON.parse(localStorage.getItem('system-auth-session') || 'null');
      const key = 'system-training-v3' + (session && session.email ? ':user:' + session.email : '');
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const state = JSON.parse(raw);
      if (state && state.settings && typeof state.settings.sound === 'boolean') return state.settings.sound;
    } catch (err) { /* ignora */ }
    return null;
  }

  function init() {
    createAudio();
    const saved = readSavedPreference();
    const appState = global.__systemApp && global.__systemApp.state;
    enabled = appState && appState.settings && typeof appState.settings.sound === 'boolean'
      ? !!appState.settings.sound
      : (saved === null ? true : saved);
    updateButtons();
    play();

    // Autoplay bloqueado? Qualquer gesto libera a música.
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev => {
      global.addEventListener(ev, () => { if (enabled) play(); }, { passive: true });
    });

    // O botão de som do sistema (app.js) avisa a música.
    global.addEventListener('system:sound', event => {
      setEnabled(event && event.detail ? event.detail.enabled : true);
    });

    // Som de seleção da tela de acesso (mesmo arquivo do projeto original).
    document.addEventListener('click', event => {
      // auth.js é o único responsável por alternar a música e atualizar o rótulo.
      // Não alternar aqui também: o listener de captura e o listener do botão causavam
      // dois toggles no mesmo clique, anulando a mudança.
      if (event.target.closest('[data-music-toggle]')) return;
      if (event.target.closest('.auth-card button')) playButton();
    }, true);

    document.addEventListener('visibilitychange', () => {
      if (!audio) return;
      if (document.hidden) {
        if (!audio.paused) audio.pause();
      } else if (enabled) {
        play();
      }
    });
  }

  global.SystemMusic = {
    play,
    pause,
    toggle,
    playButton,
    setEnabled,
    isEnabled: () => enabled,
    isPlaying: () => !!(audio && !audio.paused),
    isStarted: () => started
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
