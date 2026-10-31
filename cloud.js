/* ===================== CLOUD SYNC (Supabase) ===================== */
/* cloud-config.js contém apenas a URL do projeto e a chave pública anon. */
/* Nunca coloque aqui a chave service_role: o cliente roda no navegador. */
const SUPABASE_CONFIG = window.APP_PUBLIC_CONFIG || {};
const SUPABASE_URL = String(SUPABASE_CONFIG.supabaseUrl || '').trim();
const SUPABASE_ANON_KEY = String(SUPABASE_CONFIG.supabaseAnonKey || '').trim();

const CLOUD_FORCE_PULL_KEY = 'system-force-cloud-pull';
let supa = null;
let cloudUser = null;
let cloudReady = false;
let cloudSyncTimer = null;
const $$ = s => document.querySelector(s);

function normalizeSupabaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
}
const SUPABASE_BASE = normalizeSupabaseUrl(SUPABASE_URL);

function cloudEnabled() {
  return SUPABASE_BASE.startsWith('http') &&
    SUPABASE_ANON_KEY.length > 20 &&
    typeof window.supabase !== 'undefined';
}

function setSyncPill(mode) {
  const p = $$('#syncPill');
  if (!p) return;
  const map = {
    off: ['SEM NUVEM', ''],
    out: ['NUVEM: DESCONECTADO', ''],
    in: ['NUVEM: CONECTADO', 'ok'],
    sync: ['SINCRONIZANDO…', 'ok'],
    err: ['ERRO DE SINCRONIA', 'err']
  };
  const item = map[mode] || map.off;
  p.textContent = item[0];
  p.className = 'status-pill sync-pill ' + item[1];
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label || 'Tempo esgotado ao falar com a nuvem.')), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function friendlyCloudError(error) {
  const message = String((error && error.message) || error || '');
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (lower.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar (verifique a caixa de entrada e o spam).';
  if (lower.includes('user already registered')) return 'Este e-mail já tem conta na nuvem. Use ENTRAR NA NUVEM.';
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return 'Não foi possível alcançar o Supabase. O projeto pode estar pausado, removido ou a URL está errada.';
  }
  if (lower.includes('password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.';
  return message || 'Falha desconhecida na nuvem.';
}

async function healthCheck() {
  if (!cloudEnabled()) return { ok: false, reason: 'not-configured' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${SUPABASE_BASE}/auth/v1/health`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: controller.signal,
      cache: 'no-store'
    });
    clearTimeout(timeout);
    if (res.ok) return { ok: true, status: res.status };
    if (res.status === 503) return { ok: false, reason: 'paused', status: 503 };
    return { ok: false, reason: 'http', status: res.status };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, reason: 'network', error: err && err.message ? err.message : String(err) };
  }
}

function initCloud() {
  if (!cloudEnabled()) {
    document.querySelectorAll('.cloud-only').forEach(el => { el.style.display = 'none'; });
    setSyncPill('off');
    return;
  }

  try {
    supa = window.supabase.createClient(SUPABASE_BASE, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    cloudReady = true;

    supa.auth.onAuthStateChange((_event, session) => {
      cloudUser = (session && session.user) || null;
      window.Auth?.refresh?.();
      if (cloudUser) pullFromCloud();
      else setSyncPill('out');
    });

    supa.auth.getSession().then(({ data }) => {
      cloudUser = (data && data.session && data.session.user) || null;
      window.Auth?.refresh?.();
      if (cloudUser) pullFromCloud();
      else setSyncPill('out');
    }).catch(err => {
      console.warn('Supabase getSession falhou:', err);
      setSyncPill('err');
    });
  } catch (err) {
    cloudReady = false;
    setSyncPill('err');
    console.warn('Supabase indisponível:', err);
  }
}

async function cloudSignIn(email, password) {
  if (!cloudReady) return { ok: false, error: 'Nuvem não configurada ou cliente Supabase indisponível.' };
  const health = await healthCheck();
  if (!health.ok) return { ok: false, error: healthMessage(health) };
  try {
    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: friendlyCloudError(error) };
    return { ok: true, user: data && data.user };
  } catch (err) {
    return { ok: false, error: friendlyCloudError(err) };
  }
}

async function cloudSignUp(email, password) {
  if (!cloudReady) return { ok: false, error: 'Nuvem não configurada ou cliente Supabase indisponível.' };
  const health = await healthCheck();
  if (!health.ok) return { ok: false, error: healthMessage(health) };
  try {
    const { data, error } = await supa.auth.signUp({ email, password });
    if (error) return { ok: false, error: friendlyCloudError(error) };
    return {
      ok: true,
      user: data && data.user,
      needsConfirmation: !(data && data.session)
    };
  } catch (err) {
    return { ok: false, error: friendlyCloudError(err) };
  }
}

async function cloudSignOut() {
  if (!supa) return;
  try { await supa.auth.signOut(); } catch (err) { console.warn('signOut falhou:', err); }
  cloudUser = null;
  setSyncPill('out');
  window.Auth?.refresh?.();
}

function healthMessage(health) {
  if (!health) return 'Nuvem indisponível.';
  if (health.reason === 'not-configured') return 'Nuvem não configurada. Preencha a URL e a chave pública do Supabase em cloud-config.js.';
  if (health.reason === 'paused') return 'O projeto Supabase está pausado. Abra o painel do Supabase e clique em "Restore project".';
  if (health.reason === 'network') return 'Não foi possível alcançar o projeto Supabase. Verifique a internet, a URL e se o projeto ainda existe.';
  if (health.reason === 'http') return `O Supabase respondeu HTTP ${health.status}. Verifique a URL e a chave anon.`;
  return 'Nuvem indisponível no momento.';
}

async function pullFromCloud() {
  if (!cloudUser || !supa) return;
  setSyncPill('sync');
  try {
    const { data, error } = await supa.from('player_state')
      .select('data,updated_at')
      .eq('user_id', cloudUser.id)
      .maybeSingle();

    if (error) {
      setSyncPill('err');
      return;
    }

    const force = localStorage.getItem(CLOUD_FORCE_PULL_KEY) === '1';
    if (data && data.data) {
      const localTime = window.getStateSavedAt ? window.getStateSavedAt() : 0;
      const remoteTime = data.updated_at ? new Date(data.updated_at).getTime() : 0;
      if (force || remoteTime >= localTime) {
        window.applyCloudState?.(data.data);
        window.showToast?.('NUVEM', force ? 'Progresso da nuvem aplicado neste dispositivo.' : 'Progresso sincronizado deste dispositivo.');
      }
    } else {
      await pushToCloud();
    }

    localStorage.removeItem(CLOUD_FORCE_PULL_KEY);
    setSyncPill('in');
  } catch (err) {
    console.warn('Falha ao baixar progresso:', err);
    setSyncPill('err');
  }
}

let pushTimeout = null;
function scheduleCloudPush() {
  if (!cloudUser || !supa) return;
  clearTimeout(pushTimeout);
  pushTimeout = setTimeout(pushToCloud, 1500);
}

async function pushToCloud() {
  if (!cloudUser || !supa) return;
  const payload = window.getStateSnapshot ? window.getStateSnapshot() : null;
  if (!payload) return;
  setSyncPill('sync');
  try {
    const { error } = await supa.from('player_state').upsert({
      user_id: cloudUser.id,
      data: payload,
      updated_at: new Date().toISOString()
    });
    setSyncPill(error ? 'err' : 'in');
  } catch (err) {
    console.warn('Falha ao enviar progresso:', err);
    setSyncPill('err');
  }
}

/* ---------- Ranking global (tabela pública leaderboard) ---------- */
async function fetchLeaderboard(limit) {
  if (!cloudEnabled() || !supa) return { ok: false, error: 'Nuvem não configurada.' };
  try {
    const { data, error } = await withTimeout(
      supa.from('leaderboard')
        .select('user_id,display_name,level,rank,total_xp,streak,study_minutes_week,training_minutes_week,updated_at')
        .order('total_xp', { ascending: false })
        .order('streak', { ascending: false })
        .limit(Math.max(1, Math.min(100, Number(limit) || 50))),
      9000,
      'Tempo esgotado ao buscar o ranking.'
    );
    if (error) return { ok: false, error: friendlyCloudError(error) };
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err) {
    return { ok: false, error: friendlyCloudError(err) };
  }
}

async function pushLeaderboard(entry) {
  if (!cloudUser || !supa) return { ok: false, error: 'Entre na nuvem para publicar seu rank.' };
  try {
    const payload = {
      user_id: cloudUser.id,
      display_name: String(entry.display_name || 'JOGADOR').slice(0, 32),
      level: Math.max(1, Math.round(Number(entry.level) || 1)),
      rank: String(entry.rank || 'E-RANK').slice(0, 32),
      total_xp: Math.max(0, Math.round(Number(entry.total_xp) || 0)),
      streak: Math.max(0, Math.round(Number(entry.streak) || 0)),
      study_minutes_week: Math.max(0, Math.round(Number(entry.study_minutes_week) || 0)),
      training_minutes_week: Math.max(0, Math.round(Number(entry.training_minutes_week) || 0)),
      updated_at: new Date().toISOString()
    };
    const { error } = await withTimeout(
      supa.from('leaderboard').upsert(payload),
      9000,
      'Tempo esgotado ao publicar o rank.'
    );
    if (error) return { ok: false, error: friendlyCloudError(error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyCloudError(err) };
  }
}

async function removeLeaderboard() {
  if (!cloudUser || !supa) return { ok: false, error: 'Entre na nuvem para remover seu rank.' };
  try {
    const { error } = await withTimeout(
      supa.from('leaderboard').delete().eq('user_id', cloudUser.id),
      9000,
      'Tempo esgotado ao remover o rank.'
    );
    if (error) return { ok: false, error: friendlyCloudError(error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyCloudError(err) };
  }
}

window.__cloudSync = scheduleCloudPush;
window.CloudSync = {
  enabled: cloudEnabled,
  init: initCloud,
  signIn: cloudSignIn,
  signUp: cloudSignUp,
  signOut: cloudSignOut,
  getUser: () => cloudUser,
  isReady: () => cloudReady,
  healthCheck,
  healthMessage,
  pull: pullFromCloud,
  push: pushToCloud,
  fetchLeaderboard,
  pushLeaderboard,
  removeLeaderboard
};

initCloud();
