-- 202609290001_users_auth_uid.sql
-- Links each employee row to their real Supabase Auth identity, ahead of
-- retiring the plaintext login_user RPC (see
-- docs/superpowers/specs/2026-09-29-rls-auth-migration-design.md). Purely
-- additive -- users.pass and login_user keep working exactly as today
-- until the cutover.
alter table public.users
    add column if not exists auth_uid uuid references auth.users(id);
