-- Personal mobile notifications for new violations of employees pinned by a
-- supervisor.  The notification is created in the same transaction as the
-- violation, so the in-app inbox remains reliable even if Web Push is
-- temporarily unavailable.

create extension if not exists pg_net;

create table if not exists public.wms_mobile_notifications (
    id uuid primary key default gen_random_uuid(),
    auth_uid uuid not null references auth.users(id) on delete cascade,
    violation_id uuid not null references public.wms_violations(id) on delete cascade,
    employee_id text not null,
    title text not null,
    body text not null,
    created_at timestamptz not null default timezone('utc', now()),
    read_at timestamptz,
    pushed_at timestamptz,
    unique (auth_uid, violation_id)
);

create index if not exists wms_mobile_notifications_auth_created_idx
    on public.wms_mobile_notifications (auth_uid, created_at desc);
create index if not exists wms_mobile_notifications_violation_idx
    on public.wms_mobile_notifications (violation_id);

alter table public.wms_mobile_notifications enable row level security;
revoke all on public.wms_mobile_notifications from anon;
grant select, update on public.wms_mobile_notifications to authenticated;

drop policy if exists wms_mobile_notifications_read_own on public.wms_mobile_notifications;
create policy wms_mobile_notifications_read_own
    on public.wms_mobile_notifications
    for select to authenticated
    using (auth_uid = auth.uid());

drop policy if exists wms_mobile_notifications_update_own on public.wms_mobile_notifications;
create policy wms_mobile_notifications_update_own
    on public.wms_mobile_notifications
    for update to authenticated
    using (auth_uid = auth.uid())
    with check (auth_uid = auth.uid());

-- A pin is personal, so every supervisor who has pinned the employee gets a
-- separate inbox entry.  Conversations do not suppress this alert: every
-- newly fixed violation must be visible to the supervisor.
create or replace function public.mobile_create_pinned_employee_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_employee_id text;
    v_employee_name text;
    v_violation_type text;
begin
    v_employee_id := coalesce(
        nullif(btrim(new.culprit_employee_id), ''),
        case when btrim(coalesce(new.culprit_name, '')) ~ '^[0-9]+$'
            then btrim(new.culprit_name)
        end
    );
    if v_employee_id is null then
        return new;
    end if;

    v_employee_name := coalesce(nullif(btrim(new.culprit_name), ''), 'Сотрудник ID ' || v_employee_id);
    v_violation_type := coalesce(nullif(btrim(new.violation_type), ''), 'Нарушение');

    insert into public.wms_mobile_notifications (
        auth_uid, violation_id, employee_id, title, body
    )
    select
        pin.manager_auth_uid,
        new.id,
        v_employee_id,
        'Новое нарушение',
        coalesce(nullif(btrim(pin.employee_name), ''), v_employee_name) || ': ' || v_violation_type
    from public.wms_mobile_employee_pins as pin
    where pin.employee_id = v_employee_id
    on conflict (auth_uid, violation_id) do nothing;

    return new;
end;
$$;

drop trigger if exists a_mobile_create_pinned_employee_notifications on public.wms_violations;
create trigger a_mobile_create_pinned_employee_notifications
after insert on public.wms_violations
for each row execute function public.mobile_create_pinned_employee_notifications();

-- pg_net queues the HTTP request outside the client request path.  The secret
-- is kept in Supabase Vault and mirrored only in the Edge Function secret
-- MOBILE_VIOLATION_NOTIFIER_SECRET.  Without it the inbox still works and
-- the trigger becomes a deliberate no-op for the push part.
create or replace function public.mobile_dispatch_pinned_employee_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_secret text;
begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'mobile_violation_notifier_secret'
    limit 1;

    if v_secret is not null then
        perform net.http_post(
            url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/mobile-violation-notifier',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-mobile-notifier-secret', v_secret
            ),
            body := jsonb_build_object('violation_id', new.id)
        );
    end if;
    return new;
end;
$$;

drop trigger if exists b_mobile_dispatch_pinned_employee_push on public.wms_violations;
create trigger b_mobile_dispatch_pinned_employee_push
after insert on public.wms_violations
for each row execute function public.mobile_dispatch_pinned_employee_push();

comment on table public.wms_mobile_notifications is
    'Персональный inbox и очередь push для новых нарушений закреплённых исполнителей.';
