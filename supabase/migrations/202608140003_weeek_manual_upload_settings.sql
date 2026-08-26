create table if not exists public.weeek_manual_upload_settings (
  module text primary key,
  label text not null,
  source_module text not null,
  upload_type text not null,
  upload_offset_days integer not null default 0,
  task_deadline_days integer,
  pm_deadline_days integer,
  mail_deadline_days integer,
  is_required boolean not null default true,
  description text,
  sort_order integer not null default 100,
  updated_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_updated_at_weeek_manual_upload_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_weeek_manual_upload_settings on public.weeek_manual_upload_settings;
create trigger trg_set_updated_at_weeek_manual_upload_settings
before update on public.weeek_manual_upload_settings
for each row
execute function public.set_updated_at_weeek_manual_upload_settings();

insert into public.weeek_manual_upload_settings (
  module,
  label,
  source_module,
  upload_type,
  upload_offset_days,
  task_deadline_days,
  pm_deadline_days,
  mail_deadline_days,
  is_required,
  description,
  sort_order
)
values
(
  'packaging',
  'Переупаковка',
  'manual_packaging_opp',
  'packaging',
  -7,
  7,
  null,
  null,
  true,
  'Контроль зависшего товара и тар на участке Переупаковка.',
  10
),
(
  'rwp',
  'RWP',
  'manual_rwp_opp',
  'rwp',
  -4,
  4,
  null,
  null,
  true,
  'Контроль товара, поступившего на стол переупаковки, но не получившего корректной обработки.',
  20
),
(
  'pm',
  'ПМ / Почта',
  'manual_pm_buffer',
  'pm_buffer',
  0,
  null,
  2,
  3,
  true,
  'Контроль бессистемно отгруженных тар на буфере последней мили.',
  30
),
(
  'presort',
  'Предсортировка',
  'manual_presort_opp',
  'presort',
  0,
  2,
  null,
  null,
  true,
  'Контроль товара, зависшего на этапе предсортировки.',
  40
),
(
  'labeling',
  'Оклейка',
  'manual_presort_opp',
  'presort',
  0,
  2,
  null,
  null,
  false,
  'Скрытая ветка предсортировки для строк LGR.',
  50
)
on conflict (module) do update set
  label = excluded.label,
  source_module = excluded.source_module,
  upload_type = excluded.upload_type,
  description = excluded.description,
  sort_order = excluded.sort_order;

alter table public.weeek_manual_upload_settings disable row level security;
grant select on public.weeek_manual_upload_settings to anon, authenticated;
grant all on public.weeek_manual_upload_settings to service_role;

comment on table public.weeek_manual_upload_settings is
  'Editable settings for manual OPP uploads: effective upload date offsets, task due-date terms, and required calendar upload types.';
