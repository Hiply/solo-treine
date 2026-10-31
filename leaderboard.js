/* ===================== LEADERBOARD // RANKING GLOBAL ===================== */
/* Ranking real entre contas na nuvem (tabela pública `leaderboard` do Supabase).  */
/* Sem nuvem configurada, mostra uma simulação local claramente identificada para  */
/* validar a interface — nenhum dado simulado é enviado para lugar nenhum.          */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const esc = value => (window.SystemAI
    ? window.SystemAI.escapeHtml(value)
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch])));

  const DEMO_RIVALS = [
    { name: 'CAÇADOR NOTURNO', xp: 4200, levelOffset: 7, streak: 21, study: 460, training: 280 },
    { name: 'LÂMINA DE AÇO', xp: 3150, levelOffset: 5, streak: 14, study: 380, training: 240 },
    { name: 'SOMBRA ETERNA', xp: 2280, levelOffset: 3, streak: 11, study: 320, training: 190 },
    { name: 'MENTE TÁTICA', xp: 1640, levelOffset: 2, streak: 8, study: 290, training: 150 },
    { name: 'CORREDOR FANTASMA', xp: 1120, levelOffset: 1, streak: 6, study: 180, training: 210 },
    { name: 'ESCUDEIRO', xp: 720, levelOffset: 0, streak: 4, study: 150, training: 120 },
    { name: 'APRENDIZ', xp: 430, levelOffset: -1, streak: 2, study: 90, training: 70 },
    { name: 'NÔMADE', xp: 210, levelOffset: -2, streak: 1, study: 45, training: 35 }
  ];

  let entries = [];
  let mode = 'local';
  let syncing = false;
  let syncTimer = null;
  let suppressSchedule = false;
  let lastRefreshAt = 0;

  function getState() {
    return window.__systemApp && window.__systemApp.state ? window.__systemApp.state : null;
  }

  function rankName(level) {
    try {
      if (typeof rankFor === 'function') return rankFor(level).name;
    } catch (err) { /* ignora */ }
    return 'E-RANK';
  }

  function startOfLast7Days() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 6);
    return d;
  }

  function weeklyMinutes(type) {
    const st = getState();
    if (!st) return 0;
    let sessions = [];
    try {
      sessions = window.SystemAI && window.SystemAI.collectSessions
        ? window.SystemAI.collectSessions(st)
        : (Array.isArray(st.sessions) ? st.sessions : []);
    } catch (err) { sessions = Array.isArray(st.sessions) ? st.sessions : []; }
    const start = startOfLast7Days();
    return sessions.reduce((total, session) => {
      const at = session.at instanceof Date ? session.at : new Date(session.at || session.date);
      if (isNaN(at.getTime()) || at < start) return total;
      const isStudy = session.type === 'study';
      if (type === 'study' && !isStudy) return total;
      if (type === 'training' && isStudy) return total;
      return total + (Number(session.minutes) || 0);
    }, 0);
  }

  function buildEntry(own) {
    const st = getState();
    if (!st) return null;
    const profile = st.profile || {};
    const lb = st.leaderboard || {};
    const name = String(lb.displayName || profile.name || 'JOGADOR').trim().slice(0, 32) || 'JOGADOR';
    return {
      display_name: name,
      level: Math.max(1, Number(st.level) || 1),
      rank: rankName(st.level),
      total_xp: Math.max(0, Number(st.totalXp) || 0),
      streak: Math.max(0, Number(st.streak) || 0),
      study_minutes_week: weeklyMinutes('study'),
      training_minutes_week: weeklyMinutes('training'),
      own: !!own
    };
  }

  function isConfigured() {
    const cloud = window.CloudSync;
    return !!(cloud && cloud.enabled && cloud.enabled() && cloud.isReady && cloud.isReady());
  }

  function isOnline() {
    const cloud = window.CloudSync;
    return !!(isConfigured() && cloud.getUser && cloud.getUser());
  }

  function setStatus(kind, text) {
    const el = $('#leaderboardStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'status-pill sync-pill ' + (kind === 'online' ? 'ok' : kind === 'error' ? 'err' : '');
  }

  function setNote(text, kind) {
    const el = $('#leaderboardNote');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'muted-note ' + (kind || '');
  }

  function normalizeEntry(row) {
    const level = Math.max(1, Number(row.level) || 1);
    return {
      user_id: row.user_id || '',
      display_name: String(row.display_name || 'JOGADOR').slice(0, 32),
      level,
      rank: String(row.rank || rankName(level)).slice(0, 32),
      total_xp: Math.max(0, Number(row.total_xp) || 0),
      streak: Math.max(0, Number(row.streak) || 0),
      study_minutes_week: Math.max(0, Number(row.study_minutes_week) || 0),
      training_minutes_week: Math.max(0, Number(row.training_minutes_week) || 0),
      updated_at: row.updated_at || '',
      own: false
    };
  }

  function markOwn(list) {
    const cloud = window.CloudSync;
    const user = cloud && cloud.getUser ? cloud.getUser() : null;
    const ownName = buildEntry(true);
    return list.map(item => Object.assign({}, item, {
      own: !!item.own || (!!user && item.user_id === user.id) ||
        (!item.user_id && !!ownName && item.display_name === ownName.display_name)
    }));
  }

  function sortEntries(list) {
    return list.slice().sort((a, b) =>
      (b.total_xp - a.total_xp) ||
      (b.streak - a.streak) ||
      ((b.study_minutes_week + b.training_minutes_week) - (a.study_minutes_week + a.training_minutes_week))
    );
  }

  function demoEntries() {
    const own = buildEntry(true);
    const st = getState();
    const baseLevel = Math.max(1, Number(st && st.level) || 1);
    const bots = DEMO_RIVALS.map((rival, index) => {
      const level = Math.max(1, baseLevel + rival.levelOffset);
      return {
        display_name: rival.name,
        level,
        rank: rankName(level),
        total_xp: rival.xp,
        streak: rival.streak,
        study_minutes_week: rival.study,
        training_minutes_week: rival.training,
        own: false,
        demo: true,
        order: index
      };
    });
    return sortEntries(own ? bots.concat([own]) : bots);
  }

  function rankId(entry) {
    const raw = String(entry.rank || '').toUpperCase();
    if (/MONARCA|MONARCH/.test(raw)) return 'monarch';
    const match = raw.match(/\b([EDCBAS])(?:-RANK|\b)/);
    return match ? match[1] : 'E';
  }

  function renderPodium() {
    const box = $('#leaderboardPodium');
    if (!box) return;
    const top = entries.slice(0, 3);
    if (!top.length) {
      box.innerHTML = '';
      return;
    }
    const order = [1, 0, 2];
    box.innerHTML = order.map((position, visualIndex) => {
      const entry = top[position];
      if (!entry) return '<div class="podium-card empty"></div>';
      const medal = position === 0 ? '♛' : position === 1 ? 'Ⅱ' : 'Ⅲ';
      return `<div class="podium-card p${visualIndex + 1} ${entry.own ? 'own' : ''}">
        <span class="podium-medal">${medal}</span>
        <strong>${esc(entry.display_name)}</strong>
        <small>LVL ${entry.level} · ${esc(entry.rank)}</small>
        <b>${entry.total_xp.toLocaleString('pt-BR')} XP</b>
      </div>`;
    }).join('');
  }

  function renderList() {
    const box = $('#leaderboardList');
    if (!box) return;
    if (!entries.length) {
      box.innerHTML = '<p class="muted-note">Nenhum jogador no ranking ainda. Registre sessões e sincronize para aparecer aqui.</p>';
      return;
    }
    box.innerHTML = entries.map((entry, index) => {
      const id = rankId(entry);
      return `<div class="rank-row ${entry.own ? 'own' : ''}">
        <span class="rank-pos">${index + 1}</span>
        <span class="rank-tag rank-${esc(id.toLowerCase())}">${esc(id)}</span>
        <div class="rank-who">
          <strong>${esc(entry.display_name)}${entry.own ? ' <em>VOCÊ</em>' : ''}</strong>
          <small>LVL ${entry.level} · ${esc(entry.rank)}${entry.demo ? ' · simulado' : ''}</small>
        </div>
        <div class="rank-metrics">
          <span><b>${entry.total_xp.toLocaleString('pt-BR')}</b> XP</span>
          <span><b>${entry.streak}</b> dias</span>
          <span><b>${entry.study_minutes_week}</b> min estudo</span>
          <span><b>${entry.training_minutes_week}</b> min treino</span>
        </div>
      </div>`;
    }).join('');
  }

  function renderMyCard() {
    const own = buildEntry(true);
    if (!own) return;
    const position = entries.findIndex(entry => entry.own);
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('myRankPosition', position >= 0 ? `#${position + 1}` : '—');
    set('myRankName', own.display_name);
    set('myRankLevel', `LVL ${own.level} · ${own.rank}`);
    set('myRankXp', own.total_xp.toLocaleString('pt-BR'));
    set('myRankStreak', String(own.streak));
    set('myRankStudy', String(own.study_minutes_week));
    set('myRankTraining', String(own.training_minutes_week));

    const nameInput = $('#rankingName');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = own.display_name;
    const opt = $('#rankingOptIn');
    const st = getState();
    if (opt && st) opt.checked = st.leaderboard ? st.leaderboard.optIn !== false : true;
  }

  function renderMeta() {
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('leaderboardCount', String(entries.length));
    const latest = entries.reduce((max, entry) => {
      const t = entry.updated_at ? new Date(entry.updated_at).getTime() : 0;
      return t > max ? t : max;
    }, 0);
    set('leaderboardUpdatedAt', latest
      ? new Date(latest).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—');
    const badge = $('#leaderboardMode');
    if (badge) {
      badge.textContent = mode === 'online' ? 'ONLINE GLOBAL' : 'SIMULAÇÃO LOCAL';
      badge.className = 'count-badge ' + (mode === 'online' ? 'online' : 'local');
    }
  }

  function render() {
    entries = sortEntries(markOwn(entries));
    renderPodium();
    renderList();
    renderMyCard();
    renderMeta();
  }

  async function pushOwn(silent) {
    const st = getState();
    if (!st || !isOnline()) return { ok: false, error: 'offline' };
    if (st.leaderboard && st.leaderboard.optIn === false) return { ok: false, error: 'opt-out' };
    const own = buildEntry(true);
    if (!own) return { ok: false, error: 'sem estado' };
    const result = await window.CloudSync.pushLeaderboard(own);
    if (result.ok) {
      st.leaderboard = st.leaderboard || {};
      st.leaderboard.lastSyncAt = Date.now();
      st.leaderboard.lastError = '';
    } else {
      st.leaderboard = st.leaderboard || {};
      st.leaderboard.lastError = result.error || 'Falha ao publicar rank.';
      if (!silent) setNote(result.error || 'Falha ao publicar seu rank.', 'error');
    }
    return result;
  }

  async function refresh(options) {
    const opts = options || {};
    const st = getState();
    if (!st) return;
    if (syncing) return;
    // Evita duplicar a busca quando a aba e o estado disparam refresh quase juntos.
    if (!opts.force && Date.now() - lastRefreshAt < 2500) {
      render();
      return;
    }
    lastRefreshAt = Date.now();
    syncing = true;

    try {
      renderMyCard();
      if (!isConfigured()) {
        mode = 'local';
        entries = demoEntries();
        setStatus('local', 'MODO LOCAL');
        setNote('Ranking online indisponível: configure o Supabase em cloud.js. Enquanto isso, os rivais abaixo são simulados apenas para validar a interface.', '');
        render();
        return;
      }

      mode = 'online';
      const logged = isOnline();
      setStatus('sync', 'SINCRONIZANDO…');
      setNote(logged ? 'Buscando jogadores reais na nuvem…' : 'Carregando o ranking público da nuvem…');

      if (!logged) {
        setNote('Ranking público da nuvem. Entre pela aba NUVEM para publicar seu próprio rank.');
      } else if (st.leaderboard && st.leaderboard.optIn === false) {
        setNote('Você optou por não participar do ranking global. Seu progresso não é publicado.', '');
      } else if (!opts.skipPush) {
        const pushed = await pushOwn(true);
        if (!pushed.ok && pushed.error !== 'opt-out') {
          setNote('Não foi possível publicar seu rank: ' + (pushed.error || 'erro na nuvem') + '. Verifique a tabela leaderboard no Supabase.', 'error');
        }
      }

      const result = await window.CloudSync.fetchLeaderboard(50);
      if (!result.ok) {
        mode = 'local';
        entries = demoEntries();
        setStatus('error', 'NUVEM INDISPONÍVEL');
        setNote('Falha ao buscar o ranking real: ' + (result.error || 'erro na nuvem') + '. Exibindo simulação local.', 'error');
        render();
        return;
      }

      entries = result.data.map(normalizeEntry);
      if (!entries.length && logged) {
        const own = buildEntry(true);
        if (own && st.leaderboard.optIn !== false) entries = [Object.assign({}, own, { own: true })];
      }
      setStatus('online', logged ? 'ONLINE GLOBAL' : 'ONLINE PÚBLICO');
      if (!logged) {
        setNote('Ranking público da nuvem. Entre pela aba NUVEM para publicar seu próprio rank.');
      } else {
        setNote(st.leaderboard && st.leaderboard.optIn === false
          ? 'Ranking real da nuvem. Você está fora da publicação (opt-out).'
          : 'Ranking real entre jogadores da nuvem. Atualiza ao abrir esta aba e após registrar sessões.');
      }
      render();
    } catch (err) {
      mode = 'local';
      entries = demoEntries();
      setStatus('error', 'ERRO NO RANKING');
      setNote('Erro inesperado ao carregar o ranking: ' + (err && err.message ? err.message : 'desconhecido') + '.', 'error');
      render();
    } finally {
      syncing = false;
    }
  }

  async function syncNow() {
    const st = getState();
    if (!st) return;
    if (!isConfigured()) {
      window.showToast?.('RANKING', 'Configure o Supabase em cloud.js para ativar o ranking online.');
      return;
    }
    if (!isOnline()) {
      window.showToast?.('RANKING', 'Entre pela aba NUVEM para publicar seu rank.');
      return;
    }
    if (st.leaderboard && st.leaderboard.optIn === false) {
      window.showToast?.('RANKING', 'Ative "Participar do ranking global" para publicar seu rank.');
      return;
    }
    setStatus('sync', 'PUBLICANDO…');
    const result = await pushOwn(false);
    if (result.ok) {
      window.SystemSound?.play('confirm');
      window.showToast?.('RANKING', 'Seu rank foi publicado na nuvem.');
    } else {
      window.SystemSound?.play('error');
      window.showToast?.('RANKING', result.error || 'Falha ao publicar o rank.');
    }
    await refresh({ skipPush: true, force: true });
  }

  function scheduleSync() {
    if (suppressSchedule) { suppressSchedule = false; return; }
    if (!isOnline()) return;
    const st = getState();
    if (!st || (st.leaderboard && st.leaderboard.optIn === false)) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { pushOwn(true); }, 6000);
  }

  function saveIdentity() {
    const st = getState();
    if (!st) return;
    const input = $('#rankingName');
    const opt = $('#rankingOptIn');
    const name = String(input && input.value || '').trim().slice(0, 32);
    st.leaderboard = st.leaderboard || {};
    st.leaderboard.displayName = name || (st.profile && st.profile.name) || 'JOGADOR';
    st.leaderboard.optIn = opt ? !!opt.checked : true;
    suppressSchedule = true;
    window.__systemApp?.save?.();
    render();
    window.SystemSound?.play('confirm');
    window.showToast?.('RANKING', st.leaderboard.optIn
      ? 'Identidade do ranking salva. Sincronizando…'
      : 'Você saiu do ranking global. Seu rank será removido da nuvem.');

    if (!isOnline()) return;
    if (st.leaderboard.optIn) {
      pushOwn(true).then(result => {
        if (result.ok) refresh({ skipPush: true, force: true });
      });
    } else {
      window.CloudSync.removeLeaderboard().then(result => {
        if (result.ok) window.showToast?.('RANKING', 'Seu rank foi removido da nuvem.');
        else setNote('Falha ao remover seu rank da nuvem: ' + (result.error || 'erro'), 'error');
        refresh({ skipPush: true, force: true });
      });
    }
  }

  function bind() {
    $('#rankingSaveBtn')?.addEventListener('click', saveIdentity);
    $('#rankingSyncBtn')?.addEventListener('click', syncNow);
    $('#rankingRefreshBtn')?.addEventListener('click', () => refresh({ force: true }));
    $('#rankingOptIn')?.addEventListener('change', () => {
      const st = getState();
      if (!st) return;
      st.leaderboard = st.leaderboard || {};
      st.leaderboard.optIn = !!$('#rankingOptIn').checked;
      suppressSchedule = true;
      window.__systemApp?.save?.();
      if (!st.leaderboard.optIn && isOnline()) window.CloudSync.removeLeaderboard();
      render();
    });
    document.querySelectorAll('.tab[data-tab="ranking"]').forEach(tab => {
      tab.addEventListener('click', () => setTimeout(() => refresh(), 120));
    });
    window.addEventListener('online', () => { if (document.querySelector('#tab-ranking.active')) refresh(); });
  }

  function init() {
    bind();
    if (isOnline()) {
      setTimeout(() => refresh(), 1400);
      return;
    }
    // Sem sessão na nuvem: mostra o estado local na hora e só busca o ranking
    // público quando o jogador abre a aba RANKING (evita espera/rede no load).
    mode = 'local';
    entries = demoEntries();
    setStatus('local', isConfigured() ? 'ONLINE DISPONÍVEL' : 'MODO LOCAL');
    setNote(isConfigured()
      ? 'Abra esta aba para carregar o ranking público da nuvem. Entre na aba NUVEM para publicar seu rank.'
      : 'Ranking online indisponível: configure o Supabase em cloud.js. Enquanto isso, os rivais abaixo são simulados apenas para validar a interface.', '');
    render();
  }

  window.SystemLeaderboard = {
    refresh,
    syncNow,
    push: pushOwn,
    buildEntry,
    render
  };
  window.__leaderboardSync = scheduleSync;
  window.__leaderboardRefresh = () => {
    if (document.querySelector('#tab-ranking.active')) refresh({ skipPush: true });
    else renderMyCard();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
