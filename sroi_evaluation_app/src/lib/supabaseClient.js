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

function createMissingConfigClient() {
  const error = new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Auth and database calls are disabled in this local session.'
  );

  const emptyQuery = {
    select: () => emptyQuery,
    insert: () => emptyQuery,
    update: () => emptyQuery,
    delete: () => emptyQuery,
    upsert: () => emptyQuery,
    eq: () => emptyQuery,
    order: () => emptyQuery,
    maybeSingle: async () => ({ data: null, error }),
    single: async () => ({ data: null, error }),
    then: resolve => Promise.resolve({ data: [], error }).then(resolve)
  };

  console.warn(error.message);

  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithOAuth: async () => ({ data: null, error }),
      signInWithPassword: async () => ({ data: null, error }),
      signOut: async () => ({ error: null })
    },
    from: () => emptyQuery,
    rpc: async () => ({ data: null, error })
  };
}

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : createMissingConfigClient();
