-- 202609080001_intake_submissions_shift_bucket_fields.sql
-- Shift storage addressing (see
-- docs/superpowers/specs/2026-09-08-intake-form-processing-instructions-and-shift-boxes-design.md).
-- Every "Товар без ШК" submission now records which shift it belongs to
-- (same 8:00/20:00 boundary the form's header already computes) and which
-- accounting bucket it falls into: 'Короб смены' for anything that didn't
-- need a sticker (counted into a per-area shift box, Task 6-7), or one of
-- the three named buckets for anything that did (bookkeeping label only
-- in this phase -- no viewer UI yet). Nullable: 2ШК/Пустая упаковка rows
-- never touch this table, and existing rows predate this feature.
alter table public.intake_submissions
    add column shift_date date,
    add column shift_type text check (shift_type in ('Дневная', 'Ночная')),
    add column no_shk_bucket text check (no_shk_bucket in (
        'Короб смены', 'Брак Бытовая химия', 'Товар с переупаковки', 'Шредер'
    ));
