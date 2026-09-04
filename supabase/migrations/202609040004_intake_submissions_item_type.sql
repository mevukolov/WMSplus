-- 202609040004_intake_submissions_item_type.sql
-- Item-type branching + Шредер QR flow (see
-- docs/superpowers/specs/2026-09-04-intake-form-item-type-shredder-qr-design.md).
-- КГТ moves from being a category to being its own top-level item_type,
-- so it's removed from the category check list. Шредер submissions have
-- no category/item_text, and carry a scanned sticker_code instead of
-- relying on the user typing anything. Photo goes back to required now
-- that the skip-photo button is removed.
alter table public.intake_submissions
    add column item_type text not null
        check (item_type in ('Мелкий товар', 'КГТ', 'Шредер'));

alter table public.intake_submissions
    add column sticker_code text;

alter table public.intake_submissions
    drop constraint intake_submissions_category_check;

alter table public.intake_submissions
    alter column category drop not null;

alter table public.intake_submissions
    add constraint intake_submissions_category_check
        check (category is null or category in (
            'Одежда', 'Обувь', 'Косметика', 'Бытовая химия', 'Мебель',
            'Электроника', 'Ювелирка', 'Для авто', 'Для животных', 'Посуда',
            'Еда', 'Посылка'
        ));

alter table public.intake_submissions
    alter column item_text drop not null;

alter table public.intake_submissions
    alter column photo_path set not null;
