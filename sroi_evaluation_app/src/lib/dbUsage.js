/**
 * Database usage for the admin page's donut ring -- how full the Supabase database
 * is, so an admin knows when to back up (see backupExcel.js / backupSql.js) and the
 * developer knows when to manage/upgrade the project.
 *
 * Calls get_database_usage_bytes() (see supabase/migrations/0008_db_usage_rpc.sql),
 * a SECURITY DEFINER Postgres function that checks public.is_admin() itself before
 * returning pg_database_size(). No direct DB connection or extra secret needed --
 * unlike the "For Dev" SQL backup, this is something PostgREST can already do.
 */

import { supabase } from './supabaseClient.js';

/**
 * Supabase's plan limit is not something the database itself knows -- it's a
 * billing-side ceiling, not a Postgres setting -- so this is a plain constant rather
 * than something fetched. UPDATE THIS if the project's Supabase plan ever changes.
 * Current value: Free tier, 500 MB database size limit.
 */
export const DATABASE_QUOTA_BYTES = 500 * 1024 * 1024;

/** @returns {Promise<number>} bytes currently used by the database */
export async function fetchDatabaseUsageBytes() {
    const { data, error } = await supabase.rpc('get_database_usage_bytes');
    if (error) {
        // Carry the PostgREST error code through -- the caller uses it to tell "the
        // SQL migration was never applied" (PGRST202/PGRST302, function not found)
        // apart from other failures, which otherwise look identical from the outside.
        const wrapped = new Error(`Could not fetch database usage: ${error.message}`);
        wrapped.code = error.code;
        throw wrapped;
    }
    return Number(data);
}

export function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '-';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(1)} MB`;
}
