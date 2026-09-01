-- 202608310001_print_label_templates.sql
-- Label layouts as data, editable via the admin page (Task 4), so a new
-- label type never requires touching print-tspl.js or the bridge.
create table public.print_label_templates (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    width_mm numeric not null default 50,
    height_mm numeric not null default 50,
    -- Array of {type, field|literal, x_mm, y_mm, width_mm?, height_mm?,
    -- font_size?, barcode_type?} -- see print-tspl.js (Task 3) for the
    -- exact shape each element type reads.
    elements jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.print_label_templates enable row level security;

-- Every logged-in WMS+ user can read/manage templates -- this app has no
-- role system for this feature (see spec's "Явно не входит" section), it
-- authenticates via a custom RPC (auth.js) rather than Supabase Auth, so
-- policies here match this repo's existing pattern of anon-key + open
-- policies gated only by the app's own login screen.
create policy "print_label_templates_all" on public.print_label_templates
    for all using (true) with check (true);
