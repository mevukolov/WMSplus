alter table public.box_tracker_rep
  add column if not exists tracker_issue_code text,
  add column if not exists tracker_issue_id text,
  add column if not exists tracker_uploaded_at timestamptz,
  add column if not exists tracker_last_attempt_at timestamptz,
  add column if not exists tracker_last_error text,
  add column if not exists tracker_request_payload jsonb,
  add column if not exists tracker_response jsonb;

create index if not exists box_tracker_rep_tracker_pending_idx
  on public.box_tracker_rep (uploaded_to_tracker, updated_at)
  where uploaded_to_tracker = false;
