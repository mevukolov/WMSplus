-- Разовая ручная коррекция: 29.09.2026 Мусаев Р.С. (205912) 17 раз нажал
-- "Создать задачу" в предсписке (второй линии). До фикса в tasks.js
-- (applyPrespisokTaskOutcome) слияние с уже существующей задачей другого
-- модуля НЕ проставляло тег "Предсписок" -- эти 17 задач физически не
-- могли попасть на "2-я линия предсписка" (см. isPrespisokTask /
-- reviewGroupedRows), хотя решение уже было принято.
--
-- Из 17 канонических задач одна (Маркетплейс, ШК 12566203455,
-- d7106262-1d14-4742-905a-92d0b3e5f756) с тех пор сама корректно
-- закрылась другим путём (opp_verdict = 'Система - Движение', движение
-- подтверждено системно) -- откатывать её в "Не начато" было бы шагом
-- назад, а не исправлением. Она намеренно исключена из списка ниже.
-- Остальные 16 всё ещё лежат как есть в своих исходных модулях -- им
-- проставляется тот же исход, что applyPrespisokTaskOutcome даёт для
-- "Создать задачу" (см. tasks.js): тег "Предсписок" + сброс в
-- "Не начато"/"Не выбран", чтобы задача действительно ушла на вторую
-- линию.
with targets as (
  select unnest(array[
    '29690bd9-c502-43ae-84a5-4646cc76739a', 'c9e6b889-ee5a-4040-bf8c-3f6c8104e08c',
    '87f83c7e-9594-48c5-9e5e-0871fa8465b8', '650f9820-4426-4577-9526-386bd4b21721',
    'c4c334cd-6403-4de8-afce-9c982dd52e2d', '617f7a4c-70b8-40d0-bcba-ce1b0b5df212',
    '4ece785e-d687-4a6f-a241-107a15da0333', '4cfaebfa-6b2b-4304-9f48-516914b4bff0',
    '15369ef6-9d74-4b2f-94dd-98e1177c08d1', '5f5d1a29-09c5-4ab7-98d6-629004007561',
    '34f3f655-4eae-4e71-85d4-59c80abc6ad1',
    'cddb9334-61e0-48ac-8051-c8820a0ffecb', '9fa5a64d-d3ce-46a1-a69d-e867e2e83ce7',
    'a9bd80e8-f776-4626-b416-b02d6d209027', 'a690c008-d9bb-4d90-bb6b-b037722f69a0',
    'f6d772af-8715-477b-82d4-f94a0f552969'
  ]::uuid[]) as id
),
updated as (
  update public.wms_tasks t
  set task_status = 'Не начато',
      opp_verdict = 'Не выбран',
      completed_at = null,
      reopen_after = null,
      reopened_at = case when t.task_status = 'Завершено' then now() else t.reopened_at end,
      tags = to_jsonb(array(select distinct unnest(
               (select array(select jsonb_array_elements_text(coalesce(t.tags, '[]'::jsonb))))
               || array['Предсписок']
             ))),
      updated_at = now()
  from targets
  where t.id = targets.id
    and t.is_deleted = false
  returning t.id
)
insert into public.wms_task_history (task_id, event_type, actor_employee_id, actor_name, payload)
select id, 'task_prespisok_second_line', '205912', 'Мусаев Роман Сергеевич',
  jsonb_build_object(
    'verdict', 'Не выбран',
    'comment', 'Решение предсписка: Создать задачу (ретроактивная коррекция -- см. 202609290003_prespisok_20260929_second_line_backfill.sql)',
    'source', 'prespisok_backfill'
  )
from updated;
