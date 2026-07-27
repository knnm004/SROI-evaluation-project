/**
 * Sign-in, sign-out, and "who am I".
 *
 * THE ACCESS RULE CHANGED HERE. It used to be "is your email @chula.ac.th?",
 * checked in two places, which force-signed-out everyone else. That could never
 * admit the สมาชิก/บุคคลทั่วไป member accounts.
 *
 * It is now "do you have a row in user_profiles?" -- that is, has an administrator
 * set you up. Email domain still governs who may CREATE an account (the signup hook
 * in supabase/migrations/0007_signup_hook_v2.sql) but plays no part in reaching
 * data. Access is ownership and membership, enforced by RLS in 0005.
 */

import { supabase } from './supabaseClient.js';
import { normaliseRole } from './permissions.js';

const DRAFT_KEY_PREFIX = 'sroi-evaluation-draft';

const NOT_PROVISIONED_MESSAGE =
    'บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าใช้งาน กรุณาติดต่อผู้ดูแลระบบ ' +
    '(This account has not been granted access. Please contact an administrator.)';

/** Resolved once per page load. */
let identityPromise = null;

/**
 * The signed-in user and their role, or null.
 *
 * Memoised, so several callers on one page share a single round trip -- this also
 * removes the duplicate getSession() that dashboard.html used to make.
 *
 * Deliberately NOT cached in localStorage/sessionStorage: a stored role is
 * user-editable, and sooner or later something would trust it. One indexed lookup
 * per page load is the right price. The role only shapes the UI in any case; RLS is
 * what actually decides.
 *
 * @param {{redirectOnMissing?: boolean}} options
 * @returns {Promise<{userId: string, email: string, role: string, displayName: string}|null>}
 */
export function loadIdentity(options = {}) {
    if (!identityPromise) identityPromise = resolveIdentity(options);
    return identityPromise;
}

async function resolveIdentity({ redirectOnMissing = true, redirectTo = '/' } = {}) {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
        if (redirectOnMissing) window.location.replace(redirectTo);
        return null;
    }

    let profile = await fetchProfile(session.user.id);

    // Self-heal: if the auth.users trigger from 0003 could not be created in this
    // project, the profile row is missing on first sign-in. ensure_own_profile()
    // creates it (and claims any pending project invitations).
    if (!profile) {
        const { data, error: rpcError } = await supabase.rpc('ensure_own_profile');
        if (rpcError) {
            console.error('Could not provision profile:', rpcError.message);
        } else {
            profile = Array.isArray(data) ? data[0] : data;
        }
    }

    if (!profile) {
        console.error(`No profile for ${session.user.email}; refusing access.`);
        await supabase.auth.signOut();
        alert(NOT_PROVISIONED_MESSAGE);
        if (redirectOnMissing) window.location.replace(redirectTo);
        return null;
    }

    return Object.freeze({
        userId: session.user.id,
        email: String(profile.email ?? session.user.email ?? '').trim().toLowerCase(),
        role: normaliseRole(profile.role),
        displayName: profile.display_name || profile.email || session.user.email
    });
}

async function fetchProfile(userId) {
    // maybeSingle(): "no profile yet" is an expected branch, not an error.
    const { data, error } = await supabase
        .from('user_profiles')
        .select('id, email, role, display_name')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        console.error('Could not load profile:', error.message);
        return null;
    }
    return data;
}

/**
 * Chula sign-in.
 *
 * No `hd` parameter: it accepts only one domain so it cannot express both
 * chula.ac.th and student.chula.ac.th, and Google's own documentation says not to
 * rely on it as a control because client-side requests can be modified. The real
 * restriction is the signup hook.
 */
export async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            queryParams: { prompt: 'select_account' }, // always show the chooser
            redirectTo: `${window.location.origin}/dashboard.html`
        }
    });
    if (error) throw error;
}

/**
 * Member sign-in. Accounts are created by an administrator; there is no signup.
 *
 * Returns a result object rather than throwing, and uses ONE message for every
 * failure on purpose: saying "no such account" versus "wrong password" turns this
 * form into a way to discover which email addresses exist.
 */
export async function signInWithPassword(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email: String(email ?? '').trim().toLowerCase(),
        password
    });

    if (error) {
        return {
            ok: false,
            message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง (Incorrect email or password)'
        };
    }
    return { ok: true, session: data.session };
}

/** Remove this app's drafts without touching anything else in localStorage. */
export function clearLocalDrafts() {
    Object.keys(localStorage)
        .filter(key => key.startsWith(DRAFT_KEY_PREFIX))
        .forEach(key => localStorage.removeItem(key));
}

export async function signOut({ redirectTo = '/' } = {}) {
    try {
        await supabase.auth.signOut();
    } catch (error) {
        console.error('Error signing out:', error);
    }
    // Scoped rather than localStorage.clear(), which dashboard.js used to call and
    // which wipes unrelated keys for the whole origin.
    clearLocalDrafts();
    identityPromise = null;
    if (redirectTo) window.location.replace(redirectTo);
}
