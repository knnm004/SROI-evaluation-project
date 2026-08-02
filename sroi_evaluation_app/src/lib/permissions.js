/**
 * Who may do what -- for SHAPING THE UI ONLY.
 *
 * ============================================================================
 * NOTHING IN THIS FILE ENFORCES ANYTHING.
 *
 * It runs in the browser, so it can be edited, skipped, or called with made-up
 * arguments. Its only job is deciding which buttons to show, so a user is not
 * offered an action that will fail.
 *
 * The real enforcement is the RLS policies in supabase/migrations/0005_rls_v2.sql,
 * which mirror these rules. Change one and you must change the other.
 * ============================================================================
 *
 * Deliberate mirror of 0005:
 *   can_access_project()  <->  canViewProject / canEditProject
 *   can_manage_project()  <->  canDeleteProject / canManageMembers
 */

export const ROLES = Object.freeze({
    ADMIN: 'admin',
    RESEARCHER: 'researcher',
    MEMBER: 'member'
});

/**
 * Coerce whatever came back from the database into a known role.
 *
 * An unknown or missing value degrades to the LEAST privileged role, never the
 * most. A typo in the database must not hand out admin.
 */
export function normaliseRole(value) {
    const role = String(value ?? '').trim().toLowerCase();
    return Object.values(ROLES).includes(role) ? role : ROLES.MEMBER;
}

const sameEmail = (a, b) =>
    !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

export function isAdmin(identity) {
    return identity?.role === ROLES.ADMIN;
}

/** Owner comparison uses userId; user_email is a display value and can go stale. */
export function isOwner(identity, project) {
    if (!identity?.userId || !project) return false;
    if (project.owner_id) return project.owner_id === identity.userId;
    // Pre-migration fallback for a row whose owner_id was never backfilled.
    return sameEmail(identity.email, project.user_email);
}

export function isCollaborator(identity, project) {
    if (!identity?.userId || !project) return false;
    return (project.project_members ?? []).some(
        member => member.user_id === identity.userId || sameEmail(member.member_email, identity.email)
    );
}

export function canViewProject(identity, project) {
    return isAdmin(identity) || isOwner(identity, project) || isCollaborator(identity, project);
}

/** Collaborators may edit -- that is the point of adding them. */
export function canEditProject(identity, project) {
    return canViewProject(identity, project);
}

/** Deleting destroys everyone's work at once, so it stays with the owner and admins. */
export function canDeleteProject(identity, project) {
    return isAdmin(identity) || isOwner(identity, project);
}

export function canManageMembers(identity, project) {
    return isAdmin(identity) || isOwner(identity, project);
}

/** Thai label for the access banner and role badges. */
export function describeAccess(identity, project) {
    if (isOwner(identity, project))       return 'เจ้าของโครงการ (Owner)';
    if (isAdmin(identity))                return 'ผู้ดูแลระบบ (Admin)';
    if (isCollaborator(identity, project)) return 'ผู้ร่วมวิจัย (Collaborator)';
    return 'อ่านอย่างเดียว (View only)';
}
