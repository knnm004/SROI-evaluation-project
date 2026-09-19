// Edge Function: admin-backup
//
// Generates a restorable SQL dump (schema DDL, if available, plus INSERT statements
// for every row in every public table) and returns it as a file download.
//
// WHY THIS CAN'T BE A CLIENT-SIDE EXPORT (see src/lib/backupSql.js):
// A real backup needs a direct Postgres connection, via SUPABASE_DB_URL. That
// connection string (and the service-role key used below to check the caller's
// role) must never reach the browser bundle -- anyone inspecting network traffic
// or the JS bundle would get full read/write access to the whole database. This
// function is the only place those credentials are used, and they never leave
// the server.
//
// AUTHORIZATION: this function re-checks admin on the SERVER. The isAdmin() check
// in src/lib/permissions.js (used to show/hide the Backup button in admin.js) is a
// UI convenience only -- exactly like the comment at the top of admin.js says about
// the page-level redirect. A request here is trusted only after verifying the
// caller's JWT and looking up their role in user_profiles with the service-role key.
//
// REQUIRED SECRETS (see the deployment notes in the PR/README):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL
//   -- all four are auto-injected by hosted Supabase for every Edge Function.
//   Confirm with `supabase secrets list` after first deploy; if SUPABASE_DB_URL is
//   missing (e.g. on some self-hosted setups) set it by hand to the project's direct
//   Postgres connection string (Project Settings -> Database -> Connection string).

