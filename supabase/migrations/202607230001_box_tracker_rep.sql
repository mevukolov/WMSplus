create table if not exists public.box_tracker_rep (
  date date,
  box text not null,
  shk_qty integer,
  comment text,
  analysis text,
  analysis_status text,
  error text,
  guilty_id text,
  uploaded_to_tracker boolean not null default false,
  source_sheet text,
  source_row_number integer,
  source_generated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.box_tracker_rep
  add column if not exists date date,
  add column if not exists box text,
  add column if not exists shk_qty integer,
  add column if not exists comment text,
  add column if not exists analysis text,
  add column if not exists analysis_status text,
  add column if not exists error text,
  add column if not exists guilty_id text,
  add column if not exists uploaded_to_tracker boolean not null default false,
  add column if not exists source_sheet text,
  add column if not exists source_row_number integer,
  add column if not exists source_generated_at timestamptz,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists box_tracker_rep_box_uidx
  on public.box_tracker_rep (box);

alter table public.box_tracker_rep disable row level security;

grant select on public.box_tracker_rep to anon, authenticated;
