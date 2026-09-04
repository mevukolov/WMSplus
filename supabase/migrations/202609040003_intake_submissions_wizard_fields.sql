-- 202609040003_intake_submissions_wizard_fields.sql
-- Wizard/PWA redesign (see
-- docs/superpowers/specs/2026-09-04-intake-form-wizard-pwa-design.md):
-- adds who's submitting by name (full_name, alongside the existing
-- employee_id) and which work area they're on, and makes the photo
-- optional (the wizard lets a person skip it and still finish the
-- submission if it fails to upload).
--
-- The rows in the table at the time of this migration are the site
-- owner's own manual test submissions (item_text 'тест4'..'тест9', all
-- the same employee_id) -- deleted here so full_name/area can be added
-- as NOT NULL cleanly, without inventing a fake backfill value.
delete from public.intake_submissions where item_text ~ '^тест[0-9]+$';

alter table public.intake_submissions
    add column full_name text not null;

alter table public.intake_submissions
    add constraint intake_submissions_full_name_length
        check (char_length(full_name) between 1 and 200);

alter table public.intake_submissions
    add column area text not null
        check (area in ('ХАБ', 'Упаковка', 'Маркетплейс'));

alter table public.intake_submissions
    alter column photo_path drop not null;
