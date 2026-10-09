-- Кандидат "реестр ШК" (docs/superpowers/specs/2026-10-11-wms-shk-registry-design.md):
-- ШК получает постоянную идентичность и собственный журнал истории, не
-- зависящие от того, какая строка wms_tasks держит его сейчас.
create table public.wms_shk (
    shk text primary key,
    nm text,
    name text,
    current_task_id uuid references public.wms_tasks(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.wms_shk_history (
    id uuid primary key default gen_random_uuid(),
    shk text not null references public.wms_shk(shk),
    task_id uuid references public.wms_tasks(id) on delete set null,
    event_type text not null,
    actor_employee_id text,
    actor_name text,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index wms_shk_history_shk_idx on public.wms_shk_history (shk, created_at desc);
