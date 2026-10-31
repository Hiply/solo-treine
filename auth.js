/* ===================== AUTH // CONTA LOCAL + NUVEM OPCIONAL ===================== */
/* A conta local funciona 100% offline e separa o progresso por jogador.           */
/* A aba NUVEM usa o Supabase configurado em cloud.js para sincronizar aparelhos.   */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const PROFILES_KEY = 'system-auth-profiles';
  const SESSION_KEY = 'system-auth-session';
  const BASE_STATE_KEY = 'system-training-v3';
  const FLASH_KEY = 'system-flash';
  const FORCE_CLOUD_PULL = 'system-force-cloud-pull';
  const SESSION_DAYS = 30;

  function getProfiles() {
    try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '{}') || {}; } catch (err) { return {}; }
  }
  function saveProfiles(profiles) {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  }
  function getSession() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!session || !session.email) return null;
      if (session.expires && Date.now() > session.expires) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return session;
    } catch (err) {
      return null;
    }
  }
  function setSession(email, name) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      email,
      name,
      at: Date.now(),
      expires: Date.now() + SESSION_DAYS * 86400000
    }));
  }
  function stateKey(email) {
    return BASE_STATE_KEY + (email ? ':user:' + email : '');
  }
  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }
  function flash(message, type) {
    try { sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, type: type || 'info', at: Date.now() })); } catch (err) { /* ignora */ }
  }
  function consumeFlash() {
    try {
      const item = JSON.parse(sessionStorage.getItem(FLASH_KEY) || 'null');
      sessionStorage.removeItem(FLASH_KEY);
      return item;
    } catch (err) { return null; }
  }
  function setMessage(text, kind) {
    const el = $('#authMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'auth-msg ' + (kind || '');
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  async function hashPassword(email, password) {
    const raw = `system-training::${String(email).toLowerCase()}::${password}`;
    try {
      if (window.crypto && window.crypto.subtle && window.TextEncoder) {
        const buffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
        return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (err) { /* fallback abaixo */ }
    let hash = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return 'fnv' + (hash >>> 0).toString(16);
  }

  function migrateGuestProgress(email) {
    const key = stateKey(email);
    if (localStorage.getItem(key)) return;
    const guest = localStorage.getItem(BASE_STATE_KEY);
    if (guest) localStorage.setItem(key, guest);
  }

  /* ---------- UI ---------- */
  let currentMode = 'local';
  let localMode = 'login';

  function updateMusicButton() {
    const btn = $('#authMusicBtn');
    if (!btn) return;
    const on = window.SystemMusic ? window.SystemMusic.isEnabled() : true;
    btn.textContent = on ? '♪ MÚSICA: ON' : '♪ MÚSICA: OFF';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function applyLocalMode() {
    const signup = localMode === 'signup';
    const nameGroup = $('#authNameGroup');
    const signIn = $('#authSignInBtn');
    const signUp = $('#authSignUpBtn');
    const title = $('#authTitle');
    const hint = $('#authLocalHint');
    const password = $('#authPassword');
    if (nameGroup) nameGroup.hidden = !signup;
    if (signIn) signIn.hidden = signup;
    if (signUp) signUp.hidden = !signup;
    if (title) title.textContent = signup ? 'CRIAR NOVA CONTA' : 'AUTENTICAÇÃO';
    if (hint) hint.textContent = signup
      ? 'Crie sua conta local. Funciona offline, sem internet, e separa o progresso por jogador.'
      : 'Entre com sua conta local. Funciona offline e mantém o progresso neste navegador.';
    if (password) password.autocomplete = signup ? 'new-password' : 'current-password';
    $('#authModeLogin')?.classList.toggle('active', !signup);
    $('#authModeSignup')?.classList.toggle('active', signup);
    $('#authModeLogin')?.setAttribute('aria-selected', String(!signup));
    $('#authModeSignup')?.setAttribute('aria-selected', String(signup));
  }

  function renderAuthView() {
    const logged = !!getSession();
    const localPanel = $('#authLocalPanel');
    const cloudPanel = $('#authCloudPanel');
    const profileBox = $('#authProfileBox');
    const modeSwitch = $('#authModeSwitch');
    const title = $('#authTitle');

    if (profileBox) profileBox.hidden = !logged;
    if (localPanel) localPanel.hidden = logged || currentMode !== 'local';
    if (cloudPanel) cloudPanel.hidden = logged || currentMode !== 'cloud';
    if (modeSwitch) modeSwitch.hidden = logged || currentMode !== 'local';

    if (logged) {
      if (title) title.textContent = 'CONTA DO CAÇADOR';
    } else if (currentMode === 'cloud') {
      if (title) title.textContent = 'NUVEM // SINCRONIZAÇÃO';
    } else {
      applyLocalMode();
    }
    updateMusicButton();
  }

  function setMode(mode) {
    currentMode = mode === 'cloud' ? 'cloud' : 'local';
    renderAuthView();
    if (!getSession() && currentMode === 'cloud') checkCloudStatus();
  }

  function playAuthVideo() {
    const video = $('#authVideo');
    if (!video) return;
    try {
      const attempt = video.play();
      if (attempt && attempt.catch) attempt.catch(() => {});
    } catch (err) { /* ignora */ }
  }

  function pauseAuthVideo() {
    const video = $('#authVideo');
    if (!video) return;
    try { video.pause(); } catch (err) { /* ignora */ }
  }

  function openModal(mode) {
    const modal = $('#authModal');
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('auth-open');
    setMessage('');
    if (!getSession()) {
      currentMode = mode === 'cloud' ? 'cloud' : 'local';
      if (currentMode === 'local') localMode = 'login';
    }
    renderAuthView();
    refresh();
    playAuthVideo();
    setTimeout(() => {
      if (!getSession() && currentMode === 'local') $('#authEmail')?.focus();
    }, 140);
  }

  function closeModal() {
    const modal = $('#authModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('auth-open');
    pauseAuthVideo();
    setMessage('');
  }

  function toggleMusic() {
    const st = window.__systemApp?.state;
    const next = st ? !st.settings.sound : !(window.SystemMusic ? window.SystemMusic.isEnabled() : true);
    if (st) {
      st.settings.sound = next;
      window.SystemSound?.setEnabled(next);
      window.SystemSound?.setVoice(next);
      window.__systemApp?.save?.();
      const soundBtn = $('#soundBtn');
      if (soundBtn) soundBtn.textContent = next ? '◈' : '◇';
    } else {
      window.SystemMusic?.setEnabled(next);
    }
    updateMusicButton();
    if (next) window.SystemSound?.play('confirm');
  }

  function refresh() {
    const session = getSession();
    const profile = session ? (getProfiles()[session.email] || { name: session.name || session.email.split('@')[0], email: session.email }) : null;
    const button = $('#cloudBtn');
    if (button) {
      const cloudUser = window.CloudSync?.getUser?.();
      button.textContent = profile ? `☁ ${profile.name}` : (cloudUser ? `☁ ${String(cloudUser.email || '').split('@')[0]}` : '☁ Conta');
    }

    if (profile) {
      const name = $('#authProfileName');
      const email = $('#authProfileEmail');
      const cloud = $('#authProfileCloud');
      if (name) name.textContent = profile.name;
      if (email) email.textContent = profile.email + ' · conta local neste dispositivo';
      const cloudUser = window.CloudSync?.getUser?.();
      if (cloud) {
        cloud.textContent = cloudUser
          ? `Nuvem conectada como ${cloudUser.email}.`
          : 'Nuvem não conectada. Abra NUVEM / SINCRONIZAÇÃO para conectar.';
      }
    }

    renderAuthView();
  }

  async function checkCloudStatus(force) {
    const box = $('#authCloudStatus');
    if (!box) return { ok: false, reason: 'not-configured' };
    const cloud = window.CloudSync;
    if (!cloud || !cloud.enabled()) {
      box.textContent = 'Nuvem não configurada. Abra cloud.js e cole a URL base e a chave anon do SEU projeto Supabase (a URL não deve terminar em /rest/v1).';
      box.className = 'auth-hint auth-msg error';
      return { ok: false, reason: 'not-configured' };
    }
    box.textContent = 'Testando conexão com o Supabase…';
    box.className = 'auth-hint auth-msg';
    const health = await cloud.healthCheck(force);
    box.textContent = health.ok
      ? 'Supabase acessível. Você pode entrar ou criar conta na nuvem.'
      : cloud.healthMessage(health);
    box.className = 'auth-hint auth-msg ' + (health.ok ? 'ok' : 'error');
    return health;
  }

  /* ---------- Conta local ---------- */
  async function signInLocal() {
    const email = ($('#authEmail')?.value || '').trim().toLowerCase();
    const password = $('#authPassword')?.value || '';
    if (!validEmail(email) || password.length < 6) {
      return setMessage('Informe um e-mail válido e uma senha com 6+ caracteres.', 'error');
    }
    const profiles = getProfiles();
    const profile = profiles[email];
    if (!profile) return setMessage('Conta local não encontrada. Clique em CRIAR CONTA.', 'error');

    const hash = await hashPassword(email, password);
    if (hash !== profile.hash) return setMessage('Senha incorreta para esta conta local.', 'error');

    profile.lastLogin = new Date().toISOString();
    saveProfiles(profiles);
    setSession(email, profile.name);
    flash(`Bem-vindo de volta, ${profile.name}.`);
    location.reload();
  }

  async function signUpLocal() {
    const email = ($('#authEmail')?.value || '').trim().toLowerCase();
    const password = $('#authPassword')?.value || '';
    const name = ($('#authName')?.value || '').trim();
    if (!name || name.length < 2) return setMessage('Informe o nome do jogador (mín. 2 caracteres).', 'error');
    if (!validEmail(email)) return setMessage('Informe um e-mail válido.', 'error');
    if (password.length < 6) return setMessage('A senha precisa ter pelo menos 6 caracteres.', 'error');

    const profiles = getProfiles();
    if (profiles[email]) return setMessage('Já existe uma conta local com este e-mail. Use ENTRAR ou outro e-mail.', 'error');

    profiles[email] = {
      name,
      email,
      hash: await hashPassword(email, password),
      createdAt: new Date().toISOString()
    };
    saveProfiles(profiles);
    migrateGuestProgress(email);
    setSession(email, name);
    flash(`Conta local criada. Bem-vindo, ${name}.`);
    location.reload();
  }

  async function signOutLocal() {
    localStorage.removeItem(SESSION_KEY);
    try { await window.CloudSync?.signOut?.(); } catch (err) { /* ignora */ }
    flash('Sessão encerrada. Seu progresso continua salvo nesta conta.');
    location.reload();
  }

  /* ---------- Exportar / importar progresso ---------- */
  function exportProgress() {
    const session = getSession();
    const key = stateKey(session && session.email);
    const raw = localStorage.getItem(key);
    if (!raw) return setMessage('Ainda não há progresso para exportar.', 'error');
    const blob = new Blob([raw], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const who = session && session.email ? session.email.split('@')[0] : 'convidado';
    link.download = `system-training-${who}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    setMessage('Progresso exportado como arquivo JSON.', 'ok');
    window.SystemSound?.play('confirm');
  }

  async function importProgress(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || !('level' in data)) throw new Error('Este arquivo não parece ser um progresso válido do Sistema.');
      const session = getSession();
      localStorage.setItem(stateKey(session && session.email), JSON.stringify(data));
      flash('Progresso importado com sucesso.');
      location.reload();
    } catch (err) {
      setMessage('Falha ao importar: ' + (err && err.message ? err.message : 'arquivo inválido.'), 'error');
    } finally {
      event.target.value = '';
    }
  }

  /* ---------- Nuvem ---------- */
  async function ensureCloudProfile(email, password, name) {
    const key = String(email).toLowerCase();
    const profiles = getProfiles();
    if (!profiles[key]) {
      profiles[key] = {
        name: name || key.split('@')[0],
        email: key,
        hash: await hashPassword(key, password),
        createdAt: new Date().toISOString(),
        cloud: true
      };
      saveProfiles(profiles);
      migrateGuestProgress(key);
    }
    setSession(key, profiles[key].name);
  }

  async function signInCloud() {
    const email = ($('#cloudEmail')?.value || '').trim().toLowerCase();
    const password = $('#cloudPassword')?.value || '';
    if (!validEmail(email) || password.length < 6) {
      return setMessage('Informe um e-mail válido e a senha da conta na nuvem.', 'error');
    }
    const cloud = window.CloudSync;
    if (!cloud || !cloud.enabled()) return setMessage('Nuvem não configurada. Veja as instruções em cloud.js.', 'error');

    setMessage('Conectando à nuvem…');
    const health = await cloud.healthCheck();
    if (!health.ok) return setMessage(cloud.healthMessage(health), 'error');

    localStorage.setItem(FORCE_CLOUD_PULL, '1');
    const result = await cloud.signIn(email, password);
    if (!result.ok) {
      localStorage.removeItem(FORCE_CLOUD_PULL);
      return setMessage(result.error, 'error');
    }

    await ensureCloudProfile(email, password, email.split('@')[0]);
    flash('Login na nuvem concluído. Sincronizando seu progresso…');
    location.reload();
  }

  async function signUpCloud() {
    const email = ($('#cloudEmail')?.value || '').trim().toLowerCase();
    const password = $('#cloudPassword')?.value || '';
    if (!validEmail(email) || password.length < 6) {
      return setMessage('Informe um e-mail válido e uma senha com 6+ caracteres.', 'error');
    }
    const cloud = window.CloudSync;
    if (!cloud || !cloud.enabled()) return setMessage('Nuvem não configurada. Veja as instruções em cloud.js.', 'error');

    setMessage('Criando conta na nuvem…');
    const health = await cloud.healthCheck();
    if (!health.ok) return setMessage(cloud.healthMessage(health), 'error');

    localStorage.setItem(FORCE_CLOUD_PULL, '1');
    const result = await cloud.signUp(email, password);
    if (!result.ok) {
      localStorage.removeItem(FORCE_CLOUD_PULL);
      return setMessage(result.error, 'error');
    }
    if (result.needsConfirmation) {
      localStorage.removeItem(FORCE_CLOUD_PULL);
      return setMessage('Conta criada na nuvem. Confirme o e-mail (caixa de entrada/spam) e depois entre pela aba NUVEM.', 'ok');
    }

    await ensureCloudProfile(email, password, email.split('@')[0]);
    flash('Conta na nuvem criada. Seu progresso será sincronizado.');
    location.reload();
  }

  async function testCloud() {
    setMessage('Testando conexão com o Supabase…');
    const health = await checkCloudStatus(true);
    const cloud = window.CloudSync;
    if (health.ok) setMessage('Conexão OK. A nuvem está acessível.', 'ok');
    else setMessage(cloud && cloud.healthMessage ? cloud.healthMessage(health) : 'Nuvem indisponível.', 'error');
  }

  /* ---------- Bind ---------- */
  function bind() {
    $('#cloudBtn')?.addEventListener('click', () => openModal('local'));
    $('#authCloseBtn')?.addEventListener('click', closeModal);
    $('#authBackBtn')?.addEventListener('click', closeModal);
    $('#authModal')?.addEventListener('click', event => {
      if (event.target.id === 'authModal' || event.target.id === 'authVideo' ||
        event.target.classList.contains('auth-vignette')) closeModal();
    });
    $('#authModeLogin')?.addEventListener('click', () => { localMode = 'login'; setMessage(''); applyLocalMode(); });
    $('#authModeSignup')?.addEventListener('click', () => { localMode = 'signup'; setMessage(''); applyLocalMode(); });
    $('#authTabLocal')?.addEventListener('click', () => setMode('local'));
    $('#authTabCloud')?.addEventListener('click', () => setMode('cloud'));
    $('#authSignInBtn')?.addEventListener('click', signInLocal);
    $('#authSignUpBtn')?.addEventListener('click', signUpLocal);
    $('#authSignOutBtn')?.addEventListener('click', signOutLocal);
    $('#authExportBtn')?.addEventListener('click', exportProgress);
    $('#authImportBtn')?.addEventListener('click', () => $('#authImportFile')?.click());
    $('#authImportFile')?.addEventListener('change', importProgress);
    $('#cloudSignInBtn')?.addEventListener('click', signInCloud);
    $('#cloudSignUpBtn')?.addEventListener('click', signUpCloud);
    $('#cloudHealthBtn')?.addEventListener('click', testCloud);
    $('#authMusicBtn')?.addEventListener('click', toggleMusic);

    ['authPassword', 'cloudPassword'].forEach(id => {
      const el = document.getElementById(id);
      el?.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        if (id === 'authPassword') {
          if (localMode === 'signup') signUpLocal();
          else signInLocal();
        } else {
          signInCloud();
        }
      });
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && $('#authModal')?.classList.contains('open')) closeModal();
    });

    refresh();
    const pending = consumeFlash();
    if (pending && pending.message) {
      setTimeout(() => window.showToast?.('SISTEMA', pending.message), 600);
    }
  }

  window.Auth = {
    refresh,
    open: openModal,
    close: closeModal,
    session: getSession,
    profiles: getProfiles,
    signOut: signOutLocal
  };

  bind();
})();
