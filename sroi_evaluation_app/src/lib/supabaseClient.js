import { createClient } from '@supabase/supabase-js';

/**
 * The single Supabase client for every page.
 *
 * app.js and dashboard.js each used to call createClient() themselves, which meant
 * two clients in the same bundle and two independent auth-state caches on
 * dashboard.html (which loads both files).
 *
 * These values are inlined into the shipped bundle by Vite because of the VITE_
 * prefix, and that is by design -- the publishable key is not a secret. It is only
 * safe because Postgres RLS decides what any given caller may actually read or
 * write. See supabase/migrations/0005_rls_v2.sql.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
