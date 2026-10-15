-- Every manual task-closing path (completeTaskFromDetail, deferTaskFromModal,
-- applyNoShkStickerVerdict, the Flow claim/skip paths, etc.) updates ONLY
-- wms_tasks (the parent) -- task_status/opp_verdict/completed_at/reopen_after
-- never reach wms_task_items. The only exception is the dedicated
-- "Чистые списания" per-item completion path (completePureLossesItemFromDetail),
-- which legitimately manages its own items' status independently. There is
-- an item->parent trigger (wms_task_items_sync_parent_status, 202610110003)
-- but nothing in the other direction -- so an item's status, once copied
-- from the parent at INSERT time, is frozen forever regardless of what
-- happens to the parent afterwards.
--
-- Confirmed live: 3757 wms_task_items rows sit non-"Завершено" under an
-- already-"Завершено" parent (1641 distinct tasks), plus hundreds more
-- stuck at a stale "Отложено"/"Не начато" from a parent transition that
-- happened after insert and was never propagated. items_already_in_sync
-- with a completed parent (outside Чистые списания) was exactly 0 --
-- this has never once self-corrected.
--
-- This matters because wms_task_items.task_status (not the parent's) is
-- what wms_sweep_active_routing / wms_compute_reroute_target / the new
-- wms_remember_shk use to decide whether a ШК is "active" -- a completed
-- task's items were staying forever eligible for reclassification and
-- could be mistaken for an active task.
--
-- Fix: trigger that propagates task_status/opp_verdict/completed_at/
-- reopen_after from parent to children whenever the parent's task_status
-- changes (claim, complete, defer, reopen -- all of them), skipping items
-- already "Завершено" (terminal, never dragged backward) and items whose
-- task_type is "Чистые списания" (explicitly self-governing). No infinite
-- loop with the existing item->parent trigger: that one only fires when an
-- item's own task_status becomes "Завершено", and its parent UPDATE is a
-- no-op whenever the parent is already that status (which it is, since
-- that's what triggered this propagation in the first place).
create or replace function public.wms_sync_task_items_from_parent_status() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.wms_task_items
    set task_status = new.task_status,
        opp_verdict = new.opp_verdict,
        completed_at = new.completed_at,
        reopen_after = new.reopen_after,
        updated_at = now()
    where task_id = new.id
      and task_status <> 'Завершено'
      and task_type <> 'Чистые списания'
      and (task_status, opp_verdict, completed_at, reopen_after)
          is distinct from (new.task_status, new.opp_verdict, new.completed_at, new.reopen_after);
    return new;
end;
$$;

create trigger wms_tasks_sync_items_from_status
    after update of task_status on public.wms_tasks
    for each row
    when (old.task_status is distinct from new.task_status)
    execute function public.wms_sync_task_items_from_parent_status();

-- One-time repair for the backlog above: bring every currently-drifted
-- item in line with its parent's CURRENT state (same scope/exclusions as
-- the trigger).
update public.wms_task_items ti
set task_status = t.task_status,
    opp_verdict = t.opp_verdict,
    completed_at = t.completed_at,
    reopen_after = t.reopen_after,
    updated_at = now()
from public.wms_tasks t
where ti.task_id = t.id
  and t.is_deleted = false
  and ti.task_status <> 'Завершено'
  and ti.task_type <> 'Чистые списания'
  and (ti.task_status, ti.opp_verdict, ti.completed_at, ti.reopen_after)
      is distinct from (t.task_status, t.opp_verdict, t.completed_at, t.reopen_after);
