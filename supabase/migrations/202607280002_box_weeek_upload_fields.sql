alter table public.box_tracker_rep
  add column if not exists uploaded_to_weeek boolean not null default false,
  add column if not exists weeek_task_id text,
  add column if not exists weeek_task_url text,
  add column if not exists weeek_task_project_id text,
  add column if not exists weeek_task_board_id text,
  add column if not exists weeek_task_board_column_id text,
  add column if not exists weeek_task_completed boolean,
  add column if not exists weeek_task_deleted boolean,
  add column if not exists weeek_task_updated_at timestamptz,
  add column if not exists weeek_status_synced_at timestamptz,
  add column if not exists weeek_uploaded_at timestamptz,
  add column if not exists weeek_last_attempt_at timestamptz,
  add column if not exists weeek_last_error text,
  add column if not exists weeek_request_payload jsonb,
  add column if not exists weeek_response jsonb;

create index if not exists box_tracker_rep_weeek_pending_idx
  on public.box_tracker_rep (uploaded_to_weeek, updated_at)
  where uploaded_to_weeek = false;

create index if not exists box_tracker_rep_weeek_status_idx
  on public.box_tracker_rep (weeek_status_synced_at)
  where uploaded_to_weeek = true and weeek_task_id is not null;
