-- "Запомнить ШК": лог заметок + механизм переноса в историю будущей
-- задачи. Когда по ШК нет активной задачи и оператор не стал создавать
-- новую ("Создать задачу" выключен), заметка уходит в лёгкую сразу
-- завершённую задачу-заметку (видна в поиске прямо сейчас) и помечается
-- pending_future_attach -- как только по этому ШК где-то появится
-- настоящая задача (любая будущая выгрузка), AFTER INSERT на
-- wms_task_items допишет заметку строкой в её историю. Таблица не
-- выдаётся клиенту напрямую (anon/authenticated) -- с ней работает
-- только security definer RPC wms_remember_shk и этот триггер.
create table public.wms_shk_notes (
    id uuid primary key default gen_random_uuid(),
    shk text not null,
    comment text not null,
    last_movement_status text,
    actor_name text,
    actor_employee_id text,
    note_task_id uuid references public.wms_tasks(id) on delete set null,
    pending_future_attach boolean not null default false,
    created_at timestamptz not null default now()
);

create index wms_shk_notes_pending_shk_idx on public.wms_shk_notes (shk) where pending_future_attach = true;

create or replace function public.wms_propagate_shk_notes() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
    select
        new.task_id,
        'shk_note_added',
        n.actor_name,
        n.actor_employee_id,
        jsonb_build_object(
            'shk', new.shk,
            'comment', n.comment || case when n.last_movement_status is not null
                then (chr(10) || 'Статус последнего движения: ' || n.last_movement_status)
                else '' end,
            'raw_comment', n.comment,
            'last_movement_status', n.last_movement_status,
            'propagated_from_note_id', n.id
        )
    from public.wms_shk_notes n
    where n.shk = new.shk
      and n.pending_future_attach = true
      and n.note_task_id is distinct from new.task_id;

    update public.wms_shk_notes
    set pending_future_attach = false
    where shk = new.shk
      and pending_future_attach = true
      and note_task_id is distinct from new.task_id;

    return new;
end;
$$;

create trigger wms_task_items_propagate_shk_notes
    after insert on public.wms_task_items
    for each row
    execute function public.wms_propagate_shk_notes();
