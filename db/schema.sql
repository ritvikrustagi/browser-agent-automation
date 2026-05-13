-- AI browser agent — core relational schema (PostgreSQL / Supabase)
-- Run once against your database (Supabase: SQL Editor → New query).

begin;

-- Optional: tighten status values at the DB layer
create type task_status as enum ('pending', 'running', 'completed', 'failed', 'cancelled');
create type session_status as enum ('active', 'idle', 'closed', 'error');
create type approval_status as enum ('pending', 'approved', 'rejected', 'expired');

create table public.users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  created_at  timestamptz not null default now()
);

create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  prompt           text not null,
  status           task_status not null default 'pending',
  agent_messages   jsonb,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index tasks_user_id_created_at_idx on public.tasks (user_id, created_at desc);
create index tasks_status_idx on public.tasks (status) where status in ('pending', 'running');

create table public.browser_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  task_id      uuid references public.tasks (id) on delete set null,
  current_url  text,
  status       session_status not null default 'active',
  created_at   timestamptz not null default now()
);

create index browser_sessions_user_id_idx on public.browser_sessions (user_id, created_at desc);
create index browser_sessions_task_id_idx on public.browser_sessions (task_id);

create table public.agent_steps (
  id                 uuid primary key default gen_random_uuid(),
  task_id            uuid not null references public.tasks (id) on delete cascade,
  step_number        int not null,
  observation        text,
  reasoning_summary  text,
  action_type        text,
  action_payload     jsonb,
  result             jsonb,
  created_at         timestamptz not null default now(),
  unique (task_id, step_number)
);

create index agent_steps_task_id_step_number_idx on public.agent_steps (task_id, step_number);

create table public.tool_calls (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks (id) on delete cascade,
  agent_step_id uuid references public.agent_steps (id) on delete set null,
  tool_name     text not null,
  arguments     jsonb not null default '{}'::jsonb,
  result        jsonb,
  error         text,
  created_at    timestamptz not null default now()
);

create index tool_calls_task_id_idx on public.tool_calls (task_id, created_at);
create index tool_calls_tool_name_idx on public.tool_calls (tool_name);

create table public.approvals (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.tasks (id) on delete cascade,
  tool_call_id   text,
  action_type    text not null,
  action_payload jsonb not null default '{}'::jsonb,
  status         approval_status not null default 'pending',
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create index approvals_task_status_idx on public.approvals (task_id, status);
create index approvals_pending_idx on public.approvals (status, created_at) where status = 'pending';

create table public.action_logs (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references public.tasks (id) on delete cascade,
  user_id     uuid references public.users (id) on delete set null,
  event_type  text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index action_logs_task_id_idx on public.action_logs (task_id, created_at);
create index action_logs_event_type_idx on public.action_logs (event_type, created_at desc);

create table public.memories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  key        text not null,
  value      jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

create index memories_user_id_idx on public.memories (user_id);

commit;
