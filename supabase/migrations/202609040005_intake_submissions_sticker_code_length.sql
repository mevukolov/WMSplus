-- 202609040005_intake_submissions_sticker_code_length.sql
-- sticker_code (added in 202609040004) had no length bound -- this repo's
-- Supabase project is shared with the main WMS+ app and anon insert is
-- open (see 202609040002's hardening for the same reasoning applied to
-- item_text/full_name). 4296 chars comfortably covers a QR code's
-- practical text capacity.
alter table public.intake_submissions
    add constraint intake_submissions_sticker_code_length
        check (sticker_code is null or char_length(sticker_code) between 1 and 4296);
