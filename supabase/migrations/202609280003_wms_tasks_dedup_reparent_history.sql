-- The backfill in 202609280001 merged cross-module ШК duplicates by
-- soft-deleting the losing task and logging a synthetic one-line summary
-- of it on the canonical task. That summary is a lossy snapshot -- it
-- cannot show, say, a предсписок task's OWN later completion (real actor,
-- real verdict, real comment) because that lived in the losing task's own
-- wms_task_history, under its own (now orphaned) task_id.
--
-- Re-parenting that real history onto the canonical task instead is
-- strictly better and loses nothing: every actor/verdict/comment the
-- merged task ever had becomes visible on the one task that now
-- represents this ШК, in its real original shape, sorted into the
-- timeline by its own real created_at. The synthetic summary rows are
-- then redundant for every one of these merges and are removed.

update public.wms_task_history h
set task_id = (t.source_payload->>'merged_into')::uuid
from public.wms_tasks t
where t.id = h.task_id
  and t.is_deleted = true
  and t.source_payload->>'merged_into' is not null;

delete from public.wms_task_history
where event_type = 'task_cross_module_touch'
  and payload->>'backfill' = 'true';
