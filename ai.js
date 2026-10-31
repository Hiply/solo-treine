/* ===================== SYSTEM AI // ANÁLISE REAL DE ESTUDOS E TREINOS ===================== */
/* Motor de análise local (offline) + cliente para provedores compatíveis com OpenAI.       */
/* A análise local usa dados reais registrados no app: sono, carga de treino, ACWR, foco,  */
/* consistência, volume, equilíbrio e histórico. Nada é inventado.                         */
(function (global) {
  'use strict';

  const DAY = 86400000;
  const CONFIG_KEY = 'system-ai-config';
  const PROXY_CACHE_MS = 60000;
  let proxyCache = { at: 0, value: null };

  const PRESETS = {
    openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    groq: { label: 'Groq (plano gratuito)', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b' },
    gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
    openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    ollama: { label: 'Ollama local', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
    server: { label: 'Servidor do app (proxy)', baseUrl: '', model: '' }
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const sum = (arr, fn) => arr.reduce((acc, item) => acc + fn(item), 0);

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function renderRichText(text) {
    const safe = escapeHtml(text || '');
    return safe
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>')
      .replace(/\r\n/g, '\n')
      .replace(/\n/g, '<br>');
  }

  /* ---------- Datas (sempre no fuso local, para não perder sessões perto da meia-noite) ---------- */
  function localDateKey(date) {
    const d = date ? new Date(date) : new Date();
    if (isNaN(d.getTime())) return localDateKey();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function startOfDay(date) {
    const d = date ? new Date(date) : new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function addDays(date, amount) {
    const d = new Date(date);
    d.setDate(d.getDate() + amount);
    return d;
  }
  function parseDateKey(key) {
    const parts = String(key || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return new Date(NaN);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  function parseDurationMinutes(value) {
    if (!value) return 0;
    const parts = String(value).split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
    if (parts.length === 2) return parts[0] + Math.round(parts[1] / 60);
    return parts[0] || 0;
  }

  /* ---------- Sessões reais ---------- */
  function sessionDate(session) {
    if (session && session.at) {
      const d = new Date(session.at);
      if (!isNaN(d.getTime())) return d;
    }
    if (session && session.date) {
      const d = parseDateKey(session.date);
      if (!isNaN(d.getTime())) return d;
    }
    return new Date();
  }

  function normalizeSession(session) {
    const s = session || {};
    const at = sessionDate(s);
    const type = ['study', 'workout', 'run'].indexOf(s.type) >= 0 ? s.type : 'study';
    let minutes = num(s.minutes);
    if (!minutes && type === 'run' && num(s.distance)) minutes = Math.round(num(s.distance) * 6);
    return {
      id: s.id || 'session',
      type,
      at,
      date: s.date || localDateKey(at),
      minutes: Math.max(0, Math.round(minutes)),
      intensity: clamp(num(s.intensity) || 3, 1, 5),
      focus: clamp(num(s.focus) || 3, 1, 5),
      subject: String(s.subject || '').trim(),
      topic: String(s.topic || '').trim(),
      activity: String(s.activity || (type === 'run' ? 'Corrida' : 'Treino')).trim(),
      distance: num(s.distance),
      reps: num(s.reps),
      avgHr: num(s.avgHr) || null,
      maxHr: num(s.maxHr) || null,
      minHr: num(s.minHr) || null,
      hrSamples: num(s.hrSamples),
      calories: num(s.calories),
      steps: num(s.steps),
      source: String(s.source || '').trim(),
      notes: String(s.notes || '').trim(),
      xp: num(s.xp)
    };
  }

  function collectSessions(state) {
    const src = state || {};
    const list = Array.isArray(src.sessions) ? src.sessions.map(normalizeSession) : [];
    const seen = new Set(list.map(s => `${s.date}|${num(s.distance).toFixed(2)}`));

    // Compatibilidade com históricos antigos de GPS (antes do registro de sessões).
    (Array.isArray(src.history) ? src.history : []).forEach(h => {
      const key = `${h.date || ''}|${num(h.distance).toFixed(2)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const minutes = parseDurationMinutes(h.duration) || Math.round(num(h.distance) * 6);
      list.push(normalizeSession({
        type: 'run', date: h.date, at: `${h.date || localDateKey()}T12:00:00`,
        minutes, intensity: 3, focus: 3, activity: 'Corrida', distance: num(h.distance), xp: num(h.xp)
      }));
    });

    return list.sort((a, b) => a.at - b.at);
  }

  function buildDaily(sessions, days, health) {
    const map = {};
    const healthMap = health && typeof health === 'object' ? health : {};
    const today = startOfDay(new Date());
    for (let i = days - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      const key = localDateKey(d);
      map[key] = {
        date: key, dow: d.getDay(), studyMin: 0, trainMin: 0, load: 0,
        studyCount: 0, trainCount: 0, focusSum: 0, focusN: 0, intensitySum: 0, intensityN: 0,
        steps: 0, calories: 0, sleepHours: null, sleepQuality: null,
        restingHr: null, avgHr: null, minHr: null, maxHr: null, hrSamples: 0
      };
    }
    sessions.forEach(s => {
      const day = map[s.date];
      if (!day) return;
      if (s.type === 'study') {
        day.studyMin += s.minutes;
        day.studyCount += 1;
        day.focusSum += s.focus * Math.max(1, s.minutes);
        day.focusN += Math.max(1, s.minutes);
      } else {
        day.trainMin += s.minutes;
        day.trainCount += 1;
        day.intensitySum += s.intensity * Math.max(1, s.minutes);
        day.intensityN += Math.max(1, s.minutes);
        day.load += s.minutes * s.intensity;
      }
    });
    Object.entries(healthMap).forEach(([key, h]) => {
      const day = map[key];
      if (!day || !h || typeof h !== 'object') return;
      day.steps = num(h.steps);
      day.calories = num(h.calories);
      day.sleepHours = num(h.sleepHours) || null;
      day.sleepQuality = num(h.sleepQuality) || null;
      day.restingHr = num(h.restingHr) || null;
      day.avgHr = num(h.avgHr) || null;
      day.minHr = num(h.minHr) || null;
      day.maxHr = num(h.maxHr) || null;
      day.hrSamples = num(h.hrSamples);
    });
    return { map, list: Object.values(map) };
  }

  /* ---------- Análise principal ---------- */
  function analyze(state, options) {
    const src = state || {};
    const goals = Object.assign({
      studyMinutesWeek: 300,
      trainingMinutesWeek: 150,
      sleepHours: 8
    }, src.goals || {});
    const sessions = collectSessions(src);
    const health = src.health && typeof src.health === 'object' && !Array.isArray(src.health) ? src.health : {};
    const daily28 = buildDaily(sessions, 28, health);
    const last7 = daily28.list.slice(-7);
    const prev7 = daily28.list.slice(-14, -7);

    const study7 = sum(last7, d => d.studyMin);
    const studyPrev = sum(prev7, d => d.studyMin);
    const train7 = sum(last7, d => d.trainMin);
    const trainPrev = sum(prev7, d => d.trainMin);
    const load7 = sum(last7, d => d.load);
    const loadPrev = sum(prev7, d => d.load);
    const load28 = sum(daily28.list, d => d.load);

    const activeDays7 = last7.filter(d => d.studyMin > 0 || d.trainMin > 0).length;
    const trainingDays7 = last7.filter(d => d.trainMin > 0).length;
    const studyDays7 = last7.filter(d => d.studyMin > 0).length;
    const focusN = sum(last7, d => d.focusN);
    const focusSum = sum(last7, d => d.focusSum);
    const intensityN = sum(last7, d => d.intensityN);
    const intensitySum = sum(last7, d => d.intensitySum);
    const avgFocus = focusN ? focusSum / focusN : null;
    const avgIntensity = intensityN ? intensitySum / intensityN : null;

    // ACWR: carga aguda (7d) / média crônica semanal (28d / 4).
    // Só é confiável com histórico mínimo de treino; com 1–2 sessões o divisor
    // crônico fica artificialmente baixo e geraria falsos alertas de sobrecarga.
    const trainingDays28 = daily28.list.filter(d => d.trainMin > 0).length;
    const acwrReliable = trainingDays28 >= 6;
    const chronic = load28 / 4;
    const acwr = acwrReliable && chronic > 0 ? load7 / chronic : null;
    const meanLoad = load7 / 7;
    const variance = last7.reduce((acc, d) => acc + Math.pow(d.load - meanLoad, 2), 0) / 7;
    const sd = Math.sqrt(variance);
    const monotony = sd > 0.001 ? meanLoad / sd : (meanLoad > 0 ? 3 : 0);
    const strain = load7 * monotony;

    // Check-ins de sono/humor/energia + sono vindo do relógio/arquivo.
    const checkins = src.checkins || {};
    let sleepSum = 0, sleepN = 0, moodSum = 0, moodN = 0, energySum = 0, energyN = 0;
    let deviceSleepDays7 = 0;
    last7.forEach(d => {
      const c = checkins[d.date];
      const deviceSleep = num(d.sleepHours);
      const sleepValue = c && num(c.sleep) > 0 ? num(c.sleep) : (deviceSleep > 0 ? deviceSleep : null);
      if (sleepValue) { sleepSum += sleepValue; sleepN += 1; }
      if (!c && deviceSleep > 0) deviceSleepDays7 += 1;
      if (!c) return;
      if (num(c.mood) > 0) { moodSum += num(c.mood); moodN += 1; }
      if (num(c.energy) > 0) { energySum += num(c.energy); energyN += 1; }
    });
    const avgSleep = sleepN ? sleepSum / sleepN : null;
    const avgMood = moodN ? moodSum / moodN : null;
    const avgEnergy = energyN ? energySum / energyN : null;

    // Métricas de dispositivo: passos, calorias e frequência cardíaca.
    const steps7 = sum(last7, d => d.steps);
    const calories7 = sum(last7, d => d.calories);
    const stepDays7 = last7.filter(d => d.steps > 0).length;
    const calorieDays7 = last7.filter(d => d.calories > 0).length;
    const healthDays7 = last7.filter(d =>
      d.steps > 0 || d.calories > 0 || d.sleepHours || d.restingHr || d.avgHr || d.maxHr
    ).length;
    const avgSteps7 = stepDays7 ? Math.round(steps7 / stepDays7) : null;
    const avgCalories7 = calorieDays7 ? Math.round(calories7 / calorieDays7) : null;
    const hrWeighted = last7.reduce((acc, d) => {
      if (!d.avgHr) return acc;
      const weight = d.hrSamples || 1;
      acc.sum += d.avgHr * weight;
      acc.n += weight;
      return acc;
    }, { sum: 0, n: 0 });
    const avgHr7 = hrWeighted.n ? Math.round(hrWeighted.sum / hrWeighted.n) : null;
    const maxHr7 = last7.reduce((max, d) => Math.max(max, num(d.maxHr)), 0) || null;
    const restingDays7 = last7.filter(d => d.restingHr > 0);
    const avgRestingHr = restingDays7.length
      ? Math.round(sum(restingDays7, d => d.restingHr) / restingDays7.length)
      : null;
    const restingDaysPrev = prev7.filter(d => d.restingHr > 0);
    const avgRestingHrPrev = restingDaysPrev.length
      ? sum(restingDaysPrev, d => d.restingHr) / restingDaysPrev.length
      : null;
    const restingHrTrend = avgRestingHr !== null && avgRestingHrPrev !== null
      ? Math.round(avgRestingHr - avgRestingHrPrev)
      : null;

    // Dias consecutivos de treino (se hoje ainda não treinou, começa a contar de ontem).
    let consecutive = 0;
    for (let i = last7.length - 1; i >= 0; i--) {
      const d = last7[i];
      if (d.trainMin > 0) consecutive += 1;
      else if (i === last7.length - 1) continue;
      else break;
    }
    const restDays7 = 7 - trainingDays7;

    // Distribuição por matéria e por atividade (28 dias).
    const subjects = {};
    const activities = {};
    sessions.forEach(s => {
      if (s.type === 'study') {
        const key = s.subject || 'Geral';
        if (!subjects[key]) subjects[key] = { name: key, minutes: 0, count: 0, focusSum: 0, focusN: 0 };
        subjects[key].minutes += s.minutes;
        subjects[key].count += 1;
        subjects[key].focusSum += s.focus * Math.max(1, s.minutes);
        subjects[key].focusN += Math.max(1, s.minutes);
      } else {
        const key = s.activity || 'Treino';
        if (!activities[key]) activities[key] = { name: key, minutes: 0, count: 0 };
        activities[key].minutes += s.minutes;
        activities[key].count += 1;
      }
    });
    const subjectList = Object.values(subjects)
      .map(x => ({ name: x.name, minutes: x.minutes, count: x.count, avgFocus: x.focusN ? x.focusSum / x.focusN : null }))
      .sort((a, b) => b.minutes - a.minutes);
    const activityList = Object.values(activities).sort((a, b) => b.minutes - a.minutes);

    // Pontuações (0–100).
    const goalStudy = Math.max(60, goals.studyMinutesWeek);
    const goalTrain = Math.max(30, goals.trainingMinutesWeek);
    const consistency = clamp(Math.round((activeDays7 / 7) * 100), 0, 100);

    let trainingScore = clamp(Math.round(clamp(train7 / goalTrain, 0, 1.4) * 100), 0, 100);
    if (acwr !== null && acwr > 1.5) trainingScore = clamp(trainingScore - Math.round((acwr - 1.5) * 80), 20, 100);
    if (acwr !== null && acwr > 0 && acwr < 0.8) trainingScore = clamp(trainingScore - 15, 0, 100);

    const focusScore = avgFocus ? clamp(Math.round((avgFocus / 5) * 100), 0, 100) : 50;
    const studyScore = clamp(Math.round(
      0.55 * clamp(study7 / goalStudy, 0, 1) * 100 +
      0.25 * focusScore +
      0.20 * clamp(studyDays7 / 5, 0, 1) * 100
    ), 0, 100);

    const totalMin7 = study7 + train7;
    const studyShare = totalMin7 > 0 ? study7 / totalMin7 : 0.5;
    const balanceScore = clamp(Math.round(100 - Math.abs(studyShare - 0.55) * 180), 0, 100);

    let recovery = 100;
    if (avgSleep !== null) recovery -= clamp((goals.sleepHours - avgSleep) * 14, 0, 45);
    else recovery -= 8;
    if (consecutive >= 5) recovery -= (consecutive - 4) * 8;
    if (acwr !== null && acwr > 1.5) recovery -= Math.round((acwr - 1.5) * 50);
    if (avgEnergy !== null) recovery += (avgEnergy - 3) * 4;
    if (avgMood !== null) recovery += (avgMood - 3) * 3;
    if (restingHrTrend !== null && restingHrTrend >= 5) recovery -= 6;
    if (restingHrTrend !== null && restingHrTrend <= -3) recovery += 3;
    if (restDays7 >= 1) recovery += 5;
    recovery = clamp(Math.round(recovery), 0, 100);

    const readiness = clamp(Math.round(
      0.40 * recovery + 0.20 * consistency + 0.20 * trainingScore + 0.20 * studyScore
    ), 0, 100);
    const overall = clamp(Math.round(
      0.30 * readiness + 0.20 * studyScore + 0.20 * trainingScore +
      0.15 * consistency + 0.15 * balanceScore
    ), 0, 100);

    const trend = (current, previous) => {
      if (previous <= 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    const ctx = {
      sessions, goals, last7, daily28, health,
      study7, studyPrev, train7, trainPrev, load7, loadPrev, load28,
      activeDays7, trainingDays7, studyDays7, trainingDays28, restDays7, consecutive,
      avgFocus, avgIntensity, avgSleep, avgMood, avgEnergy, deviceSleepDays7,
      steps7, calories7, stepDays7, calorieDays7, healthDays7,
      avgSteps7, avgCalories7, avgHr7, maxHr7, avgRestingHr, restingHrTrend,
      chronic, acwr, acwrReliable, monotony, strain,
      subjectList, activityList,
      scores: { readiness, study: studyScore, training: trainingScore, consistency, balance: balanceScore, recovery, overall },
      trends: { study: trend(study7, studyPrev), training: trend(train7, trainPrev), load: trend(load7, loadPrev) },
      streak: num(src.streak),
      cleanStreak: num(src.cleanStreak),
      penalty: src.penalty || { active: false, progress: 0, target: 50 },
      level: num(src.level) || 1
    };

    ctx.insights = buildInsights(ctx);
    ctx.recommendations = buildRecommendations(ctx);
    ctx.plan = buildPlan(ctx);
    ctx.summary = buildSummary(ctx);

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      scores: ctx.scores,
      metrics: {
        studyMinutes7: study7,
        studyMinutesPrev7: studyPrev,
        trainingMinutes7: train7,
        trainingMinutesPrev7: trainPrev,
        load7: Math.round(load7),
        loadPrev7: Math.round(loadPrev),
        load28: Math.round(load28),
        chronicWeeklyLoad: Math.round(chronic),
        acwr: acwr === null ? null : Number(acwr.toFixed(2)),
        acwrReliable,
        trainingDays28,
        monotony: Number(monotony.toFixed(2)),
        strain: Math.round(strain),
        activeDays7,
        trainingDays7,
        studyDays7,
        restDays7,
        consecutiveTrainingDays: consecutive,
        avgFocus: avgFocus === null ? null : Number(avgFocus.toFixed(1)),
        avgIntensity: avgIntensity === null ? null : Number(avgIntensity.toFixed(1)),
        avgSleep: avgSleep === null ? null : Number(avgSleep.toFixed(1)),
        avgMood: avgMood === null ? null : Number(avgMood.toFixed(1)),
        avgEnergy: avgEnergy === null ? null : Number(avgEnergy.toFixed(1)),
        deviceSleepDays7,
        steps7: Math.round(steps7),
        calories7: Math.round(calories7),
        stepDays7,
        calorieDays7,
        healthDays7,
        avgSteps7,
        avgCalories7,
        avgHr7,
        maxHr7,
        avgRestingHr,
        restingHrTrend,
        studyShare: Number(studyShare.toFixed(2)),
        totalSessions: sessions.length,
        subjectList,
        activityList
      },
      trends: ctx.trends,
      insights: ctx.insights,
      recommendations: ctx.recommendations,
      plan: ctx.plan,
      summary: ctx.summary,
      goals
    };
  }

  function buildInsights(c) {
    const out = [];
    const add = (severity, title, text) => out.push({ severity, title, text });

    if (!c.sessions.length) {
      add('info', 'Dados insuficientes', 'Registre sua primeira sessão de estudo ou treino. O Mentor calcula carga, foco, recuperação e prontidão a partir dos seus dados reais.');
      return out;
    }

    if (c.acwr > 1.5) {
      add('risk', 'Carga aguda alta', `Seu volume dos últimos 7 dias está ${Math.round((c.acwr - 1) * 100)}% acima da média das últimas 4 semanas (ACWR ${c.acwr.toFixed(2)}). Risco elevado de fadiga e lesão. Reduza 20–30% do volume nesta semana.`);
    } else if (c.acwr > 1.3) {
      add('warn', 'Progressão acelerada', `ACWR em ${c.acwr.toFixed(2)}. Aumente a carga em passos menores (5–10%) e mantenha um dia leve entre estímulos fortes.`);
    } else if (c.acwr > 0 && c.acwr < 0.8) {
      add('warn', 'Carga abaixo do ideal', `ACWR em ${c.acwr.toFixed(2)}. Você está treinando menos que sua média recente; aumente gradualmente para não perder condicionamento.`);
    } else if (c.acwr !== null && c.acwr > 0) {
      add('good', 'Carga equilibrada', `ACWR em ${c.acwr.toFixed(2)} — dentro da faixa considerada segura (0,8–1,3). Mantenha a progressão gradual.`);
    }
    if (c.acwr === null && c.trainingDays28 > 0) {
      add('info', 'ACWR em formação', `Há ${c.trainingDays28} dia(s) de treino registrados nas últimas 4 semanas. O ACWR fica confiável a partir de 6 dias; até lá, a prontidão usa volume, sono, foco e consistência — sem alarmes falsos de sobrecarga.`);
    }

    if (c.monotony > 2.2) {
      add('warn', 'Monotonia de treino', `Índice de monotonia ${c.monotony.toFixed(2)}. Varie intensidade e inclua um dia leve/descanso para reduzir o risco de overtraining.`);
    }
    if (c.consecutive >= 6) {
      add('risk', `Sem descanso há ${c.consecutive} dias`, 'O corpo consolida o ganho no descanso. Programe 1 dia leve ou de recuperação nas próximas 24h.');
    }
    if (c.avgSleep !== null && c.avgSleep < 7) {
      add('warn', 'Sono insuficiente', `Média de ${c.avgSleep.toFixed(1)}h de sono nos últimos 7 dias. Abaixo de 7h, recuperação e consolidação da memória caem. Meta: ${c.goals.sleepHours}h.`);
    }
    if (c.avgSleep === null) {
      add('info', 'Sono não registrado', 'Faça o check-in diário de sono para o cálculo de prontidão ficar mais preciso.');
    }
    if (c.stepDays7 >= 3 && c.avgSteps7 !== null && c.avgSteps7 < 6000) {
      add('warn', 'Passos abaixo do ideal', `Média de ${c.avgSteps7.toLocaleString('pt-BR')} passos/dia nos dias com dados. Abaixo de 6 mil, a atividade física fora do treino fica baixa. Meta: 7–8 mil passos/dia.`);
    } else if (c.stepDays7 >= 3 && c.avgSteps7 !== null && c.avgSteps7 >= 8000) {
      add('good', 'Atividade diária forte', `Média de ${c.avgSteps7.toLocaleString('pt-BR')} passos/dia. Esse volume de atividade fora do treino melhora recuperação e gasto energético.`);
    }
    if (c.avgRestingHr !== null && c.restingHrTrend !== null && c.restingHrTrend >= 5) {
      add('warn', 'FC de repouso elevada', `Sua FC de repouso subiu ${c.restingHrTrend} bpm em relação à semana anterior (agora ${c.avgRestingHr} bpm). Pode indicar fadiga, sono ruim ou início de doença. Priorize recuperação e observe por 2–3 dias.`);
    } else if (c.avgRestingHr !== null && c.restingHrTrend !== null && c.restingHrTrend <= -3) {
      add('good', 'FC de repouso caindo', `Sua FC de repouso caiu ${Math.abs(c.restingHrTrend)} bpm (${c.avgRestingHr} bpm). Sinal positivo de adaptação cardiovascular.`);
    }
    if (c.healthDays7 > 0) {
      const parts = [];
      if (c.avgSteps7 !== null) parts.push(`${c.avgSteps7.toLocaleString('pt-BR')} passos/dia`);
      if (c.avgCalories7 !== null) parts.push(`${c.avgCalories7} kcal/dia`);
      if (c.avgHr7 !== null) parts.push(`FC média ${c.avgHr7} bpm`);
      if (c.avgRestingHr !== null) parts.push(`FC repouso ${c.avgRestingHr} bpm`);
      add('info', 'Dados do dispositivo', `Métricas importadas em ${c.healthDays7} dia(s) da última semana: ${parts.join(' · ')}. Elas entram na prontidão, no gasto energético e na leitura de recuperação.`);
    }
    if (c.study7 < c.goals.studyMinutesWeek * 0.6) {
      add('warn', 'Estudo abaixo da meta', `${c.study7} min estudados nos últimos 7 dias (meta: ${c.goals.studyMinutesWeek} min). Adicione blocos de 25–50 min na agenda.`);
    }
    if (c.avgFocus !== null && c.avgFocus < 3) {
      add('warn', 'Foco baixo', `Foco médio ${c.avgFocus.toFixed(1)}/5. Use Pomodoro 25/5, deixe o celular longe da mesa e trabalhe em uma única tarefa por bloco.`);
    }
    if (c.scores.balance < 45) {
      add('warn', 'Desequilíbrio estudo/treino', 'A distribuição entre estudo e treino está fora do ideal. Ajuste para que nenhuma área domine a semana.');
    }
    if (c.scores.consistency >= 70) {
      add('good', 'Consistência forte', `Você esteve ativo em ${c.activeDays7}/7 dias. Consistência é o fator que mais move o rank.`);
    }
    const bestSubject = c.subjectList.find(s => s.avgFocus !== null && s.avgFocus >= 4);
    if (bestSubject) {
      add('good', 'Melhor matéria', `${bestSubject.name} tem seu maior foco médio (${bestSubject.avgFocus.toFixed(1)}/5). Use esse horário para o conteúdo mais difícil.`);
    }
    if (c.penalty && c.penalty.active) {
      add('risk', 'Penalidade ativa', 'A quest diária não foi cumprida. Cumpra a penalidade para restaurar 100% do ganho de XP.');
    }
    if (c.streak >= 7) {
      add('good', `Sequência de ${c.streak} dias`, 'Streak consistente. Mantenha o mínimo viável nos dias difíceis para não quebrar a corrente.');
    }

    return out.slice(0, 7);
  }

  function buildRecommendations(c) {
    const out = [];
    const push = (priority, area, title, detail) => out.push({ priority, area, title, detail });

    if (!c.sessions.length) {
      push(1, 'onboarding', 'Comece registrando', 'Adicione uma sessão de estudo de 25 min e um treino curto para liberar a análise completa.');
    }
    if (c.acwr > 1.5) {
      push(1, 'treino', 'Semana de deload', 'Reduza 20–30% do volume, mantenha a técnica e priorize sono. Volte a progredir em 7 dias.');
    }
    if (c.avgSleep !== null && c.avgSleep < 7) {
      push(1, 'recuperação', 'Dormir 7–9h', 'Defina horário fixo de sono e evite telas 30 min antes. Sem recuperação, o treino vira dano.');
    }
    if (c.consecutive >= 6) {
      push(1, 'recuperação', 'Dia de descanso ativo', 'Caminhada de 20–30 min + mobilidade. Nada de alta intensidade hoje.');
    }
    if (c.avgRestingHr !== null && c.restingHrTrend !== null && c.restingHrTrend >= 5) {
      push(1, 'recuperação', 'Investigar FC de repouso', 'Reduza a intensidade por 2–3 dias, durma 7–9h e hidrate-se. Se a FC continuar alta ou houver febre/dor, procure um profissional.');
    }
    if (c.stepDays7 >= 3 && c.avgSteps7 !== null && c.avgSteps7 < 6000) {
      push(2, 'atividade', 'Meta de passos', `Adicione 2 caminhadas de 15 min para chegar a 7–8 mil passos/dia (média atual: ${c.avgSteps7.toLocaleString('pt-BR')}).`);
    }
    if (c.study7 < c.goals.studyMinutesWeek * 0.6) {
      push(2, 'estudo', 'Blocos de estudo', 'Programe 2 blocos de 50 min (com 10 min de pausa) nos próximos 3 dias.');
    }
    if (c.avgFocus !== null && c.avgFocus < 3) {
      push(2, 'estudo', 'Protocolo de foco', 'Pomodoro 25/5, celular em outro cômodo e uma matéria por bloco.');
    }
    if (c.scores.balance < 45) {
      push(2, 'equilíbrio', 'Reequilibrar a semana', 'Reserve dias fixos para estudo e treino; evite compensar tudo no fim de semana.');
    }
    if (c.train7 < c.goals.trainingMinutesWeek * 0.5) {
      push(3, 'treino', 'Retomar o volume', 'Faça 2 treinos de 30 min esta semana (força + cardio leve).');
    }

    const rotation = ['Força – empurrar', 'Força – puxar', 'Pernas', 'Core e mobilidade', 'Cardio leve'];
    const lastActivity = (c.activityList[0] && c.activityList[0].name) || '';
    const lastKey = lastActivity.toLowerCase().split(/[\s–-]+/)[0] || '';
    let nextIndex = 0;
    for (let i = 0; i < rotation.length; i++) {
      if (lastKey && rotation[i].toLowerCase().indexOf(lastKey) === 0) { nextIndex = (i + 1) % rotation.length; break; }
    }
    const nextWorkout = rotation[nextIndex];
    const heavy = c.acwr > 1.5;
    push(3, 'treino', `Próximo treino: ${nextWorkout}`,
      `${heavy ? '25–35' : '35–45'} min, intensidade ${heavy ? '5' : '7'}/10. Aqueça 5 min e finalize com alongamento.`);

    const weakSubject = c.subjectList.find(s => s.avgFocus !== null && s.avgFocus < 3);
    const subject = (weakSubject && weakSubject.name) || (c.subjectList[c.subjectList.length - 1] && c.subjectList[c.subjectList.length - 1].name) || 'a matéria mais difícil';
    push(3, 'estudo', `Revisão de ${subject}`, '25 min de revisão ativa (flashcards ou questões) + 10 min de resumo sem consultar.');

    return out.sort((a, b) => a.priority - b.priority).slice(0, 6);
  }

  function buildPlan(c) {
    const weekdays = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
    const rotation = ['Força – empurrar', 'Força – puxar', 'Pernas', 'Core e mobilidade', 'Cardio leve'];
    const trainingDays = c.scores.readiness < 50 ? [2, 5] : c.scores.readiness < 70 ? [1, 3, 5] : [1, 2, 4, 6];
    const mainSubject = (c.subjectList[0] && c.subjectList[0].name) || 'matéria principal';
    const out = [];
    const today = startOfDay(new Date());
    let trainCount = 0;

    for (let i = 1; i <= 7; i++) {
      const date = addDays(today, i);
      const train = trainingDays.indexOf(i) >= 0;
      if (train) trainCount += 1;
      out.push({
        date: localDateKey(date),
        label: weekdays[date.getDay()],
        study: i === 7 ? 'Revisão leve · 25 min' : `50 min de ${mainSubject}`,
        training: train ? `${rotation[(trainCount - 1) % rotation.length]} · 30–40 min` : (i === 4 || i === 7 ? 'Descanso ativo · caminhada 20 min' : 'Sem treino de força'),
        rest: !train && (i === 4 || i === 7),
        intensity: train ? (c.acwr > 1.5 ? 5 : 7) : 0
      });
    }
    return out;
  }

  function readinessLabel(value) {
    if (value >= 85) return 'PRONTO PARA EVOLUIR';
    if (value >= 70) return 'PRONTO PARA TREINAR';
    if (value >= 50) return 'RECUPERAÇÃO MODERADA';
    return 'RECUPERAÇÃO PRIORITÁRIA';
  }

  function buildSummary(c) {
    const s = c.scores;
    const lines = [];
    lines.push(`PRONTIDÃO: ${s.readiness}/100 · ${readinessLabel(s.readiness)}`);
    lines.push(`ESTUDO: ${s.study}/100 · TREINO: ${s.training}/100 · EQUILÍBRIO: ${s.balance}/100`);
    lines.push('');
    lines.push('DIAGNÓSTICO');
    if (!c.sessions.length) {
      lines.push('Ainda não há sessões registradas. O Mentor precisa de dados reais para calcular carga, foco e recuperação.');
    } else {
      lines.push(`Nos últimos 7 dias: ${c.study7} min de estudo (${c.trends.study >= 0 ? '+' : ''}${c.trends.study}% vs. semana anterior) e ${c.train7} min de treino (${c.trends.training >= 0 ? '+' : ''}${c.trends.training}%).`);
      const acwrText = c.acwr === null
        ? (c.trainingDays28 > 0 ? 'em formação (histórico insuficiente)' : 'sem treino registrado')
        : c.acwr.toFixed(2);
      lines.push(`Carga aguda ${Math.round(c.load7)} UA · crônica ${Math.round(c.chronic)} UA/semana · ACWR ${acwrText} · monotonia ${c.monotony.toFixed(2)}.`);
      lines.push(`Foco médio ${c.avgFocus === null ? 'não registrado' : c.avgFocus.toFixed(1) + '/5'} · sono ${c.avgSleep === null ? 'não registrado' : c.avgSleep.toFixed(1) + 'h'} · dias ativos ${c.activeDays7}/7.`);
      if (c.healthDays7 > 0) {
        const parts = [];
        if (c.avgSteps7 !== null) parts.push(`${c.avgSteps7.toLocaleString('pt-BR')} passos/dia`);
        if (c.avgCalories7 !== null) parts.push(`${c.avgCalories7} kcal/dia`);
        if (c.avgRestingHr !== null) parts.push(`FC repouso ${c.avgRestingHr} bpm`);
        if (c.avgHr7 !== null) parts.push(`FC média ${c.avgHr7} bpm`);
        if (c.maxHr7 !== null) parts.push(`FC máxima ${c.maxHr7} bpm`);
        lines.push(`Dispositivo (${c.healthDays7} dia(s) com dados): ${parts.join(' · ')}.`);
      }
    }
    lines.push('');
    lines.push('PONTOS FORTES');
    const good = c.insights.filter(i => i.severity === 'good');
    lines.push(good.length ? good.slice(0, 2).map(i => `• ${i.title}: ${i.text}`).join('\n') : '• Registre mais alguns dias para o Sistema identificar seus pontos fortes.');
    lines.push('');
    lines.push('RISCOS E ATENÇÃO');
    const risky = c.insights.filter(i => i.severity === 'risk' || i.severity === 'warn');
    lines.push(risky.length ? risky.slice(0, 3).map(i => `• ${i.title}: ${i.text}`).join('\n') : '• Nenhum risco relevante detectado nos dados atuais.');
    lines.push('');
    lines.push('PRÓXIMOS PASSOS');
    lines.push(c.recommendations.slice(0, 3).map(r => `• ${r.title}: ${r.detail}`).join('\n'));
    lines.push('');
    lines.push('Análise local baseada apenas nos dados registrados. Não substitui acompanhamento médico ou nutricional.');
    return lines.join('\n');
  }

  /* ---------- Configuração do provedor ---------- */
  function getConfig() {
    let saved = {};
    try { saved = JSON.parse(global.localStorage.getItem(CONFIG_KEY) || '{}') || {}; } catch (err) { saved = {}; }
    let preset = PRESETS[saved.preset] ? saved.preset : 'groq';
    if (saved.preset === 'openai' && !saved.apiKey) preset = 'groq';
    const config = Object.assign({
      preset,
      baseUrl: PRESETS[preset].baseUrl,
      model: PRESETS[preset].model,
      apiKey: '',
      temperature: 0.5
    }, saved, { preset });
    if (preset !== saved.preset) {
      config.baseUrl = PRESETS[preset].baseUrl;
      config.model = PRESETS[preset].model;
      config.apiKey = '';
    } else if (preset === 'groq' && ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'].includes(config.model)) {
      config.model = PRESETS.groq.model;
    }
    return config;
  }

  function saveConfig(config) {
    const clean = {
      preset: config.preset || 'groq',
      baseUrl: String(config.baseUrl || '').trim().replace(/\/+$/, ''),
      model: String(config.model || '').trim(),
      apiKey: String(config.apiKey || '').trim(),
      temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.5
    };
    global.localStorage.setItem(CONFIG_KEY, JSON.stringify(clean));
    proxyCache = { at: 0, value: null };
    return clean;
  }

  function clearConfig() {
    global.localStorage.removeItem(CONFIG_KEY);
    proxyCache = { at: 0, value: null };
  }

  function providerLabel(config) {
    const cfg = config || getConfig();
    if (cfg.apiKey && cfg.baseUrl) return cfg.model || 'IA externa';
    if (cfg.preset === 'server') return 'Servidor local';
    return 'Local (offline)';
  }

  async function getProxyStatus(force) {
    const now = Date.now();
    if (!force && proxyCache.value && now - proxyCache.at < PROXY_CACHE_MS) return proxyCache.value;
    const result = { enabled: false, model: '', baseUrl: '' };
    try {
      if (global.location && /^https?:$/.test(global.location.protocol)) {
        const res = await fetchWithTimeout('/api/ai/status', { cache: 'no-store' }, 4000);
        if (res.ok) {
          const data = await res.json();
          result.enabled = !!data.enabled;
          result.model = data.model || '';
          result.baseUrl = data.baseUrl || '';
        }
      }
    } catch (err) { /* servidor estático: segue em modo local */ }
    proxyCache = { at: now, value: result };
    return result;
  }

  async function getProviderInfo() {
    const cfg = getConfig();
    if (canCallDirect(cfg)) return { mode: 'direct', label: cfg.model || 'IA externa', config: cfg };
    const proxy = await getProxyStatus();
    if (proxy.enabled) return { mode: 'proxy', label: `Servidor: ${proxy.model || 'IA'}`, config: cfg };
    return { mode: 'local', label: 'Local (offline)', config: cfg };
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 45000);
    return fetch(url, Object.assign({}, options, { signal: controller.signal }))
      .finally(() => clearTimeout(timer));
  }

  function safeErrorText(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.length > 220 ? clean.slice(0, 220) + '…' : clean;
  }

  function extractText(data) {
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof text === 'string' && text.trim()) return text.trim();
    if (Array.isArray(text)) {
      const joined = text.map(part => (typeof part === 'string' ? part : part && part.text) || '').join('');
      if (joined.trim()) return joined.trim();
    }
    throw new Error('O provedor respondeu sem conteúdo.');
  }

  const SYSTEM_PROMPT = [
    'Você é o MENTOR DO SISTEMA, um treinador e orientador de estudos de um estudante brasileiro do 3º ano do ensino médio.',
    'Você recebe um JSON com métricas reais registradas no app: sono, minutos de estudo, foco, carga de treino, ACWR, monotonia, consistência, matérias, histórico recente e, quando disponível, dados de dispositivo (passos, calorias, frequência cardíaca de repouso/média/máxima).',
    'Regras obrigatórias:',
    '1. Use APENAS os dados fornecidos. Não invente lesões, diagnósticos, notas, passos ou sessões.',
    '2. Não prescreva medicamentos, dietas clínicas ou diagnósticos médicos. Em caso de dor persistente, FC de repouso muito alterada ou mal-estar, recomende procurar um profissional.',
    '3. Seja específico e acionável: diga o que fazer, quanto tempo, com que intensidade e quando.',
    '4. Considere que o estudante precisa equilibrar estudo para provas, treino e sono.',
    '5. Escreva em português do Brasil, com tom de Sistema de Solo Leveling, mas humano, direto e sem exageros.',
    '6. Responda em no máximo 450 palavras, com as seções: DIAGNÓSTICO, PONTOS FORTES, RISCOS, PRÓXIMOS 7 DIAS.',
    '7. Se os dados forem insuficientes, diga exatamente o que registrar para melhorar a análise.'
  ].join('\n');

  function buildMessages(analysis, state) {
    const recent = (analysis.sessions || []).slice(-12).map(s => ({
      tipo: s.type,
      data: s.date,
      minutos: s.minutes,
      intensidade: s.intensity,
      foco: s.focus,
      materia: s.subject || undefined,
      topico: s.topic || undefined,
      atividade: s.activity || undefined,
      km: s.distance || undefined,
      fcMedia: s.avgHr || undefined,
      fcMaxima: s.maxHr || undefined,
      calorias: s.calories || undefined,
      fonte: s.source || undefined,
      observacoes: s.notes || undefined
    }));
    const context = {
      geradoEm: analysis.generatedAt,
      nivel: state && state.level,
      rank: state && state.rank,
      pontuacoes: analysis.scores,
      metricas: analysis.metrics,
      tendencias: analysis.trends,
      metas: analysis.goals,
      dispositivo: state && state.device ? {
        ultimaSincronizacao: state.device.lastSyncAt ? new Date(state.device.lastSyncAt).toISOString() : undefined,
        fonte: state.device.lastSource || undefined
      } : undefined,
      insightsLocais: analysis.insights,
      recomendacoesLocais: analysis.recommendations,
      sessoesRecentes: recent
    };
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'Analise os dados reais abaixo e produza o acompanhamento do Mentor:\n' + JSON.stringify(context, null, 2) }
    ];
  }

  function isLocalProviderUrl(url) {
    return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(String(url || ''));
  }

  function canCallDirect(config) {
    const cfg = config || {};
    if (!cfg.baseUrl) return false;
    return !!cfg.apiKey || cfg.preset === 'ollama' || isLocalProviderUrl(cfg.baseUrl);
  }

  async function callDirect(config, messages) {
    const base = String(config.baseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('URL base do provedor não configurada.');
    if (!config.apiKey && !isLocalProviderUrl(base) && config.preset !== 'ollama') {
      throw new Error('Chave de API não configurada.');
    }
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const res = await fetchWithTimeout(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model || 'gpt-4o-mini',
        messages,
        temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.5,
        max_tokens: 1100
      })
    }, 60000);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Provedor respondeu ${res.status}. ${safeErrorText(body)}`);
    }
    return extractText(await res.json());
  }

  async function callProxy(messages, config) {
    const res = await fetchWithTimeout('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        temperature: config && Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.5
      })
    }, 60000);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Servidor de IA respondeu ${res.status}. ${safeErrorText(body)}`);
    }
    const data = await res.json();
    if (!data || !data.text) throw new Error('Servidor de IA respondeu sem conteúdo.');
    return String(data.text).trim();
  }

  async function requestAI(analysis, state, config) {
    const cfg = config || getConfig();
    const messages = buildMessages(analysis, state);

    if (canCallDirect(cfg)) return callDirect(cfg, messages);

    const proxy = await getProxyStatus(true);
    if (proxy.enabled) return callProxy(messages, cfg);

    throw new Error('Nenhum provedor externo configurado. Para continuar sem custos, escolha Groq (plano gratuito), informe uma chave criada na sua conta Groq e salve a configuração. Sem chave, a análise local continua disponível.');
  }

  async function testConnection(config) {
    const cfg = config || getConfig();
    const messages = [
      { role: 'system', content: 'Responda apenas com a palavra OK.' },
      { role: 'user', content: 'Teste de conexão.' }
    ];
    try {
      if (canCallDirect(cfg)) {
        const text = await callDirect(Object.assign({}, cfg, { temperature: 0 }), messages);
        return { ok: true, message: `Conexão OK com ${cfg.model || 'o provedor'}. Resposta: ${safeErrorText(text)}` };
      }
      const proxy = await getProxyStatus(true);
      if (proxy.enabled) {
        const text = await callProxy(messages, cfg);
        return { ok: true, message: `Conexão OK com o servidor local (${proxy.model || 'IA'}). Resposta: ${safeErrorText(text)}` };
      }
      return { ok: false, message: 'Nenhum provedor externo configurado. Para testar sem custos, escolha Groq (plano gratuito) e informe a chave da sua conta. Sem chave, a análise local permanece ativa.' };
    } catch (err) {
      return { ok: false, message: err && err.message ? err.message : 'Falha desconhecida ao testar a IA.' };
    }
  }

  global.SystemAI = {
    PRESETS,
    analyze,
    collectSessions,
    buildSummary,
    readinessLabel,
    localDateKey,
    getConfig,
    saveConfig,
    clearConfig,
    providerLabel,
    getProviderInfo,
    getProxyStatus,
    requestAI,
    testConnection,
    escapeHtml,
    renderRichText
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.SystemAI;
})(typeof window !== 'undefined' ? window : globalThis);
