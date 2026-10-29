-- Дневной тренд остатка активных задач по task_type -- для линейной
-- диаграммы в блоке "Предразбор" на главном экране. "Активна на день D"
-- определяем просто: уже создана к концу дня D и либо ещё не завершена,
-- либо завершена позже конца дня D. Намеренно не учитываем нюанс
-- "Отложено, ещё не наступил reopen_after" (isWaitingReopenTask в JS) --
-- это состояние не хранится исторически (reopen_after обнуляется при
-- переоткрытии), восстановить его задним числом нечем. Для тренда
-- остатка это разумное приближение -- отложенные считаются остатком,
-- а не прячутся.
create or replace function public.wms_active_tasks_trend(p_days integer default 14)
returns table(day date, task_type text, active_count bigint)
language sql
stable
as $$
    with days as (
        select generate_series(
            (now() at time zone 'Europe/Moscow')::date - (greatest(p_days, 1) - 1),
            (now() at time zone 'Europe/Moscow')::date,
            interval '1 day'
        )::date as day
    )
    select
        days.day,
        t.task_type,
        count(*) as active_count
    from days
    join public.wms_tasks t
        on t.is_deleted = false
       and t.source_generated_at < ((days.day + 1)::timestamp at time zone 'Europe/Moscow')
       and (t.completed_at is null or t.completed_at >= ((days.day + 1)::timestamp at time zone 'Europe/Moscow'))
    group by days.day, t.task_type
    order by days.day;
$$;
