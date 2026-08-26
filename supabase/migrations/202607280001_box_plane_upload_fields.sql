alter table public.box_tracker_rep
  add column if not exists uploaded_to_plane boolean not null default false,
  add column if not exists plane_work_item_id text,
  add column if not exists plane_work_item_sequence_id integer,
  add column if not exists plane_work_item_url text,
  add column if not exists plane_work_item_state_id text,
  add column if not exists plane_work_item_state_name text,
  add column if not exists plane_work_item_updated_at timestamptz,
  add column if not exists plane_status_synced_at timestamptz,
  add column if not exists plane_uploaded_at timestamptz,
  add column if not exists plane_last_attempt_at timestamptz,
  add column if not exists plane_last_error text,
  add column if not exists plane_request_payload jsonb,
  add column if not exists plane_response jsonb;

create index if not exists box_tracker_rep_plane_pending_idx
  on public.box_tracker_rep (uploaded_to_plane, updated_at)
  where uploaded_to_plane = false;
