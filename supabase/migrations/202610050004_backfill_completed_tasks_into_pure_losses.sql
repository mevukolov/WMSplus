-- Разовый бэкофилл: до сегодняшнего дня wms_pure_losses_absorb_shks
-- вызывалась только из будущих загрузок -- ШК, которые УЖЕ пересекались
-- с завершёнными задачами (товар искали, не нашли/нашли/подтвердили
-- движение, а потом он всё равно всплыл в чистых списаниях), никогда не
-- переносились в зону. Пользователь явно решил перенести ВСЕ 6 вердиктов
-- (3479 задач, 3902 уникальных ШК), не только "Нет на МХ/Не найден" --
-- включая "Система - Движение"/"Найден/Релиз/Списан".
--
-- RPC сама по себе не фильтрует по task_status (проверено по тексту
-- 202610050001) -- подходит для завершённых задач без изменений кода,
-- только нужные данные {shk, nm, name, price, date_lost} берём из самой
-- pure_losses_rep (а не из новой выгрузки, которой тут нет). На ШК с
-- несколькими строками в pure_losses_rep берём самую свежую по date_lost.
-- pure_losses_rep.price/date_lost хранятся как text (не numeric/date) --
-- безопасный каст с regex-проверкой, мусорные значения не роняют миграцию.
do $$
declare
    v_rows jsonb;
    v_result jsonb;
begin
    select jsonb_agg(jsonb_build_object(
        'shk', x.shk,
        'nm', coalesce(x.nm, ''),
        'name', coalesce(x.decription, ''),
        'price', case when x.price ~ '^[0-9]+(\.[0-9]+)?$' then x.price::numeric else 0 end,
        'date_lost', case when x.date_lost ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then x.date_lost else '' end
    )) into v_rows
    from (
        select distinct on (p.shk)
            p.shk, p.nm, p.decription, p.price, p.date_lost
        from pure_losses_rep p
        where p.shk in (
            select distinct u.shk
            from wms_tasks t
            join lateral unnest(t.source_shk_ids) as u(shk) on true
            where t.is_deleted = false and t.task_status = 'Завершено'
              and exists (select 1 from pure_losses_rep p2 where p2.shk = u.shk)
        )
        order by p.shk, p.date_lost desc
    ) x;

    v_result := public.wms_pure_losses_absorb_shks(v_rows, 'backfill', 'Бэкофилл пересечения с завершёнными задачами 2026-10-05');

    raise notice 'Бэкофилл чистых списаний: обработано % ШК, результатов %',
        jsonb_array_length(v_rows), jsonb_array_length(v_result);
end $$;
