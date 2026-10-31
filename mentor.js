/* ===================== MENTOR // ACOMPANHAMENTO REAL DE ESTUDOS E TREINOS ===================== */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = value => (window.SystemAI ? window.SystemAI.escapeHtml(value) : String(value == null ? '' : value));

  let timer = { running: false, startedAt: 0, accumulated: 0, interval: null };

  function fmtClock(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function fmtDate(value) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  function typeLabel(type) {
    if (type === 'study') return 'ESTUDO';
    if (type === 'run') return 'CORRIDA';
    return 'TREINO';
  }

  function currentAnalysis() {
    if (!window.SystemAI) return null;
    return window.SystemAI.analyze(state);
  }

  /* ---------- Render ---------- */
  function render() {
    if (!window.SystemAI) return;
    const analysis = currentAnalysis();
    if (!analysis) return;
    renderScores(analysis);
    renderNarrative(analysis);
    renderInsights(analysis);
    renderPlan(analysis);
    renderSessions();
    renderCheckin();
    renderMini(analysis);
    refreshProviderLabel();
  }

  function renderScores(analysis) {
    const map = {
      scoreReadiness: analysis.scores.readiness,
      scoreStudy: analysis.scores.study,
      scoreTraining: analysis.scores.training,
      scoreBalance: analysis.scores.balance
    };
    Object.keys(map).forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const value = map[id];
      el.style.setProperty('--val', String(value));
      el.classList.toggle('low', value < 50);
      el.classList.toggle('mid', value >= 50 && value < 75);
      el.classList.toggle('high', value >= 75);
      const b = el.querySelector('b');
      if (b) b.textContent = String(value);
    });
  }

  function renderNarrative(analysis) {
    const box = $('#aiNarrative');
    if (!box) return;
    const ai = state.ai || {};
    const hasAI = !!(ai.lastNarrative && ai.lastNarrative.trim());
    const text = hasAI ? ai.lastNarrative : analysis.summary;
    box.innerHTML = window.SystemAI.renderRichText(text);
    const meta = $('#aiGeneratedAt');
    if (meta) {
      const when = hasAI && ai.lastAt ? new Date(ai.lastAt) : new Date(analysis.generatedAt);
      meta.textContent = `${hasAI ? 'IA generativa' : 'Análise local'} · ${when.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    }
  }

  function renderInsights(analysis) {
    const box = $('#aiInsights');
    if (!box) return;
    if (!analysis.insights.length) {
      box.innerHTML = '<p class="muted-note">Sem dados suficientes. Registre uma sessão para o Sistema detectar padrões.</p>';
      return;
    }
    box.innerHTML = analysis.insights.map(item => `
      <div class="insight ${esc(item.severity)}">
        <h4>${esc(item.title)}</h4>
        <p>${esc(item.text)}</p>
      </div>`).join('');
  }

  function renderPlan(analysis) {
    const box = $('#aiPlan');
    if (!box) return;
    box.innerHTML = analysis.plan.map(day => `
      <div class="plan-day ${day.rest ? 'rest' : ''}">
        <b>${esc(day.label)}</b>
        <div>
          <span>${esc(day.study)}</span>
          <small>${esc(day.training)}</small>
        </div>
      </div>`).join('');
  }

  function renderSessions() {
    const box = $('#sessionList');
    if (!box) return;
    const all = Array.isArray(state.sessions) ? state.sessions : [];
    const list = all.slice().sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 12);
    const counter = $('#sessionCount');
    if (counter) counter.textContent = String(all.length);

    if (!list.length) {
      box.innerHTML = '<p class="muted-note">Nenhuma sessão registrada ainda. Use o formulário de registro real para começar o acompanhamento.</p>';
      return;
    }

    box.innerHTML = list.map(s => `
      <div class="session-row">
        <span class="session-type ${esc(s.type)}">${typeLabel(s.type)}</span>
        <span class="session-date">${fmtDate(s.at)}</span>
        <strong>${esc(s.type === 'study' ? (s.subject || 'Geral') : (s.activity || 'Treino'))}${s.type === 'study' && s.topic ? ' · ' + esc(s.topic) : ''}</strong>
        <span>${Number(s.minutes) || 0} min</span>
        <span>${s.type === 'study' ? 'foco ' + (s.focus || 3) + '/5' : 'int. ' + (s.intensity || 3) + '/5'}</span>
        <span class="session-xp">+${Number(s.xp) || 0} XP</span>
        <button class="icon-btn session-del" data-del-session="${esc(s.id)}" title="Remover sessão">✕</button>
      </div>`).join('');
  }

  function renderCheckin() {
    const checkin = (state.checkins || {})[today()];
    const sleep = $('#checkinSleep');
    const mood = $('#checkinMood');
    const energy = $('#checkinEnergy');
    if (sleep && document.activeElement !== sleep) sleep.value = checkin && checkin.sleep != null ? checkin.sleep : '';
    if (mood && document.activeElement !== mood) mood.value = checkin && checkin.mood ? String(checkin.mood) : '3';
    if (energy && document.activeElement !== energy) energy.value = checkin && checkin.energy ? String(checkin.energy) : '3';
  }

  function renderMini(analysis) {
    const score = $('#miniReadiness');
    const bar = $('#miniReadinessBar');
    const insight = $('#miniInsight');
    if (score) score.textContent = `${analysis.scores.readiness}/100`;
    if (bar) bar.style.width = `${analysis.scores.readiness}%`;
    if (insight) {
      const urgent = analysis.insights.find(i => i.severity === 'risk') ||
        analysis.insights.find(i => i.severity === 'warn') ||
        analysis.insights.find(i => i.severity === 'good') ||
        analysis.insights[0];
      insight.textContent = urgent ? `${urgent.title}: ${urgent.text}` : 'Registre sono, estudo e treino para receber a análise.';
    }
  }

  async function refreshProviderLabel() {
    const el = $('#aiProviderLabel');
    if (!el || !window.SystemAI) return;
    try {
      const info = await window.SystemAI.getProviderInfo();
      el.textContent = String(info.label || 'LOCAL (OFFLINE)').toUpperCase();
      el.className = 'status-pill' + (info.mode === 'local' ? '' : ' ok');
    } catch (err) {
      el.textContent = 'LOCAL (OFFLINE)';
      el.className = 'status-pill';
    }
  }

  /* ---------- Registro real ---------- */
  function saveSession(data) {
    if (!data || !data.minutes) return;
    const now = new Date();
    const entry = {
      id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      at: now.toISOString(),
      date: window.SystemAI.localDateKey(now),
      type: data.type,
      minutes: data.minutes,
      intensity: data.intensity || 3,
      focus: data.focus || 3,
      subject: data.subject || '',
      topic: data.topic || '',
      activity: data.activity || '',
      notes: data.notes || ''
    };
    entry.xp = entry.type === 'study'
      ? Math.max(5, Math.round(entry.minutes * 2 + (entry.focus - 3) * 4))
      : Math.max(5, Math.round(entry.minutes * 3 * (entry.intensity / 3)));

    state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
    state.sessions.push(entry);
    state.sessions = state.sessions.slice(-2000);

    if (typeof addXp === 'function') addXp(entry.xp);
    if (entry.type === 'study' && typeof getMissionDeck === 'function' && typeof advanceDailyMission === 'function') {
      const mission = getMissionDeck().find(item => item.kind === 'study');
      if (mission && !mission.completed) advanceDailyMission(mission.id, entry.minutes);
    }
    if (typeof updateStreak === 'function') updateStreak();
    if (typeof checkAchievements === 'function') checkAchievements();
    save();
    updateUI();
    window.SystemSound?.play('xp');
    showToast('SESSÃO REGISTRADA', `${typeLabel(entry.type)} • ${entry.minutes} min • +${entry.xp} XP`);
    log(`Sessão real registrada: ${typeLabel(entry.type)} ${entry.minutes} min (+${entry.xp} XP).`, 'MENTOR');
  }

  function handleSessionSubmit(event) {
    event.preventDefault();
    const type = $('#sessionType').value;
    const minutes = Math.round(Number($('#sessionMinutes').value));
    if (!minutes || minutes < 1 || minutes > 600) {
      showToast('DADOS INCOMPLETOS', 'Informe uma duração entre 1 e 600 minutos.');
      return;
    }
    const subject = ($('#sessionSubject').value || '').trim();
    const topic = ($('#sessionTopic').value || '').trim();
    const activity = $('#sessionActivity').value;
    const focus = Number($('#sessionFocus').value) || 3;
    const intensity = Number($('#sessionIntensity').value) || 3;
    const notes = ($('#sessionNotes').value || '').trim();

    saveSession({
      type,
      minutes,
      subject: type === 'study' ? (subject || 'Geral') : '',
      topic: type === 'study' ? topic : '',
      activity: type === 'workout' ? activity : '',
      focus,
      intensity,
      notes
    });

    const form = $('#sessionForm');
    if (form) form.reset();
    toggleSessionType();
    updateRangeLabels();
    $('#sessionMinutes')?.focus();
  }

  function deleteSession(id) {
    if (!id) return;
    if (!window.confirm('Remover esta sessão do histórico? O XP já conquistado não será retirado.')) return;
    state.sessions = (state.sessions || []).filter(item => item.id !== id);
    save();
    updateUI();
    window.SystemSound?.play('confirm');
    showToast('HISTÓRICO', 'Sessão removida do acompanhamento.');
  }

  function handleCheckinSubmit(event) {
    event.preventDefault();
    const sleep = Number($('#checkinSleep').value);
    if (!(sleep > 0 && sleep <= 14)) {
      showToast('CHECK-IN', 'Informe as horas de sono (0–14).');
      return;
    }
    const date = today();
    state.checkins = state.checkins || {};
    state.checkins[date] = {
      sleep,
      mood: Number($('#checkinMood').value) || 3,
      energy: Number($('#checkinEnergy').value) || 3,
      at: new Date().toISOString()
    };
    save();
    updateUI();
    window.SystemSound?.play('confirm');
    showToast('CHECK-IN REGISTRADO', `${sleep}h de sono • humor ${state.checkins[date].mood}/5 • energia ${state.checkins[date].energy}/5`);
    log(`Check-in: ${sleep}h de sono, humor ${state.checkins[date].mood}/5, energia ${state.checkins[date].energy}/5.`, 'MENTOR');
  }

  function toggleSessionType() {
    const type = $('#sessionType') ? $('#sessionType').value : 'study';
    $$('[data-study-only]').forEach(el => { el.hidden = type !== 'study'; });
    $$('[data-workout-only]').forEach(el => { el.hidden = type !== 'workout'; });
  }

  function updateRangeLabels() {
    const focus = $('#sessionFocus');
    const intensity = $('#sessionIntensity');
    if (focus) $('#sessionFocusLabel').textContent = `${focus.value}/5`;
    if (intensity) $('#sessionIntensityLabel').textContent = `${intensity.value}/5`;
  }

  /* ---------- Cronômetro ---------- */
  function timerSeconds() {
    return Math.floor((timer.accumulated + (timer.running ? Date.now() - timer.startedAt : 0)) / 1000);
  }
  function timerTick() {
    const display = $('#timerDisplay');
    if (display) display.textContent = fmtClock(timerSeconds());
  }
  function startTimer() {
    if (timer.running) return;
    timer.running = true;
    timer.startedAt = Date.now();
    timer.interval = setInterval(timerTick, 1000);
    timerTick();
    window.SystemSound?.play('confirm');
  }
  function pauseTimer() {
    if (!timer.running) return;
    timer.accumulated += Date.now() - timer.startedAt;
    timer.running = false;
    clearInterval(timer.interval);
    timer.interval = null;
    timerTick();
  }
  function resetTimer() {
    clearInterval(timer.interval);
    timer = { running: false, startedAt: 0, accumulated: 0, interval: null };
    timerTick();
  }
  function useTimer() {
    const minutes = Math.max(1, Math.round(timerSeconds() / 60));
    const input = $('#sessionMinutes');
    if (input) input.value = String(minutes);
    showToast('CRONÔMETRO', `${minutes} min aplicados ao registro.`);
    window.SystemSound?.play('confirm');
  }

  /* ---------- IA ---------- */
  async function analyzeWithAI() {
    if (!window.SystemAI) return;
    const button = $('#aiAnalyzeBtn');
    const box = $('#aiNarrative');
    if (!button || !box) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'CONSULTANDO O MENTOR…';
    box.innerHTML = '<p class="muted-note">O Mentor está cruzando sono, carga de treino, foco e histórico real…</p>';

    try {
      const analysis = currentAnalysis();
      const text = await window.SystemAI.requestAI(analysis, state, window.SystemAI.getConfig());
      state.ai = state.ai || {};
      state.ai.lastNarrative = text;
      state.ai.lastAt = Date.now();
      save();
      renderNarrative(analysis);
      window.SystemSound?.play('ai');
      showToast('MENTOR IA', 'Análise generativa concluída com base nos seus dados reais.');
    } catch (err) {
      const analysis = currentAnalysis();
      state.ai = state.ai || {};
      state.ai.lastNarrative = '';
      const errorMessage = err && err.message ? err.message : 'Falha ao consultar o provedor.';
      const setupNeeded = errorMessage.includes('Nenhum provedor externo configurado');
      const notice = setupNeeded
        ? `<div class="ai-unconfigured"><b>O Mentor está no modo local</b><p>${esc(errorMessage)}</p><button class="tool-btn" type="button" data-ai-open-settings>Configurar IA gratuita</button></div>`
        : `<div class="ai-error"><b>IA EXTERNA INDISPONÍVEL</b><p>${esc(errorMessage)}</p><p>Mostrando a análise local — ela continua funcionando offline e usa os mesmos dados.</p></div>`;
      box.innerHTML = notice + window.SystemAI.renderRichText(analysis.summary);
      box.querySelector('[data-ai-open-settings]')?.addEventListener('click', openSettings);
      window.SystemSound?.play('error');
      showToast('MENTOR IA', 'Provedor externo indisponível. Análise local exibida.');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function useLocalAnalysis() {
    const analysis = currentAnalysis();
    state.ai = state.ai || {};
    state.ai.lastNarrative = '';
    state.ai.lastAt = 0;
    save();
    renderNarrative(analysis);
    window.SystemSound?.play('confirm');
    showToast('ANÁLISE LOCAL', 'Diagnóstico recalculado com os dados mais recentes.');
  }

  /* ---------- Configuração da IA ---------- */
  function fillSettings() {
    const cfg = window.SystemAI.getConfig();
    const preset = $('#aiPreset');
    if (preset) preset.value = cfg.preset || 'groq';
    if ($('#aiBaseUrl')) $('#aiBaseUrl').value = cfg.baseUrl || '';
    if ($('#aiModel')) $('#aiModel').value = cfg.model || '';
    if ($('#aiApiKey')) $('#aiApiKey').value = cfg.apiKey || '';
    const msg = $('#aiSettingsMsg');
    if (msg) msg.textContent = '';
  }

  function openSettings() {
    fillSettings();
    $('#aiSettingsModal')?.classList.add('open');
  }
  function closeSettings() {
    $('#aiSettingsModal')?.classList.remove('open');
  }

  function applyPreset() {
    const preset = $('#aiPreset').value;
    const data = window.SystemAI.PRESETS[preset];
    if (!data) return;
    if (preset === 'server') {
      $('#aiBaseUrl').value = '';
      $('#aiModel').value = '';
      return;
    }
    $('#aiBaseUrl').value = data.baseUrl;
    $('#aiModel').value = data.model;
  }

  function readSettings() {
    return {
      preset: $('#aiPreset').value,
      baseUrl: $('#aiBaseUrl').value,
      model: $('#aiModel').value,
      apiKey: $('#aiApiKey').value,
      temperature: 0.5
    };
  }

  function saveSettings(showMessage) {
    const cfg = window.SystemAI.saveConfig(readSettings());
    refreshProviderLabel();
    if (showMessage) {
      const msg = $('#aiSettingsMsg');
      if (msg) msg.textContent = cfg.apiKey || cfg.preset === 'server' || cfg.preset === 'ollama'
        ? 'Configuração salva neste navegador.'
        : 'Configuração salva. Sem chave, o app usa a análise local (offline).';
      showToast('MENTOR IA', 'Configuração salva.');
      window.SystemSound?.play('confirm');
    }
    return cfg;
  }

  async function testSettings() {
    const msg = $('#aiSettingsMsg');
    if (msg) msg.textContent = 'Testando conexão…';
    const cfg = saveSettings(false);
    const result = await window.SystemAI.testConnection(cfg);
    if (msg) {
      msg.textContent = result.message;
      msg.className = 'muted-note ' + (result.ok ? 'ok' : 'error');
    }
    window.SystemSound?.play(result.ok ? 'confirm' : 'error');
  }

  function clearSettings() {
    window.SystemAI.clearConfig();
    fillSettings();
    refreshProviderLabel();
    const msg = $('#aiSettingsMsg');
    if (msg) {
      msg.textContent = 'Chave removida. O app voltou para a análise local (offline).';
      msg.className = 'muted-note';
    }
    window.SystemSound?.play('confirm');
  }

  /* ---------- Navegação ---------- */
  function openMentorTab() {
    const tab = document.querySelector('.tab[data-tab="mentor"]');
    if (tab) tab.click();
  }

  /* ---------- Bind ---------- */
  function bind() {
    $('#sessionType')?.addEventListener('change', toggleSessionType);
    $('#sessionFocus')?.addEventListener('input', updateRangeLabels);
    $('#sessionIntensity')?.addEventListener('input', updateRangeLabels);
    $('#sessionForm')?.addEventListener('submit', handleSessionSubmit);
    $('#checkinForm')?.addEventListener('submit', handleCheckinSubmit);
    $('#sessionList')?.addEventListener('click', event => {
      const button = event.target.closest('[data-del-session]');
      if (button) deleteSession(button.dataset.delSession);
    });

    $('#timerStartBtn')?.addEventListener('click', startTimer);
    $('#timerPauseBtn')?.addEventListener('click', pauseTimer);
    $('#timerResetBtn')?.addEventListener('click', resetTimer);
    $('#timerUseBtn')?.addEventListener('click', useTimer);

    $('#aiAnalyzeBtn')?.addEventListener('click', analyzeWithAI);
    $('#aiLocalBtn')?.addEventListener('click', useLocalAnalysis);
    $('#aiSettingsBtn')?.addEventListener('click', openSettings);
    $('#aiSettingsCloseBtn')?.addEventListener('click', closeSettings);
    $('#aiSettingsModal')?.addEventListener('click', event => {
      if (event.target.id === 'aiSettingsModal') closeSettings();
    });
    $('#aiPreset')?.addEventListener('change', applyPreset);
    $('#aiSaveBtn')?.addEventListener('click', () => saveSettings(true));
    $('#aiTestBtn')?.addEventListener('click', testSettings);
    $('#aiClearBtn')?.addEventListener('click', clearSettings);
    $('#miniMentorBtn')?.addEventListener('click', openMentorTab);

    toggleSessionType();
    updateRangeLabels();
    timerTick();
  }

  function init() {
    if (!window.SystemAI) return;
    bind();
    render();
  }

  window.SystemMentor = {
    init,
    render,
    openMentorTab,
    openSettings,
    analyzeWithAI,
    useLocalAnalysis,
    saveSession
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
