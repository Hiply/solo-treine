-- Rode este script no Supabase: seu projeto → SQL Editor → New query → Run.
-- Cria as tabelas usadas pelo app:
--   player_state → progresso privado de cada usuário (só o dono lê/grava).
--   leaderboard  → ranking público (todos leem; cada usuário grava só a própria linha).

-- ============================================================
-- 1) PROGRESSO PRIVADO
-- ============================================================
create table if not exists public.player_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.player_state enable row level security;

drop policy if exists "select own state" on public.player_state;
create policy "select own state" on public.player_state
  for select using (auth.uid() = user_id);

drop policy if exists "insert own state" on public.player_state;
create policy "insert own state" on public.player_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own state" on public.player_state;
create policy "update own state" on public.player_state
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own state" on public.player_state;
create policy "delete own state" on public.player_state
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 2) RANKING GLOBAL (MULTIPLAYER)
-- ============================================================
-- Cada linha é a "ficha pública" de um jogador. Nada sensível é publicado:
-- apenas codinome, nível, rank, XP, streak e minutos da semana.
create table if not exists public.leaderboard (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'JOGADOR',
  level integer not null default 1,
  rank text not null default 'E-RANK',
  total_xp integer not null default 0,
  streak integer not null default 0,
  study_minutes_week integer not null default 0,
  training_minutes_week integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Limites de sanidade para evitar valores absurdos vindos do cliente.
alter table public.leaderboard drop constraint if exists leaderboard_display_name_len;
alter table public.leaderboard add constraint leaderboard_display_name_len
  check (char_length(display_name) between 1 and 32);

alter table public.leaderboard drop constraint if exists leaderboard_rank_len;
alter table public.leaderboard add constraint leaderboard_rank_len
  check (char_length(rank) between 1 and 32);

alter table public.leaderboard drop constraint if exists leaderboard_non_negative;
alter table public.leaderboard add constraint leaderboard_non_negative
  check (
    level >= 1 and level <= 9999 and
    total_xp >= 0 and
    streak >= 0 and streak <= 100000 and
    study_minutes_week >= 0 and study_minutes_week <= 100000 and
    training_minutes_week >= 0 and training_minutes_week <= 100000
  );

-- Índices para ordenar o ranking sem varredura completa.
create index if not exists leaderboard_xp_idx
  on public.leaderboard (total_xp desc, streak desc);
create index if not exists leaderboard_updated_idx
  on public.leaderboard (updated_at desc);

alter table public.leaderboard enable row level security;

-- Leitura pública: qualquer visitante (mesmo sem login) vê o ranking.
drop policy if exists "leaderboard public read" on public.leaderboard;
create policy "leaderboard public read" on public.leaderboard
  for select using (true);

-- Escrita apenas da própria linha.
drop policy if exists "leaderboard insert own" on public.leaderboard;
create policy "leaderboard insert own" on public.leaderboard
  for insert with check (auth.uid() = user_id);

drop policy if exists "leaderboard update own" on public.leaderboard;
create policy "leaderboard update own" on public.leaderboard
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "leaderboard delete own" on public.leaderboard;
create policy "leaderboard delete own" on public.leaderboard
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 3) PERMISSÕES
-- ============================================================
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.player_state to authenticated;

grant select on public.leaderboard to anon, authenticated;
grant insert, update, delete on public.leaderboard to authenticated;
