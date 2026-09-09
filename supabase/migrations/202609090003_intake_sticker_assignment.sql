-- Lets staff retroactively assign a sticker to an "Без ШК" item from the
-- admin "Поиск товара без ШК" screen, equivalent to scanning a sticker in
-- the intake form itself. intake_submissions is insert-only for anon at
-- the table level (see prior migrations' notes on this repo's access
-- model), so the actual sticker_code write goes through this narrow
-- security-definer RPC; it refuses to overwrite an already-assigned
-- sticker rather than silently clobbering one.
create or replace function public.wms_intake_assign_sticker(p_submission_id uuid, p_sticker_code text)
returns table (id uuid, sticker_code text)
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_sticker_code is null or left(p_sticker_code, 1) <> '*' then
        raise exception 'sticker code must start with *';
    end if;

    return query
    update public.intake_submissions
    set sticker_code = p_sticker_code
    where intake_submissions.id = p_submission_id
      and intake_submissions.sticker_code is null
    returning intake_submissions.id, intake_submissions.sticker_code;
end;
$$;

grant execute on function public.wms_intake_assign_sticker(uuid, text) to anon;

-- History of sticker assignments, keyed by the item they were assigned
-- to -- kept separate from wms_task_history (which is strictly task_id-
-- scoped, for the Флоу task-review timeline) since "Без ШК" items don't
-- have a wms_tasks row. Written by both paths that can assign a sticker:
-- the intake form itself (source='form', at submission time) and this
-- admin screen (source='admin', retroactively). Insert-only for anon,
-- matching intake_submissions/2shk_rep's own access model.
create table if not exists public.wms_no_shk_sticker_events (
    id uuid primary key default gen_random_uuid(),
    intake_submission_id uuid not null references public.intake_submissions(id) on delete cascade,
    sticker_code text not null,
    source text not null check (source in ('form', 'admin')),
    actor_employee_id text,
    actor_name text,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists wms_no_shk_sticker_events_submission_idx
    on public.wms_no_shk_sticker_events (intake_submission_id, created_at desc);

grant insert on public.wms_no_shk_sticker_events to anon;
