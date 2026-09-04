-- 202609040001_intake_submissions.sql
-- Public, no-auth intake form (see
-- docs/superpowers/specs/2026-09-04-public-intake-form-design.md).
-- Anonymous clients may only insert -- no select/update/delete policy for
-- anon, so the submitted list is not readable through the public API, and
-- neither is a listing of the photo bucket -- but an individual photo IS
-- readable by direct link if you know its exact (unguessable, UUID-based)
-- path, since the bucket is public. The submitted list and the bucket
-- listing are reachable only via the Supabase dashboard or
-- `supabase db query` (both bypass RLS).
create table if not exists public.intake_submissions (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    item_text text not null,
    employee_id integer not null,
    category text not null check (category in (
        'Одежда', 'Обувь', 'Косметика', 'Бытовая химия', 'Мебель',
        'Электроника', 'Ювелирка', 'Для авто', 'Для животных', 'Посуда',
        'Еда', 'Посылка', 'КГТ'
    )),
    photo_path text not null
);

alter table public.intake_submissions enable row level security;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'intake_submissions'
          and policyname = 'intake_submissions_insert_anon'
    ) then
        create policy "intake_submissions_insert_anon" on public.intake_submissions
            for insert to anon with check (true);
    end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'intake-photos',
    'intake-photos',
    true,
    8388608,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'storage'
          and tablename = 'objects'
          and policyname = 'intake_photos_insert_anon'
    ) then
        create policy "intake_photos_insert_anon" on storage.objects
            for insert to anon with check (bucket_id = 'intake-photos');
    end if;
end $$;
