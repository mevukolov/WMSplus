-- Profile images stay writable only by their owner, but can be read by
-- authenticated colleagues assigned to the same warehouse.

drop policy if exists wms_user_profiles_select_own on public.wms_user_profiles;
drop policy if exists wms_user_profiles_select_same_warehouse on public.wms_user_profiles;
create policy wms_user_profiles_select_same_warehouse
    on public.wms_user_profiles for select to authenticated
    using (
        auth.uid() = auth_uid
        or exists (
            select 1
            from public.users as viewer
            join public.users as owner on owner.auth_uid = wms_user_profiles.auth_uid
            where viewer.auth_uid = auth.uid()
              and viewer.user_wh_id is not null
              and viewer.user_wh_id = owner.user_wh_id
        )
    );

-- Keep original files private. The browser receives short-lived signed URLs
-- only after the profile-row policy above permits access.
update storage.buckets
set public = false
where id = 'profile-media';

drop policy if exists profile_media_select_same_warehouse on storage.objects;
create policy profile_media_select_same_warehouse
    on storage.objects for select to authenticated
    using (
        bucket_id = 'profile-media'
        and exists (
            select 1
            from public.wms_user_profiles as profile
            join public.users as viewer on viewer.auth_uid = auth.uid()
            join public.users as owner on owner.auth_uid = profile.auth_uid
            where profile.auth_uid::text = (storage.foldername(name))[1]
              and viewer.user_wh_id is not null
              and viewer.user_wh_id = owner.user_wh_id
        )
    );
