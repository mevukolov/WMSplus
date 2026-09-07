-- 202609040004_intake_submissions_item_type.sql
-- Item-type branching + Шредер QR flow (see
-- docs/superpowers/specs/2026-09-04-intake-form-item-type-shredder-qr-design.md).
-- КГТ moves from being a category to being its own top-level item_type,
-- so it's removed from the category check list. Шредер submissions have
-- no category/item_text, and carry a scanned sticker_code instead of
-- relying on the user typing anything. Photo goes back to required now
-- that the skip-photo button is removed.

-- Add item_type column (nullable at first, backfilled below).
alter table public.intake_submissions
    add column item_type text;

-- Make category nullable BEFORE the КГТ backfill needs to null it out
-- (this repo's migrations apply against live tables that may already
-- have rows -- see the item_type backfill note below for why this
-- ordering matters).
alter table public.intake_submissions
    drop constraint intake_submissions_category_check;

alter table public.intake_submissions
    alter column category drop not null;

-- Backfill item_type for any pre-existing rows. КГТ moved from being a
-- category to being its own item_type, so rows that were
-- category='КГТ' get item_type='КГТ' with category cleared -- the
-- correct classification is knowable from the data itself, not a
-- guess. Any other pre-existing row (no principled way to know its
-- real type) defaults to 'Мелкий товар', the most common/generic case.
update public.intake_submissions set item_type = 'КГТ', category = null where category = 'КГТ';
update public.intake_submissions set item_type = 'Мелкий товар' where item_type is null;

alter table public.intake_submissions
    alter column item_type set not null;

alter table public.intake_submissions
    add constraint intake_submissions_item_type_check
        check (item_type in ('Мелкий товар', 'КГТ', 'Шредер'));

-- Narrowed category check -- nullable, 12 values (КГТ removed, now a
-- type instead of a category).
alter table public.intake_submissions
    add constraint intake_submissions_category_check
        check (category is null or category in (
            'Одежда', 'Обувь', 'Косметика', 'Бытовая химия', 'Мебель',
            'Электроника', 'Ювелирка', 'Для авто', 'Для животных', 'Посуда',
            'Еда', 'Посылка'
        ));

alter table public.intake_submissions
    add column sticker_code text;

alter table public.intake_submissions
    alter column item_text drop not null;

-- If replaying this migration against a snapshot from the window this
-- project's since-reverted skip-photo feature was live (photo_path
-- nullable), any row with photo_path IS NULL must be resolved by hand
-- first -- there is no safe synthetic value for a missing upload path,
-- unlike item_type above.
alter table public.intake_submissions
    alter column photo_path set not null;
