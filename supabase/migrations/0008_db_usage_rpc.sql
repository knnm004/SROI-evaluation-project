-- 0008_db_usage_rpc.sql
--
-- Adds get_database_usage_bytes(), an admin-only RPC backing the "Database usage"
-- donut on admin.html. pg_database_size() is a plain SQL function -- wrapping it in
-- a SECURITY DEFINER function that checks public.is_admin() itself (rather than
-- trusting the caller) lets the browser call it directly through PostgREST with the
-- existing anon-key client, the same way add_project_researcher() already works
-- (see 0005_rls_v2.sql). No direct Postgres connection or extra secret needed --
-- unlike supabase/functions/admin-backup, which genuinely needs one because it does
-- something PostgREST cannot (enumerate tables and dump full row data).
--
-- NOTE: migrations 0001-0007 are referenced throughout CLAUDE.md as already applied
-- to the live database, but are not present in this checkout (see the note in
-- supabase/functions/admin-backup/index.ts). This file assumes public.is_admin()
-- already exists in the live database from that earlier work. Apply this file via
-- the Supabase Dashboard's SQL Editor, the same way the prior migrations were
-- applied to this project.

create or replace function public.get_database_usage_bytes()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'Admins only';
    end if;

    return pg_database_size(current_database());
end;
$$;

revoke all on function public.get_database_usage_bytes() from public;
grant execute on function public.get_database_usage_bytes() to authenticated;
