/* ===================== DEVICE SYNC // SMARTWATCH, CINTA DE FC E ARQUIVOS ===================== */
/* Caminhos suportados sem depender de uma marca específica:                                  */
/*  1. Web Bluetooth: sensores/relógios que expõem o serviço padrão `heart_rate` (0x180D).      */
/*  2. Importação de arquivos exportados por Garmin, Apple, Samsung, Xiaomi, Fitbit etc.:       */
/*     GPX, TCX, CSV e JSON.                                                                   */
/* Os dados importados entram em state.health (por dia) e state.sessions (treinos reais),       */
/* então a IA, o ranking e o restante do app passam a usá-los automaticamente.                  */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const esc = value => (window.SystemAI
    ? window.SystemAI.escapeHtml(value)
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch])));

  const BLE_SERVICE = 'heart_rate';
  const BLE_CHAR = 'heart_rate_measurement';
  const MAX_SAMPLES = 4000;

  let ble = {
    device: null,
    server: null,
    characteristic: null,
    handler: null,
    connected: false,
    samples: [],
    startedAt: 0,
    timer: null,
    lastHr: null,
    disconnecting: false
  };
  let importBusy = false;

  const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function getState() {
    return window.__systemApp && window.__systemApp.state ? window.__systemApp.state : null;
  }

  function dateKey(date) {
    const d = date ? new Date(date) : new Date();
    if (isNaN(d.getTime())) return dateKey();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function todayKey() { return dateKey(new Date()); }

  function parseDateValue(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    const text = String(value).trim();
    if (!text) return null;
    const br = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (br) {
      let year = Number(br[3]);
      if (year < 100) year += 2000;
      const d = new Date(year, Number(br[2]) - 1, Number(br[1]), 12, 0, 0);
      return isNaN(d.getTime()) ? null : d;
    }
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (iso) {
      if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
        const zoned = new Date(text);
        return isNaN(zoned.getTime()) ? null : zoned;
      }
      const d = new Date(
        Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]),
        iso[4] != null ? Number(iso[4]) : 12,
        iso[5] != null ? Number(iso[5]) : 0,
        iso[6] != null ? Number(iso[6]) : 0
      );
      return isNaN(d.getTime()) ? null : d;
    }
    const parsed = new Date(text);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function parseMinutesValue(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') return Math.max(0, value);
    const text = String(value).trim();
    if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
    const clock = text.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (clock) return Number(clock[1]) * 60 + Number(clock[2]) + (clock[3] ? Number(clock[3]) / 60 : 0);
    const hm = text.match(/(\d+)\s*h(?:oras?)?\s*(\d+)?/i);
    if (hm) return Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0);
    const min = text.match(/(\d+(?:\.\d+)?)\s*min/i);
    if (min) return Number(min[1]);
    const n = Number(text.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  function parseSleepValue(value) {
    if (value == null || value === '') return null;
    const text = String(value).trim().toLowerCase().replace(',', '.');
    if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
    const clock = text.match(/^(\d{1,2}):(\d{1,2})$/);
    if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
    const hm = text.match(/(\d+(?:\.\d+)?)\s*h(?:oras?)?\s*(\d+)?/);
    if (hm) return Number(hm[1]) + (hm[2] ? Number(hm[2]) / 60 : 0);
    const min = text.match(/(\d+(?:\.\d+)?)\s*min/);
    if (min) return Number(min[1]) / 60;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeKey(value) {
    return String(value || '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /* ---------- Saúde diária ---------- */
  function healthMap() {
    const st = getState();
    if (!st) return null;
    if (!st.health || typeof st.health !== 'object' || Array.isArray(st.health)) st.health = {};
    return st.health;
  }

  function dayRecord(key) {
    const health = healthMap();
    if (!health) return null;
    const safeKey = key || todayKey();
    health[safeKey] = health[safeKey] && typeof health[safeKey] === 'object' ? health[safeKey] : {};
    return health[safeKey];
  }

  function addSource(day, source) {
    const set = new Set(String(day.source || '').split(',').map(s => s.trim()).filter(Boolean));
    if (source) set.add(String(source));
    day.source = Array.from(set).join(', ');
  }

  function setDayHealth(key, patch) {
    const day = dayRecord(key);
    if (!day) return false;
    let changed = false;
    ['steps', 'calories', 'sleepHours', 'sleepQuality', 'restingHr', 'avgHr', 'minHr', 'maxHr', 'hrSamples']
      .forEach(field => {
        if (patch[field] == null || patch[field] === '') return;
        const value = Number(patch[field]);
        if (!Number.isFinite(value)) return;
        if (Number(day[field]) !== value) changed = true;
        day[field] = value;
      });
    if (patch.source) addSource(day, patch.source);
    day.updatedAt = new Date().toISOString();
    return changed;
  }

  function mergeWorkoutHealth(key, metrics) {
    const day = dayRecord(key);
    if (!day) return;
    if (metrics.steps) day.steps = (Number(day.steps) || 0) + Math.round(Number(metrics.steps));
    if (metrics.calories) day.calories = (Number(day.calories) || 0) + Math.round(Number(metrics.calories));
    if (metrics.sleepHours) day.sleepHours = Math.max(Number(day.sleepHours) || 0, Number(metrics.sleepHours));
    if (metrics.sleepQuality) day.sleepQuality = Math.max(Number(day.sleepQuality) || 0, Number(metrics.sleepQuality));

    const addSamples = Math.max(0, Math.round(Number(metrics.hrSamples) || 0));
    if (metrics.avgHr) {
      const prevSamples = Number(day.hrSamples) || 0;
      const prevAvg = Number(day.avgHr) || 0;
      const weight = addSamples || 1;
      day.avgHr = Math.round(((prevAvg * prevSamples) + (Number(metrics.avgHr) * weight)) / (prevSamples + weight));
      day.hrSamples = prevSamples + weight;
    }
    if (metrics.minHr) day.minHr = day.minHr ? Math.min(Number(day.minHr), Number(metrics.minHr)) : Number(metrics.minHr);
    if (metrics.maxHr) day.maxHr = Math.max(Number(day.maxHr) || 0, Number(metrics.maxHr));
    if (metrics.restingHr) day.restingHr = day.restingHr ? Math.min(Number(day.restingHr), Number(metrics.restingHr)) : Number(metrics.restingHr);
    if (metrics.source) addSource(day, metrics.source);
    day.updatedAt = new Date().toISOString();
  }

  function estimateCalories(minutes, avgHr, type) {
    const base = type === 'run' ? 9 : 6;
    const factor = avgHr ? clamp(Number(avgHr) / 140, 0.7, 1.65) : 1;
    return Math.max(1, Math.round(Math.max(1, minutes) * base * factor));
  }

  function intensityFromHr(avgHr, maxHr) {
    const hr = Number(avgHr) || Number(maxHr) || 0;
    if (!hr) return 3;
    if (hr < 100) return 1;
    if (hr < 125) return 2;
    if (hr < 150) return 3;
    if (hr < 170) return 4;
    return 5;
  }

  /* ---------- Sessões importadas ---------- */
  function makeSession(data) {
    const at = data.at instanceof Date ? data.at : (parseDateValue(data.at) || new Date());
    const date = data.date || dateKey(at);
    const minutes = Math.max(1, Math.round(Number(data.minutes) || 0));
    const type = ['study', 'workout', 'run'].indexOf(data.type) >= 0
      ? data.type
      : (num(data.distance) > 0 ? 'run' : 'workout');
    const intensity = clamp(Math.round(Number(data.intensity) || intensityFromHr(data.avgHr, data.maxHr)), 1, 5);
    const xp = data.xp != null && Number.isFinite(Number(data.xp))
      ? Math.max(1, Math.round(Number(data.xp)))
      : Math.max(5, Math.round(minutes * (type === 'study' ? 2 : 3) * (type === 'study' ? (Number(data.focus) || 3) / 3 : intensity / 3)));
    return {
      id: data.id || ('dev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      externalId: data.externalId || '',
      at: at.toISOString(),
      date,
      type,
      minutes,
      intensity,
      focus: clamp(Math.round(Number(data.focus) || 3), 1, 5),
      subject: data.subject || '',
      topic: data.topic || '',
      activity: data.activity || (type === 'run' ? 'Corrida' : type === 'study' ? 'Estudo importado' : 'Treino importado'),
      distance: Number(num(data.distance).toFixed(3)),
      avgHr: data.avgHr ? Math.round(Number(data.avgHr)) : null,
      maxHr: data.maxHr ? Math.round(Number(data.maxHr)) : null,
      minHr: data.minHr ? Math.round(Number(data.minHr)) : null,
      hrSamples: Math.max(0, Math.round(Number(data.hrSamples) || 0)),
      calories: data.calories ? Math.round(Number(data.calories)) : (type === 'study' ? 0 : estimateCalories(minutes, data.avgHr, type)),
      steps: data.steps ? Math.round(Number(data.steps)) : 0,
      source: data.source || 'device',
      notes: data.notes || '',
      mergeHealth: data.mergeHealth !== false,
      xp
    };
  }

  function isDuplicate(entry) {
    const st = getState();
    if (!st) return true;
    const list = Array.isArray(st.sessions) ? st.sessions : [];
    if (entry.externalId && list.some(s => s.externalId && s.externalId === entry.externalId)) return true;
    return list.some(s => {
      if (s.date !== entry.date) return false;
      if (Math.abs((Number(s.minutes) || 0) - entry.minutes) > 2) return false;
      if (Math.abs((Number(s.distance) || 0) - (Number(entry.distance) || 0)) > 0.08) return false;
      return String(s.activity || '').toLowerCase() === String(entry.activity || '').toLowerCase();
    });
  }

  function registerSession(entry) {
    const st = getState();
    if (!st || !entry) return false;
    if (isDuplicate(entry)) return false;
    st.sessions = Array.isArray(st.sessions) ? st.sessions : [];
    st.sessions.push(entry);
    st.sessions = st.sessions.slice(-2000);

    if (entry.distance > 0) {
      st.distance = (Number(st.distance) || 0) + entry.distance;
      st.longestRun = Math.max(Number(st.longestRun) || 0, entry.distance);
      st.week = st.week && typeof st.week === 'object' ? st.week : {};
      st.week[entry.date] = (Number(st.week[entry.date]) || 0) + entry.distance;
    }
    if (entry.mergeHealth !== false) mergeWorkoutHealth(entry.date, entry);
    if (typeof addXp === 'function') addXp(entry.xp);
    return true;
  }

  function finalizeImport(result) {
    const st = getState();
    if (!st) return result;
    st.device = st.device || {};
    if (result.sessions > 0 || result.days > 0) {
      st.device.lastSyncAt = Date.now();
      st.device.lastSource = result.source || 'arquivo';
    }
    if (result.sessions > 0) {
      if (result.today && typeof updateStreak === 'function') updateStreak();
      if (typeof checkAchievements === 'function') checkAchievements();
    }
    if (typeof save === 'function') save();
    if (typeof updateUI === 'function') updateUI();
    try { window.SystemMentor?.render?.(); } catch (err) { /* ignora */ }
    window.__leaderboardRefresh?.();
    renderDevice();
    return result;
  }

  /* ---------- GPX ---------- */
  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido ou corrompido.');
    return doc;
  }
  function byLocalName(root, name) {
    return Array.from(root.getElementsByTagNameNS('*', name));
  }
  function textOf(root, name) {
    const el = byLocalName(root, name)[0];
    return el ? el.textContent.trim() : '';
  }
  function nestedValue(root, name) {
    const el = byLocalName(root, name)[0];
    if (!el) return '';
    const value = byLocalName(el, 'Value')[0];
    return (value ? value.textContent : el.textContent).trim();
  }
  function haversine(a, b) {
    const R = 6371;
    const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
    const dla = (b.lat - a.lat) * Math.PI / 180, dlo = (b.lon - a.lon) * Math.PI / 180;
    const x = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function hrStats(samples) {
    const values = samples.map(s => Number(s.hr)).filter(v => v >= 30 && v <= 240);
    if (!values.length) return { avgHr: null, maxHr: null, minHr: null, hrSamples: 0 };
    return {
      avgHr: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
      maxHr: Math.max.apply(null, values),
      minHr: Math.min.apply(null, values),
      hrSamples: values.length
    };
  }

  function importGpx(text, fileName) {
    const doc = parseXml(text);
    const points = byLocalName(doc, 'trkpt').map(pt => {
      const lat = Number(pt.getAttribute('lat'));
      const lon = Number(pt.getAttribute('lon'));
      const timeEl = byLocalName(pt, 'time')[0];
      const hrEl = byLocalName(pt, 'hr')[0];
      return {
        lat, lon,
        time: timeEl ? parseDateValue(timeEl.textContent) : null,
        hr: hrEl ? Number(hrEl.textContent) : null
      };
    }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));

    if (!points.length) throw new Error('Nenhum ponto de trilha (trkpt) encontrado no GPX.');
    let distance = 0;
    for (let i = 1; i < points.length; i++) distance += haversine(points[i - 1], points[i]);

    const timed = points.filter(p => p.time && !isNaN(p.time.getTime()));
    const start = timed.length ? timed[0].time : new Date();
    const end = timed.length ? timed[timed.length - 1].time : start;
    let minutes = timed.length > 1 ? Math.round((end - start) / 60000) : 0;
    if (!minutes) minutes = Math.max(1, Math.round(distance * 6));
    const stats = hrStats(points);
    const calories = estimateCalories(minutes, stats.avgHr, 'run');

    const entry = makeSession({
      type: 'run',
      activity: 'Corrida',
      at: start,
      date: dateKey(start),
      minutes,
      distance,
      avgHr: stats.avgHr,
      maxHr: stats.maxHr,
      minHr: stats.minHr,
      hrSamples: stats.hrSamples,
      calories,
      source: 'gpx',
      externalId: `gpx:${fileName}:${start.toISOString()}:${distance.toFixed(2)}`,
      notes: `Importado de ${fileName}`
    });
    const added = registerSession(entry);
    return { sessions: added ? 1 : 0, days: added ? 1 : 0, skipped: added ? 0 : 1, source: 'gpx', today: entry.date === todayKey() };
  }

  /* ---------- TCX ---------- */
  function importTcx(text, fileName) {
    const doc = parseXml(text);
    const laps = byLocalName(doc, 'Lap');
    let totalSeconds = 0, lapMeters = 0, totalCalories = 0, trackMeters = 0;
    const samples = [];
    const lapAverages = [];
    let lapMaxHr = 0;
    let start = null;

    const collectTrackpoints = root => {
      byLocalName(root, 'Trackpoint').forEach(tp => {
        const timeEl = byLocalName(tp, 'Time')[0];
        const time = timeEl ? parseDateValue(timeEl.textContent) : null;
        if (time && !start) start = time;
        const hr = Number(nestedValue(tp, 'HeartRateBpm')) || null;
        if (hr) samples.push({ hr });
        const dist = Number(textOf(tp, 'DistanceMeters'));
        // DistanceMeters no TCX é cumulativa (metros), não somar ponto a ponto.
        if (Number.isFinite(dist) && dist > 0) trackMeters = Math.max(trackMeters, dist);
      });
    };

    if (laps.length) {
      laps.forEach(lap => {
        const lapStart = parseDateValue(lap.getAttribute('StartTime'));
        if (lapStart && !start) start = lapStart;
        const seconds = Number(textOf(lap, 'TotalTimeSeconds')) || 0;
        totalSeconds += seconds;
        lapMeters += Number(textOf(lap, 'DistanceMeters')) || 0;
        totalCalories += Number(textOf(lap, 'Calories')) || 0;
        const avg = Number(nestedValue(lap, 'AverageHeartRateBpm')) || 0;
        const max = Number(nestedValue(lap, 'MaximumHeartRateBpm')) || 0;
        if (max) lapMaxHr = Math.max(lapMaxHr, max);
        const tps = byLocalName(lap, 'Trackpoint');
        if (tps.length) collectTrackpoints(lap);
        else if (avg) lapAverages.push({ hr: avg, weight: Math.max(1, seconds) });
      });
    } else {
      collectTrackpoints(doc);
    }

    const totalDistance = (lapMeters || trackMeters) / 1000;
    let stats;
    if (samples.length) {
      stats = hrStats(samples);
      if (!stats.maxHr && lapMaxHr) stats.maxHr = lapMaxHr;
    } else if (lapAverages.length) {
      // Sem trackpoints: usa a média ponderada das voltas (nunca a média entre média e máxima).
      const weight = lapAverages.reduce((acc, item) => acc + item.weight, 0);
      stats = {
        avgHr: Math.round(lapAverages.reduce((acc, item) => acc + item.hr * item.weight, 0) / weight),
        maxHr: lapMaxHr || null,
        minHr: null,
        hrSamples: 0
      };
    } else {
      stats = { avgHr: null, maxHr: lapMaxHr || null, minHr: null, hrSamples: 0 };
    }
    let minutes = totalSeconds > 0 ? Math.round(totalSeconds / 60) : 0;
    if (!minutes) {
      const times = byLocalName(doc, 'Time').map(el => parseDateValue(el.textContent)).filter(Boolean);
      if (times.length > 1) minutes = Math.round((times[times.length - 1] - times[0]) / 60000);
    }
    if (!minutes) minutes = Math.max(1, Math.round(totalDistance * 6));
    if (!start) start = new Date();
    const type = totalDistance > 0 ? 'run' : 'workout';
    const calories = totalCalories || estimateCalories(minutes, stats.avgHr, type);

    const entry = makeSession({
      type,
      activity: type === 'run' ? 'Corrida' : 'Treino importado',
      at: start,
      date: dateKey(start),
      minutes,
      distance: totalDistance,
      avgHr: stats.avgHr,
      maxHr: stats.maxHr,
      minHr: stats.minHr,
      hrSamples: stats.hrSamples,
      calories,
      source: 'tcx',
      externalId: `tcx:${fileName}:${start.toISOString()}:${totalDistance.toFixed(2)}`,
      notes: `Importado de ${fileName}`
    });
    const added = registerSession(entry);
    return { sessions: added ? 1 : 0, days: added ? 1 : 0, skipped: added ? 0 : 1, source: 'tcx', today: entry.date === todayKey() };
  }

  /* ---------- CSV ---------- */
  const CSV_ALIASES = {
    date: ['date', 'data', 'dia', 'day', 'timestamp', 'start_time', 'starttime', 'inicio', 'horario'],
    steps: ['steps', 'passos', 'step_count', 'stepcount', 'total_steps', 'totalsteps'],
    calories: ['calories', 'calorias', 'kcal', 'active_calories', 'activecalories', 'energia', 'energy'],
    sleepHours: ['sleep', 'sono', 'sleep_hours', 'horas_sono', 'sleep_duration', 'sleepduration', 'horas_de_sono', 'tempo_sono'],
    sleepQuality: ['sleep_quality', 'qualidade_sono', 'sleep_score', 'sleepscore'],
    restingHr: ['resting_hr', 'resting_heart_rate', 'fc_repouso', 'fcrepouso', 'hr_resting', 'restingheartrate'],
    avgHr: ['avg_hr', 'average_hr', 'fc_media', 'fcmedia', 'heart_rate_avg', 'avgheartrate', 'average_heart_rate', 'frequencia_media'],
    maxHr: ['max_hr', 'fc_maxima', 'fcmaxima', 'heart_rate_max', 'maxheartrate', 'frequencia_maxima'],
    minHr: ['min_hr', 'fc_minima', 'heart_rate_min', 'minheartrate'],
    minutes: ['minutes', 'minutos', 'duration_min', 'duracao', 'duracao_min', 'duration', 'durationminutes'],
    distance: ['distance', 'distancia', 'km', 'distance_km', 'distancekm', 'dist'],
    distanceMeters: ['distance_meters', 'distancemeters', 'distancia_metros'],
    type: ['type', 'tipo', 'activity', 'atividade', 'sport', 'modalidade'],
    subject: ['subject', 'materia', 'disciplina'],
    topic: ['topic', 'topico', 'conteudo'],
    focus: ['focus', 'foco'],
    intensity: ['intensity', 'intensidade'],
    notes: ['notes', 'observacoes', 'obs', 'notas']
  };

  function detectDelimiter(text) {
    const first = String(text).split(/\r?\n/).find(line => line.trim()) || '';
    const candidates = [',', ';', '\t'];
    return candidates.map(delim => ({ delim, count: first.split(delim).length }))
      .sort((a, b) => b.count - a.count)[0].delim;
  }

  function parseCsvRows(text) {
    const delimiter = detectDelimiter(text);
    const rows = [];
    let row = [], field = '', quoted = false;
    const source = String(text).replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"' && source[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch !== '\r') field += ch;
    }
    row.push(field);
    if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
    return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
  }

  function headerKey(header) {
    const key = normalizeKey(header);
    for (const [field, aliases] of Object.entries(CSV_ALIASES)) {
      if (aliases.indexOf(key) >= 0) return field;
    }
    return key;
  }

  function rowToObject(headers, row) {
    const out = {};
    headers.forEach((header, index) => {
      const key = headerKey(header);
      if (key) out[key] = row[index] != null ? String(row[index]).trim() : '';
    });
    return out;
  }

  function importCsv(text, fileName) {
    const rows = parseCsvRows(text);
    if (rows.length < 2) throw new Error('CSV sem linhas de dados. Inclua um cabeçalho e pelo menos uma linha.');
    const headers = rows[0].map(h => String(h).trim());
    let sessions = 0, days = 0, skipped = 0;
    let anyToday = false;

    rows.slice(1).forEach((row, index) => {
      const obj = rowToObject(headers, row);
      const parsed = importObject(obj, 'csv', fileName, index);
      sessions += parsed.session ? 1 : 0;
      days += parsed.day ? 1 : 0;
      skipped += parsed.skipped ? 1 : 0;
      anyToday = anyToday || parsed.today;
    });

    return { sessions, days, skipped, source: 'csv', today: anyToday };
  }

  /* ---------- JSON ---------- */
  function importObject(obj, source, fileName, index) {
    if (!obj || typeof obj !== 'object') return { session: false, day: false, skipped: 1, today: false };
    const date = parseDateValue(obj.date || obj.data || obj.dia || obj.at || obj.startTime || obj.start_time || obj.timestamp) || new Date();
    const key = dateKey(date);
    const steps = num(obj.steps != null ? obj.steps : obj.passos);
    const calories = num(obj.calories != null ? obj.calories : (obj.calorias != null ? obj.calorias : obj.kcal));
    const sleepHours = parseSleepValue(obj.sleepHours != null ? obj.sleepHours : (obj.sleep != null ? obj.sleep : (obj.sono != null ? obj.sono : obj.horas_sono)));
    const sleepQuality = num(obj.sleepQuality != null ? obj.sleepQuality : obj.qualidade_sono);
    const restingHr = num(obj.restingHr != null ? obj.restingHr : (obj.resting_hr != null ? obj.resting_hr : obj.fc_repouso));
    const avgHr = num(obj.avgHr != null ? obj.avgHr : (obj.avg_hr != null ? obj.avg_hr : obj.fc_media));
    const maxHr = num(obj.maxHr != null ? obj.maxHr : (obj.max_hr != null ? obj.max_hr : obj.fc_maxima));
    const minHr = num(obj.minHr != null ? obj.minHr : (obj.min_hr != null ? obj.min_hr : obj.fc_minima));

    const hasDay = steps > 0 || calories > 0 || sleepHours != null || sleepQuality > 0 || restingHr > 0 || avgHr > 0 || maxHr > 0 || minHr > 0;
    let dayChanged = false;
    if (hasDay) {
      dayChanged = setDayHealth(key, {
        steps: steps || null,
        calories: calories || null,
        sleepHours: sleepHours != null ? Number(sleepHours.toFixed(2)) : null,
        sleepQuality: sleepQuality || null,
        restingHr: restingHr || null,
        avgHr: avgHr || null,
        maxHr: maxHr || null,
        minHr: minHr || null,
        hrSamples: avgHr ? 1 : null,
        source
      });
    }

    let minutes = parseMinutesValue(obj.minutes != null ? obj.minutes : (obj.durationMinutes != null ? obj.durationMinutes : (obj.duration_min != null ? obj.duration_min : obj.duracao)));
    let distance = num(obj.distance != null ? obj.distance : (obj.distancia != null ? obj.distancia : obj.km));
    if (!distance && num(obj.distanceMeters || obj.distance_meters || obj.distancia_metros)) {
      distance = num(obj.distanceMeters || obj.distance_meters || obj.distancia_metros) / 1000;
    }
    if (!minutes && distance > 0) minutes = Math.round(distance * 6);

    const typeText = normalizeKey(obj.type || obj.tipo || obj.activity || obj.atividade || '');
    const isStudy = typeText.indexOf('study') >= 0 || typeText.indexOf('estudo') >= 0;
    const hasWorkout = minutes > 0 || distance > 0;

    let session = false;
    let today = false;
    if (hasWorkout) {
      const type = isStudy ? 'study' : (distance > 0 ? 'run' : 'workout');
      const at = parseDateValue(obj.at || obj.startTime || obj.start_time) || new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
      const entry = makeSession({
        id: obj.id,
        externalId: obj.externalId || (obj.id ? `${source}:${obj.id}` : `${source}:${fileName}:${index}:${at.toISOString()}:${minutes}:${distance.toFixed(2)}`),
        at,
        date: key,
        type,
        minutes,
        distance,
        avgHr: avgHr || null,
        maxHr: maxHr || null,
        minHr: minHr || null,
        hrSamples: avgHr ? 1 : 0,
        calories: calories || null,
        steps: steps || 0,
        intensity: obj.intensity || obj.intensidade || null,
        focus: obj.focus || obj.foco || null,
        subject: obj.subject || obj.materia || '',
        topic: obj.topic || obj.topico || '',
        activity: isStudy ? 'Estudo importado' : (obj.activity || obj.atividade || (distance > 0 ? 'Corrida' : 'Treino importado')),
        source,
        notes: obj.notes || obj.observacoes || `Importado de ${fileName}`,
        mergeHealth: !hasDay
      });
      session = registerSession(entry);
      today = entry.date === todayKey();
    }

    return { session, day: dayChanged, skipped: hasWorkout && !session ? 1 : 0, today };
  }

  function importJson(text, fileName) {
    let data;
    try { data = JSON.parse(text); } catch (err) { throw new Error('JSON inválido. Verifique o arquivo exportado.'); }
    let sessions = 0, days = 0, skipped = 0;
    let anyToday = false;

    const consume = (obj, index) => {
      const parsed = importObject(obj, 'json', fileName, index);
      sessions += parsed.session ? 1 : 0;
      days += parsed.day ? 1 : 0;
      skipped += parsed.skipped ? 1 : 0;
      anyToday = anyToday || parsed.today;
    };

    if (Array.isArray(data)) {
      data.forEach((item, index) => consume(item, index));
    } else if (data && typeof data === 'object') {
      if (data.health && typeof data.health === 'object' && !Array.isArray(data.health)) {
        Object.entries(data.health).forEach(([key, day]) => {
          if (!day || typeof day !== 'object') return;
          if (setDayHealth(key, Object.assign({}, day, { source: 'json' }))) days += 1;
        });
      }
      const list = data.days || data.healthDays || data.daily;
      if (Array.isArray(list)) list.forEach((item, index) => consume(item, index));
      const workouts = data.sessions || data.workouts || data.activities || data.treinos;
      if (Array.isArray(workouts)) workouts.forEach((item, index) => consume(item, index));
      if (data.date || data.steps || data.calories || data.sleepHours || data.minutes || data.distance) consume(data, 0);
    } else {
      throw new Error('O JSON precisa ser um objeto ou uma lista de dados.');
    }

    return { sessions, days, skipped, source: 'json', today: anyToday };
  }

  /* ---------- Importação de arquivo ---------- */
  function sniffAndImport(text, fileName) {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('O arquivo está vazio.');
    const ext = String(fileName || '').split('.').pop().toLowerCase();
    if (ext === 'gpx' || /<gpx[\s>]/i.test(trimmed)) return importGpx(text, fileName);
    if (ext === 'tcx' || /<TrainingCenterDatabase[\s>]/i.test(trimmed)) return importTcx(text, fileName);
    if (ext === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[')) return importJson(text, fileName);
    return importCsv(text, fileName);
  }

  async function handleFile(file) {
    if (!file || importBusy) return;
    importBusy = true;
    const summary = $('#importSummary');
    if (summary) summary.textContent = `Lendo ${file.name}…`;
    try {
      const text = await file.text();
      const result = sniffAndImport(text, file.name);
      finalizeImport(result);
      const parts = [];
      if (result.sessions) parts.push(`${result.sessions} treino(s) importado(s)`);
      if (result.days) parts.push(`${result.days} dia(s) de saúde`);
      if (result.skipped) parts.push(`${result.skipped} duplicado(s) ignorado(s)`);
      const message = parts.length ? parts.join(' · ') : 'Nenhum dado novo encontrado.';
      if (summary) {
        summary.textContent = message;
        summary.className = 'muted-note';
      }
      window.SystemSound?.play('confirm');
      window.showToast?.('SINCRONIZAÇÃO', `${file.name}: ${message}`);
      if (result.sessions || result.days) window.showToast?.('DADOS IMPORTADOS', 'A IA e o ranking já usam os novos dados.');
    } catch (err) {
      const message = err && err.message ? err.message : 'Falha ao ler o arquivo.';
      if (summary) {
        summary.textContent = message;
        summary.className = 'muted-note error';
      }
      window.SystemSound?.play('error');
      window.showToast?.('ARQUIVO INVÁLIDO', message);
    } finally {
      importBusy = false;
      const input = $('#deviceFile');
      if (input) input.value = '';
    }
  }

  /* ---------- Web Bluetooth (frequência cardíaca) ---------- */
  function bluetoothSupported() {
    return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
  }

  function fmtClock(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function bleElapsedSeconds() {
    return ble.startedAt ? (Date.now() - ble.startedAt) / 1000 : 0;
  }

  function bleZone(hr) {
    if (!hr) return '—';
    if (hr < 100) return 'Z1 · LEVE';
    if (hr < 125) return 'Z2 · MODERADO';
    if (hr < 150) return 'Z3 · FORTE';
    if (hr < 170) return 'Z4 · INTENSO';
    return 'Z5 · MÁXIMO';
  }

  function renderBle() {
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    const stats = hrStats(ble.samples);
    set('bleStatus', ble.connected ? 'CONECTADO' : 'DESCONECTADO');
    set('bleName', ble.device && ble.device.name ? ble.device.name : (getState()?.device?.bleName || 'Nenhum dispositivo'));
    set('bleHr', ble.lastHr ? `${ble.lastHr} bpm` : '—');
    set('bleAvg', stats.avgHr ? `${stats.avgHr} bpm` : '—');
    set('bleMin', stats.minHr ? `${stats.minHr} bpm` : '—');
    set('bleMax', stats.maxHr ? `${stats.maxHr} bpm` : '—');
    set('bleZone', bleZone(ble.lastHr));
    set('bleElapsed', fmtClock(bleElapsedSeconds()));
    set('bleSamples', String(stats.hrSamples));
    const status = $('#bleStatus');
    if (status) status.className = 'status-pill sync-pill ' + (ble.connected ? 'ok' : '');
    const connect = $('#bleConnectBtn');
    const disconnect = $('#bleDisconnectBtn');
    if (connect) connect.disabled = !bluetoothSupported() || ble.connected;
    if (disconnect) disconnect.disabled = !ble.connected;
    const support = $('#bleSupport');
    if (support) {
      support.textContent = bluetoothSupported()
        ? 'Web Bluetooth disponível neste navegador. No celular, use Chrome/Edge no Android e mantenha o sensor acordado.'
        : 'Web Bluetooth não está disponível neste navegador. Use Chrome/Edge no Android (ou desktop) e HTTPS/localhost, ou importe um arquivo do relógio.';
    }
  }

  function handleHeartRate(event) {
    const value = event.target.value;
    const flags = value.getUint8(0);
    const hr = (flags & 0x01) ? value.getUint16(1, true) : value.getUint8(1);
    if (!hr || hr < 30 || hr > 240) return;
    ble.lastHr = hr;
    ble.samples.push({ t: Date.now(), hr });
    if (ble.samples.length > MAX_SAMPLES) ble.samples = ble.samples.slice(-MAX_SAMPLES);
    renderBle();
  }

  async function connectBle() {
    if (!bluetoothSupported()) {
      window.showToast?.('BLUETOOTH', 'Este navegador não oferece Web Bluetooth. Importe um arquivo do relógio ou use Chrome/Edge no Android.');
      return;
    }
    if (ble.connected) return;
    const button = $('#bleConnectBtn');
    if (button) button.disabled = true;
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_SERVICE] }],
        optionalServices: ['battery_service']
      });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(BLE_SERVICE);
      const characteristic = await service.getCharacteristic(BLE_CHAR);
      await characteristic.startNotifications();
      ble = {
        device, server, characteristic,
        handler: handleHeartRate,
        connected: true,
        samples: [],
        startedAt: Date.now(),
        timer: null,
        lastHr: null,
        disconnecting: false
      };
      characteristic.addEventListener('characteristicvaluechanged', ble.handler);
      device.addEventListener('gattserverdisconnected', onBleDisconnected);
      const st = getState();
      if (st) {
        st.device = st.device || {};
        st.device.bleName = device.name || 'Sensor de frequência cardíaca';
        if (typeof save === 'function') save();
      }
      clearInterval(ble.timer);
      ble.timer = setInterval(renderBle, 1000);
      renderBle();
      window.SystemSound?.play('gpsStart');
      window.showToast?.('SENSOR CONECTADO', `${device.name || 'Sensor'} transmitindo frequência cardíaca.`);
    } catch (err) {
      if (button) button.disabled = false;
      const message = err && err.name === 'NotFoundError'
        ? 'Nenhum sensor selecionado. Aproxime a cinta/relógio e tente novamente.'
        : (err && err.message ? err.message : 'Falha ao conectar ao sensor.');
      window.showToast?.('BLUETOOTH', message);
      window.SystemSound?.play('error');
    }
  }

  function stopBle(finalize) {
    if (ble.disconnecting) return;
    ble.disconnecting = true;
    clearInterval(ble.timer);
    ble.timer = null;
    try {
      if (ble.characteristic && ble.handler) {
        ble.characteristic.removeEventListener('characteristicvaluechanged', ble.handler);
        ble.characteristic.stopNotifications?.();
      }
    } catch (err) { /* ignora */ }
    try {
      if (ble.device && ble.device.gatt && ble.device.gatt.connected) ble.device.gatt.disconnect();
    } catch (err) { /* ignora */ }

    const samples = ble.samples.slice();
    const stats = hrStats(samples);
    const seconds = bleElapsedSeconds();
    const minutes = Math.max(0, Math.round(seconds / 60));
    const st = getState();

    if (finalize && stats.hrSamples) {
      if (minutes >= 1) {
        const entry = makeSession({
          type: 'workout',
          activity: 'Cardio com frequência cardíaca',
          at: new Date(ble.startedAt || Date.now()),
          date: todayKey(),
          minutes,
          avgHr: stats.avgHr,
          maxHr: stats.maxHr,
          minHr: stats.minHr,
          hrSamples: stats.hrSamples,
          calories: estimateCalories(minutes, stats.avgHr, 'workout'),
          source: 'ble',
          externalId: `ble:${new Date(ble.startedAt || Date.now()).toISOString()}:${stats.avgHr}:${minutes}`,
          notes: `Sessão de FC via Bluetooth (${ble.device && ble.device.name ? ble.device.name : 'sensor'})`
        });
        const added = registerSession(entry);
        finalizeImport({ sessions: added ? 1 : 0, days: 1, skipped: added ? 0 : 1, source: 'ble', today: true });
      } else {
        mergeWorkoutHealth(todayKey(), Object.assign({}, stats, { source: 'ble' }));
        finalizeImport({ sessions: 0, days: 1, skipped: 0, source: 'ble', today: false });
      }
    } else if (st) {
      if (typeof save === 'function') save();
      renderDevice();
    }

    ble.connected = false;
    ble.device = null;
    ble.server = null;
    ble.characteristic = null;
    ble.handler = null;
    ble.samples = [];
    ble.startedAt = 0;
    ble.lastHr = null;
    ble.disconnecting = false;
    if (st) {
      st.device = st.device || {};
      st.device.bleName = '';
      if (typeof save === 'function') save();
    }
    renderBle();
    renderDevice();
    window.SystemSound?.play('gpsStop');
    if (finalize) window.showToast?.('SENSOR DESCONECTADO', 'Sessão de frequência cardíaca finalizada.');
  }

  function onBleDisconnected() {
    if (ble.connected) stopBle(true);
  }

  /* ---------- Render ---------- */
  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  function renderHealthWeek() {
    const box = $('#healthWeek');
    if (!box) return;
    const health = healthMap() || {};
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dateKey(d);
      const day = health[key] || {};
      days.push(`<div class="health-day">
        <b>${d.toLocaleDateString('pt-BR', { weekday: 'short' }).slice(0, 3).toUpperCase()}</b>
        <span title="Passos">${day.steps ? Math.round(day.steps).toLocaleString('pt-BR') : '—'}</span>
        <span title="Calorias">${day.calories ? Math.round(day.calories) : '—'}</span>
        <span title="Sono">${day.sleepHours ? Number(day.sleepHours).toFixed(1) + 'h' : '—'}</span>
        <span title="FC de repouso">${day.restingHr ? Math.round(day.restingHr) : (day.avgHr ? '~' + Math.round(day.avgHr) : '—')}</span>
      </div>`);
    }
    box.innerHTML = `<div class="health-week-head"><b>DIA</b><span>PASSOS</span><span>KCAL</span><span>SONO</span><span>FC</span></div>` + days.join('');
  }

  function renderDeviceSessions() {
    const box = $('#deviceSessions');
    if (!box) return;
    const st = getState();
    const list = (Array.isArray(st?.sessions) ? st.sessions : [])
      .filter(s => s.source && s.source !== 'manual')
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 8);
    if (!list.length) {
      box.innerHTML = '<p class="muted-note">Nenhum treino importado ainda. Conecte um sensor ou importe GPX/TCX/CSV/JSON.</p>';
      return;
    }
    box.innerHTML = list.map(s => `<div class="session-row device-session-row">
      <span class="session-type ${esc(s.type)}">${s.source.toUpperCase()}</span>
      <span class="session-date">${fmtDate(s.at)}</span>
      <strong>${esc(s.activity || 'Treino')}</strong>
      <span>${Number(s.minutes) || 0} min</span>
      <span>${s.distance ? Number(s.distance).toFixed(2) + ' km' : (s.avgHr ? s.avgHr + ' bpm' : '—')}</span>
      <span class="session-xp">${s.avgHr ? 'FC ' + s.avgHr + '/' + (s.maxHr || '—') : '—'}</span>
    </div>`).join('');
  }

  function renderDevice() {
    const st = getState();
    if (!st) return;
    const health = healthMap() || {};
    const day = health[todayKey()] || {};
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('healthTodaySteps', day.steps ? Math.round(day.steps).toLocaleString('pt-BR') : '—');
    set('healthTodayCalories', day.calories ? Math.round(day.calories).toLocaleString('pt-BR') : '—');
    set('healthTodaySleep', day.sleepHours ? Number(day.sleepHours).toFixed(1) + ' h' : '—');
    set('healthTodayRestingHr', day.restingHr ? Math.round(day.restingHr) + ' bpm' : '—');
    set('healthTodayAvgHr', day.avgHr ? Math.round(day.avgHr) + ' bpm' : '—');
    set('healthTodaySource', day.source || '—');
    set('syncLastAt', st.device?.lastSyncAt ? new Date(st.device.lastSyncAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
    set('syncLastSource', st.device?.lastSource ? String(st.device.lastSource).toUpperCase() : '—');
    const syncStatus = $('#syncStatus');
    if (syncStatus) {
      const label = ble.connected ? 'AO VIVO' : (st.device?.lastSyncAt ? 'SINCRONIZADO' : 'PRONTO');
      syncStatus.textContent = label;
      syncStatus.className = 'status-pill sync-pill ' + (ble.connected || st.device?.lastSyncAt ? 'ok' : '');
    }
    renderHealthWeek();
    renderDeviceSessions();
    renderBle();
  }

  /* ---------- Bind ---------- */
  function bind() {
    $('#bleConnectBtn')?.addEventListener('click', connectBle);
    $('#bleDisconnectBtn')?.addEventListener('click', () => stopBle(true));
    $('#deviceImportBtn')?.addEventListener('click', () => $('#deviceFile')?.click());
    $('#deviceFile')?.addEventListener('change', event => {
      const file = event.target.files && event.target.files[0];
      if (file) handleFile(file);
    });
    $('#deviceRefreshBtn')?.addEventListener('click', () => {
      renderDevice();
      window.showToast?.('SINCRONIZAÇÃO', 'Painel atualizado com os dados mais recentes.');
    });

    const drop = $('#deviceDrop');
    if (drop) {
      drop.addEventListener('click', event => {
        if (event.target.closest('button')) return;
        $('#deviceFile')?.click();
      });
      ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, event => {
        event.preventDefault();
        drop.classList.add('drag');
      }));
      ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, event => {
        event.preventDefault();
        drop.classList.remove('drag');
      }));
      drop.addEventListener('drop', event => {
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) handleFile(file);
      });
    }

    document.querySelectorAll('.tab[data-tab="sync"]').forEach(tab => {
      tab.addEventListener('click', () => setTimeout(renderDevice, 80));
    });
    window.addEventListener('beforeunload', () => {
      if (ble.connected) stopBle(false);
    });
  }

  function init() {
    bind();
    renderDevice();
  }

  window.SystemDevice = {
    init,
    render: renderDevice,
    handleFile,
    connect: connectBle,
    disconnect: () => stopBle(true),
    supported: bluetoothSupported,
    healthMap,
    importText: (text, name) => {
      const result = sniffAndImport(text, name || 'import.txt');
      return finalizeImport(result);
    }
  };
  window.__deviceRender = renderDevice;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
