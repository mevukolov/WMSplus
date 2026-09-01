-- 202608310002_print_jobs.sql
create table public.print_jobs (
    id uuid primary key default gen_random_uuid(),
    template_id uuid not null references public.print_label_templates(id),
    data jsonb not null default '{}'::jsonb,
    -- Already-built TSPL text -- the website builds this (print-tspl.js,
    -- Task 3), the bridge (Task 6/7) only ever relays it as raw bytes.
    tspl text not null,
    status text not null default 'queued' check (status in ('queued', 'printed', 'failed')),
    error_message text,
    created_at timestamptz not null default now(),
    created_by text,
    printed_at timestamptz
);

create index print_jobs_status_idx on public.print_jobs (status, created_at)
    where status = 'queued';

alter table public.print_jobs enable row level security;

-- Same open-policy pattern as print_label_templates (Task 1) -- gated by
-- the app's own login, not Supabase Auth/RLS roles.
create policy "print_jobs_all" on public.print_jobs
    for all using (true) with check (true);

-- Supabase Realtime: the test page (Task 5) subscribes to status changes
-- on the row it just inserted.
alter publication supabase_realtime add table public.print_jobs;
