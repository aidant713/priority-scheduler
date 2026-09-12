-- Priority Scheduler — initial schema
-- The task list is the source of truth. scheduled_blocks mirror the Google
-- events we create; they are disposable and rewritten on every sync.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- tasks
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  title            text not null,
  notes            text,
  estimate_minutes int  not null default 30 check (estimate_minutes > 0),
  priority         int  not null,                       -- 0 = top; contiguous per user
  status           text not null default 'todo' check (status in ('todo','done','archived')),
  deadline         timestamptz,                          -- optional, advisory only
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- one contiguous ordering per user across live (todo) tasks
create unique index if not exists tasks_user_priority_uidx
  on public.tasks (user_id, priority)
  where status = 'todo';

create index if not exists tasks_user_status_idx on public.tasks (user_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- scheduled_blocks — a rendering of the list into calendar time
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.scheduled_blocks (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.tasks (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  gcal_event_id  text not null,           -- the Google event we created
  start_at       timestamptz not null,
  end_at         timestamptz not null,
  chunk_index    int not null default 0   -- for tasks split across slots/days
);

create index if not exists scheduled_blocks_user_idx on public.scheduled_blocks (user_id);
create index if not exists scheduled_blocks_task_idx on public.scheduled_blocks (task_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- user_settings
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.user_settings (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  timezone             text  not null default 'Australia/Perth',
  work_days            int[] not null default '{1,2,3,4,5}',   -- ISO weekday (1=Mon..7=Sun)
  work_start           time  not null default '08:30',
  work_end             time  not null default '17:00',
  min_block_minutes    int   not null default 30 check (min_block_minutes > 0),
  buffer_minutes       int   not null default 10 check (buffer_minutes >= 0),
  target_calendar_id   text,                                    -- which Google calendar to write to
  block_prefix         text  not null default '⚡ ',
  google_refresh_token text,                                    -- encrypted at rest (app-level, see lib/google)
  updated_at           timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- keep updated_at fresh
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Reorder helper: atomically renumber a user's todo tasks to a new contiguous
-- order (0..n-1). `ordered_ids` is the desired top-to-bottom order.
-- Two-phase (offset then final) to avoid tripping the unique index mid-update.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reorder_tasks(p_user uuid, ordered_ids uuid[])
returns void language plpgsql security definer as $$
begin
  -- phase 1: move live tasks out of the 0..n range to avoid unique collisions
  update public.tasks
     set priority = priority + 1000000
   where user_id = p_user and status = 'todo';

  -- phase 2: assign contiguous priorities in the requested order
  update public.tasks t
     set priority = ord.idx
    from (
      select id, (row_number() over () - 1)::int as idx
      from unnest(ordered_ids) with ordinality as u(id, ordinality)
    ) ord
   where t.id = ord.id and t.user_id = p_user and t.status = 'todo';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — users only ever see/modify their own rows
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.tasks            enable row level security;
alter table public.scheduled_blocks enable row level security;
alter table public.user_settings    enable row level security;

drop policy if exists tasks_owner on public.tasks;
create policy tasks_owner on public.tasks
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists scheduled_blocks_owner on public.scheduled_blocks;
create policy scheduled_blocks_owner on public.scheduled_blocks
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_settings_owner on public.user_settings;
create policy user_settings_owner on public.user_settings
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
