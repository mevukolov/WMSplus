-- wb-photo-match used to give up on a row after exactly one failed
-- attempt (bad photo, WB down, network blip) -- permanently marking it
-- "checked, no candidates", indistinguishable from a genuine "WB found
-- nothing". With WB's unofficial endpoints occasionally 403-ing this
-- project wholesale, that meant every row processed during an outage got
-- silently and permanently marked wrong. This column lets the function
-- retry a few times across later runs before giving up for good -- see
-- wb-photo-match/index.ts's MAX_CHECK_ATTEMPTS.
alter table public.intake_submissions
    add column if not exists wb_nm_check_attempts integer not null default 0;
