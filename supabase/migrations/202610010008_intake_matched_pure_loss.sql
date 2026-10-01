-- Опознание товара "без ШК" теперь может прийти по двум независимым путям --
-- по задаче (matched_task_id, уже есть) и по строке "чистых списаний"
-- pure_losses_rep (новое). matched_pure_loss_id хранит идентификатор
-- pure_losses_rep текстом -- точное имя PK-колонки той таблицы определяется
-- динамически на клиенте тем же способом, что buildNoShkPureUpdateFilters
-- (tasks.js) уже делает для обновления самой pure_losses_rep, так что здесь
-- просто текст, не foreign key.
alter table public.intake_submissions
    add column if not exists matched_pure_loss_id text;

-- Клейм по задаче и клейм по списанию должны исключать друг друга --
-- иначе один и тот же товар можно опознать дважды разными путями.
create or replace function public.wms_intake_mark_matched(p_submission_id uuid, p_task_id uuid, p_shk text, p_actor_id text, p_actor_name text)
 returns table (id uuid, matched_task_id uuid, matched_shk text)
 language plpgsql security definer set search_path to 'public'
as $function$
begin
    return query
    update public.intake_submissions
    set matched_task_id = p_task_id, matched_shk = p_shk, matched_at = now(),
        matched_by_id = p_actor_id, matched_by_name = p_actor_name
    where intake_submissions.id = p_submission_id
      and intake_submissions.matched_task_id is null
      and intake_submissions.matched_pure_loss_id is null
    returning intake_submissions.id, intake_submissions.matched_task_id, intake_submissions.matched_shk;
end;
$function$;

create or replace function public.wms_intake_mark_matched_pure_loss(p_submission_id uuid, p_pure_loss_id text, p_shk text, p_actor_id text, p_actor_name text)
 returns table (id uuid, matched_pure_loss_id text, matched_shk text)
 language plpgsql security definer set search_path to 'public'
as $function$
begin
    return query
    update public.intake_submissions
    set matched_pure_loss_id = p_pure_loss_id, matched_shk = p_shk, matched_at = now(),
        matched_by_id = p_actor_id, matched_by_name = p_actor_name
    where intake_submissions.id = p_submission_id
      and intake_submissions.matched_task_id is null
      and intake_submissions.matched_pure_loss_id is null
    returning intake_submissions.id, intake_submissions.matched_pure_loss_id, intake_submissions.matched_shk;
end;
$function$;

grant execute on function public.wms_intake_mark_matched_pure_loss(uuid, text, text, text, text) to anon;

-- wms_no_shk_box_contents -- короб-грид и разобранные короба должны видеть
-- оба пути опознания, не только sticker_code. Return-тип меняется (новые
-- out-параметры), поэтому дроп обязателен -- CREATE OR REPLACE не может
-- менять форму RETURNS TABLE.
drop function if exists public.wms_no_shk_box_contents(uuid);

create function public.wms_no_shk_box_contents(p_box_id uuid)
 returns table (
    id uuid, item_text text, category text, item_type text, area text,
    full_name text, created_at timestamptz, photo_path text, sticker_code text,
    wb_nm_candidates jsonb, wb_nm_checked_at timestamptz,
    matched_task_id uuid, matched_pure_loss_id text, matched_shk text
 )
 language sql stable security definer set search_path to 'public'
as $function$
    select id, item_text, category, item_type, area, full_name, created_at, photo_path, sticker_code,
           wb_nm_candidates, wb_nm_checked_at, matched_task_id, matched_pure_loss_id, matched_shk
    from public.intake_submissions
    where box_id = p_box_id
    order by created_at asc;
$function$;

grant execute on function public.wms_no_shk_box_contents(uuid) to anon;
