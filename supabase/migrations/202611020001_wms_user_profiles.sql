-- Personal presentation settings for the WMS+ profile drawer.
-- Each row and each file path belongs to the currently authenticated user.

create table if not exists public.wms_user_profiles (
    auth_uid uuid primary key references auth.users(id) on delete cascade,
    avatar_path text,
    cover_path text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

alter table public.wms_user_profiles enable row level security;

drop policy if exists wms_user_profiles_select_own on public.wms_user_profiles;
create policy wms_user_profiles_select_own
    on public.wms_user_profiles for select to authenticated
    using (auth.uid() = auth_uid);

drop policy if exists wms_user_profiles_insert_own on public.wms_user_profiles;
create policy wms_user_profiles_insert_own
    on public.wms_user_profiles for insert to authenticated
    with check (auth.uid() = auth_uid);

drop policy if exists wms_user_profiles_update_own on public.wms_user_profiles;
create policy wms_user_profiles_update_own
    on public.wms_user_profiles for update to authenticated
    using (auth.uid() = auth_uid)
    with check (auth.uid() = auth_uid);

create or replace function public.set_updated_at_wms_user_profiles()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists trg_set_updated_at_wms_user_profiles on public.wms_user_profiles;
create trigger trg_set_updated_at_wms_user_profiles
before update on public.wms_user_profiles
for each row
execute function public.set_updated_at_wms_user_profiles();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'profile-media',
    'profile-media',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_media_insert_own on storage.objects;
create policy profile_media_insert_own
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'profile-media'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists profile_media_update_own on storage.objects;
create policy profile_media_update_own
    on storage.objects for update to authenticated
    using (
        bucket_id = 'profile-media'
        and (storage.foldername(name))[1] = auth.uid()::text
    )
    with check (
        bucket_id = 'profile-media'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists profile_media_delete_own on storage.objects;
create policy profile_media_delete_own
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'profile-media'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

comment on table public.wms_user_profiles is 'Per-auth-user WMS+ profile cover and avatar paths.';
