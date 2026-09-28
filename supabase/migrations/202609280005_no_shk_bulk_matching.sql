-- 202609280005_no_shk_bulk_matching.sql
-- The live per-task RPC (wms_no_shk_task_matches, 202609280004) is cheap for
-- one task at a time but a system-wide "which tasks have a match right now"
-- scan costs ~90s (measured) because task_items lives inside each task's
-- large source_payload jsonb blob, un-indexed. That's fine for one task on
-- card-open, unusable for a drawer that needs to load instantly or a
-- per-photo background check running every minute.
--
-- Fix: maintain a small, indexed side table of (task_id, nm, movement, shk)
-- kept in sync by a trigger on wms_tasks, so bulk matching becomes a cheap
-- indexed join instead of a full jsonb scan. Run it (a) right after
-- wb-photo-match computes new candidates for a batch of photos, and (b)
-- every 3 hours via pg_cron as a safety net. Both write the exact same
-- source_payload.no_shk_matches shape the client already produces, so the
-- match modal (tasks.js) needs no changes to consume it.

create table if not exists public.wms_task_nm_index (
    task_id uuid not null references public.wms_tasks(id) on delete cascade,
    nm text not null,
    movement timestamptz,
    shk text,
    primary key (task_id, nm)
);

create index if not exists wms_task_nm_index_nm_idx on public.wms_task_nm_index (nm);

alter table public.wms_tasks
    add column if not exists has_pending_no_shk_match boolean not null default false;

create index if not exists wms_tasks_has_pending_no_shk_match_idx
    on public.wms_tasks (updated_at desc)
    where has_pending_no_shk_match = true and is_deleted = false;

-- item->>'movement' isn't guaranteed to be a clean ISO timestamp (the
-- client's own parseDateTime() tolerates several formats) -- this trigger
-- runs on every task write, so a raw ::timestamptz cast throwing on one
-- oddly-formatted row would break that task's save entirely. Reuses the
-- existing wms_safe_timestamptz(text) helper (already in this DB) rather
-- than redefining it.
create or replace function public.wms_sync_task_nm_index() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.wms_task_nm_index where task_id = new.id;
    if new.is_deleted then
        return new;
    end if;
    insert into public.wms_task_nm_index (task_id, nm, movement, shk)
    select new.id,
           item->>'nm',
           public.wms_safe_timestamptz(item->>'movement'),
           item->>'shk'
    from jsonb_array_elements(coalesce(new.source_payload->'task_items', '[]'::jsonb)) as item
    where coalesce(item->>'nm', '') <> ''
    on conflict (task_id, nm) do update set movement = excluded.movement, shk = excluded.shk;
    return new;
end;
$$;

drop trigger if exists wms_tasks_sync_nm_index on public.wms_tasks;
create trigger wms_tasks_sync_nm_index
    after insert or update of source_payload, is_deleted on public.wms_tasks
    for each row execute function public.wms_sync_task_nm_index();

-- One-time backfill for every already-active task -- same ~90s cost as the
-- live scan, but paid once here at migration time instead of on every
-- request from here on.
insert into public.wms_task_nm_index (task_id, nm, movement, shk)
select t.id,
       item->>'nm',
       public.wms_safe_timestamptz(item->>'movement'),
       item->>'shk'
from public.wms_tasks t,
     jsonb_array_elements(coalesce(t.source_payload->'task_items', '[]'::jsonb)) as item
where t.is_deleted = false
  and coalesce(item->>'nm', '') <> ''
on conflict (task_id, nm) do nothing;

-- Finds every not-yet-known match between currently-unclaimed intake_submissions
-- and active tasks (via the indexed side table above) and merges any new ones
-- into each task's source_payload.no_shk_matches as a pending entry -- same
-- shape refreshTaskNoShkMatches (tasks.js) already writes, deduped by
-- submission_id so re-running this repeatedly never appends the same
-- candidate twice. Internal maintenance function: not for anon/client use,
-- called only by pg_cron and the wb-photo-match edge function (service role).
create or replace function public.wms_no_shk_bulk_match_and_persist()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row record;
    v_existing jsonb;
    v_known_ids text[];
    v_additions jsonb;
    v_next jsonb;
    v_count integer := 0;
begin
    for v_row in (
        select ti.task_id,
               jsonb_agg(distinct jsonb_build_object(
                   'submission_id', sn.submission_id,
                   'nm', sn.nm,
                   'matched_at', to_char(sn.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                   'decision', 'pending',
                   'decided_by_id', '',
                   'decided_by_name', '',
                   'decided_at', '',
                   'snapshot', jsonb_build_object(
                       'item_text', sn.item_text,
                       'photo_path', sn.photo_path,
                       'full_name', sn.full_name,
                       'area', sn.area,
                       'created_at', to_char(sn.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                       'sticker_code', sn.sticker_code,
                       'item_type', sn.item_type
                   )
               )) as candidates
        from public.wms_task_nm_index ti
        join (
            select s.id as submission_id, elem as nm, s.created_at,
                   s.item_text, s.photo_path, s.full_name, s.area, s.sticker_code, s.item_type
            from public.intake_submissions s,
                 jsonb_array_elements_text(coalesce(s.wb_nm_candidates, '[]'::jsonb)) as elem
            where s.matched_task_id is null
        ) sn on sn.nm = ti.nm
        where ti.movement is not null
          and sn.created_at >= (ti.movement - interval '1 day')
          and sn.created_at < (ti.movement + interval '6 day')
        group by ti.task_id
    ) loop
        select coalesce(t.source_payload->'no_shk_matches', '[]'::jsonb)
        into v_existing
        from public.wms_tasks t
        where t.id = v_row.task_id and t.is_deleted = false;

        if v_existing is null then
            continue;
        end if;

        select array_agg(elem->>'submission_id') into v_known_ids
        from jsonb_array_elements(v_existing) elem;

        select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_additions
        from jsonb_array_elements(v_row.candidates) elem
        where v_known_ids is null or not (elem->>'submission_id' = any(v_known_ids));

        if jsonb_array_length(v_additions) = 0 then
            continue;
        end if;

        v_next := v_existing || v_additions;

        update public.wms_tasks
        set source_payload = jsonb_set(coalesce(source_payload, '{}'::jsonb), '{no_shk_matches}', v_next, true),
            has_pending_no_shk_match = true,
            updated_at = now()
        where id = v_row.task_id;

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

grant execute on function public.wms_no_shk_bulk_match_and_persist() to service_role;

comment on function public.wms_no_shk_bulk_match_and_persist() is
    'Merges new Без ШК matches (wms_task_nm_index vs unclaimed intake_submissions) into matching tasks'' source_payload.no_shk_matches. Called by wb-photo-match after each batch and by pg_cron every 3 hours.';

select cron.schedule(
    'wms-no-shk-bulk-match-3h',
    '0 */3 * * *',
    $$select public.wms_no_shk_bulk_match_and_persist();$$
);

-- Fast list for the "Быстрая проверка «Без ШК»" drawer: reads the indexed
-- flag instead of scanning source_payload.
create or replace function public.wms_no_shk_pending_tasks(p_limit int default 100)
returns setof public.wms_tasks
language sql
security definer
set search_path = public
stable
as $$
    select *
    from public.wms_tasks
    where is_deleted = false
      and has_pending_no_shk_match = true
    order by updated_at desc
    limit greatest(p_limit, 0);
$$;

grant execute on function public.wms_no_shk_pending_tasks(int) to anon;
