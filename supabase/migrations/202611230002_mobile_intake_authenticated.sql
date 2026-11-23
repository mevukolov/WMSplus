-- The mobile intake form now signs employees in with Supabase Auth instead
-- of using the legacy anonymous client. Keep the anonymous policies for the
-- old public form, but give an authenticated employee the same narrowly
-- scoped write path.

grant insert on public.intake_submissions to authenticated;

drop policy if exists intake_submissions_insert_authenticated on public.intake_submissions;
create policy intake_submissions_insert_authenticated
    on public.intake_submissions
    for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.users as employee
            where employee.auth_uid = auth.uid()
              and employee.id::text = intake_submissions.employee_id::text
        )
    );

-- The "Без ШК" shift-box RPC was originally exposed only to anon users.
grant execute on function public.wms_no_shk_box_log_item(text, date, text, text)
    to authenticated;

-- A signed-in employee may upload only into their own folder in the
-- dedicated intake-photo bucket. The bucket's size and MIME restrictions
-- remain in force, and one employee cannot write under another's prefix.

drop policy if exists intake_photos_insert_authenticated on storage.objects;
create policy intake_photos_insert_authenticated
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'intake-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