import { createClient } from 'npm:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Applied first, in this order, for a dump that restores without FK errors. Any
// other public table found at runtime (deliberately NOT assumed to be a fixed list --
// see enumerateTables()) is appended afterwards in alphabetical order.
const PREFERRED_TABLE_ORDER = [
    'user_profiles', 'projects', 'project_members', 'project_invitations', 'approved_signup_emails'
];

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        const dbUrl = Deno.env.get('SUPABASE_DB_URL');

        if (!supabaseUrl || !serviceRoleKey || !dbUrl) {
            return jsonError('Server misconfigured: missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_DB_URL secret.', 500);
        }

        const authHeader = req.headers.get('Authorization') ?? '';
        const jwt = authHeader.replace(/^Bearer\s+/i, '');
        if (!jwt) return jsonError('Missing Authorization header.', 401);

        // Service-role client: verifies the JWT and reads user_profiles regardless of RLS
        // (this function IS the trusted server-side check other code in this project relies on).
        const admin = createClient(supabaseUrl, serviceRoleKey);

        const { data: userData, error: userError } = await admin.auth.getUser(jwt);
        if (userError || !userData?.user) return jsonError('Invalid or expired session.', 401);

        const { data: profile, error: profileError } = await admin
            .from('user_profiles')
            .select('role')
            .eq('id', userData.user.id)
            .maybeSingle();

        if (profileError) return jsonError(`Could not verify role: ${profileError.message}`, 500);
        if (!profile || String(profile.role).toLowerCase() !== 'admin') {
            return jsonError('Admins only.', 403);
        }

        const sql = await generateSqlDump(dbUrl);

        return new Response(sql, {
            status: 200,
            headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/sql; charset=utf-8',
                'Content-Disposition': 'attachment; filename="backup.sql"'
            }
        });
    } catch (error) {
        console.error('admin-backup failed:', error);
        return jsonError(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`, 500);
    }
});

function jsonError(message: string, status: number) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
}

async function generateSqlDump(dbUrl: string): Promise<string> {
    const db = postgres(dbUrl, { max: 1 });
    try {
        const tables = await enumerateTables(db);
        const schemaSection = await buildSchemaSection();
        const dataSection = await buildDataSection(db, tables);

        return [
            '-- CU Triple S -- Full SQL backup',
            `-- Generated: ${new Date().toISOString()}`,
            '-- Restore with: psql "<connection string>" -f this_file.sql',
            '',
            schemaSection,
            '',
            'BEGIN;',
            '',
            dataSection,
            'COMMIT;',
            ''
        ].join('\n');
    } finally {
        await db.end({ timeout: 5 });
    }
}

async function enumerateTables(db: postgres.Sql): Promise<string[]> {
    const rows = await db<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
    `;
    const found = rows.map(r => r.table_name);
    const ordered = PREFERRED_TABLE_ORDER.filter(t => found.includes(t));
    const remaining = found.filter(t => !PREFERRED_TABLE_ORDER.includes(t)).sort();
    return [...ordered, ...remaining];
}

/**
 * supabase/migrations/ is referenced throughout this project's CLAUDE.md as the
 * schema history, but is not present in this checkout (confirmed: no supabase/
 * directory existed before this function was added). If a future checkout DOES
 * have it, this fetches nothing here -- migrations only exist on disk, not in the
 * database, so an Edge Function has no way to read them. Ship the file this
 * function returns alongside a fresh `supabase db pull` (or the dashboard's
 * Database > Migrations history) rather than expecting DDL in the output.
 */
async function buildSchemaSection(): Promise<string> {
    return [
        '-- ============================================================',
        '-- SCHEMA DDL WAS NOT INCLUDED.',
        '-- This function generates data only (INSERT statements below).',
        '-- To restore into an EMPTY database you also need the schema. Get it with:',
        '--   supabase db pull        (writes supabase/migrations/*.sql from the live db)',
        '-- or from the Supabase Dashboard: Database > Migrations / Backups.',
        '-- Apply that schema DDL BEFORE running the INSERT statements below.',
        '-- ============================================================='
    ].join('\n');
}

async function buildDataSection(db: postgres.Sql, tables: string[]): Promise<string> {
    const sections: string[] = [];

    for (const table of tables) {
        const columnTypes = await fetchColumnTypes(db, table);
        const rows = await db.unsafe(`SELECT * FROM "public"."${table}"`);

        sections.push(`-- ---- ${table} (${rows.length} rows) ----`);
        if (rows.length === 0) {
            sections.push(`-- (no rows)\n`);
            continue;
        }

        for (const row of rows) {
            const columns = Object.keys(row);
            const values = columns.map(col => formatValue(row[col], columnTypes.get(col)));
            const quotedColumns = columns.map(c => `"${c}"`).join(', ');
            sections.push(`INSERT INTO "public"."${table}" (${quotedColumns}) VALUES (${values.join(', ')});`);
        }
        sections.push('');
    }

    return sections.join('\n');
}

async function fetchColumnTypes(db: postgres.Sql, table: string): Promise<Map<string, string>> {
    const rows = await db<{ column_name: string; data_type: string }[]>`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
    `;
    return new Map(rows.map(r => [r.column_name, r.data_type]));
}

const NUMERIC_TYPES = new Set(['numeric', 'integer', 'bigint', 'smallint', 'double precision', 'real']);

function formatValue(value: unknown, dataType?: string): string {
    if (value === null || value === undefined) return 'NULL';

    if (dataType === 'jsonb' || dataType === 'json') {
        return `'${JSON.stringify(value).replace(/'/g, "''")}'::${dataType}`;
    }
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (dataType && NUMERIC_TYPES.has(dataType) && (typeof value === 'number' || typeof value === 'string')) {
        // postgres.js returns numeric/bigint as strings to avoid precision loss; both
        // forms are already valid unquoted SQL numeric literals.
        return String(value);
    }
    if (value instanceof Date) return `'${value.toISOString()}'`;
    if (dataType === 'ARRAY') {
        // Best-effort: render as a Postgres array literal of quoted text elements.
        const items = Array.isArray(value) ? value : [value];
        const literal = items.map(item => `"${String(item).replace(/"/g, '\\"')}"`).join(',');
        return `'{${literal}}'`;
    }
    if (typeof value === 'object') {
        return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }
    return `'${String(value).replace(/'/g, "''")}'`;
}
