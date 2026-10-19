-- "Последний вердикт" в таблицах участков должен пережить автопереоткрытие
-- задачи -- живое поле wms_tasks.opp_verdict сбрасывается в "Не выбран"
-- при переоткрытии (так и задумано: переоткрытая задача требует свежего
-- решения). Для честного "что последний раз решил человек" заводим
-- отдельный, никогда не сбрасываемый снэпшот, обновляемый только когда
-- человек реально ставит вердикт через карточку задачи (event_type
-- task_completed/task_deferred с непустым payload.verdict -- остальные
-- типы событий, включая системные task_system_closed и "Отложить" без
-- вердикта, не трогают это поле).
alter table public.wms_tasks
  add column if not exists last_human_verdict text,
  add column if not exists last_human_verdict_at timestamptz;

create or replace function public.wms_sync_last_human_verdict()
returns trigger
language plpgsql
as $$
begin
  if new.event_type not in ('task_completed', 'task_deferred') then
    return new;
  end if;
  if coalesce(new.payload->>'verdict', '') = '' or new.payload->>'verdict' = 'Не выбран' then
    return new;
  end if;
  update public.wms_tasks
  set last_human_verdict = new.payload->>'verdict',
      last_human_verdict_at = new.created_at
  where id = new.task_id
    and (last_human_verdict_at is null or last_human_verdict_at <= new.created_at);
  return new;
end;
$$;

drop trigger if exists wms_task_history_sync_last_human_verdict on public.wms_task_history;
create trigger wms_task_history_sync_last_human_verdict
after insert on public.wms_task_history
for each row execute function public.wms_sync_last_human_verdict();

-- Разовый бэкафилл существующей истории.
with ranked as (
  select task_id, payload->>'verdict' as verdict, created_at,
         row_number() over (partition by task_id order by created_at desc) as rn
  from public.wms_task_history
  where event_type in ('task_completed', 'task_deferred')
    and coalesce(payload->>'verdict', '') <> ''
    and payload->>'verdict' <> 'Не выбран'
)
update public.wms_tasks t
set last_human_verdict = r.verdict,
    last_human_verdict_at = r.created_at
from ranked r
where r.task_id = t.id and r.rn = 1;
