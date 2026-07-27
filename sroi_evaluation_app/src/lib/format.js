/**
 * Shared formatting and escaping.
 *
 * escapeHTML used to be stranded as a method on appState, so dashboard.js -- the
 * one file that builds HTML from OTHER people's data -- had no access to it and
 * interpolated project names raw. That was cosmetic while every project belonged to
 * one person; with shared projects it becomes cross-user stored XSS.
 */

/**
 * Escape text destined for innerHTML.
 *
 * Prefer textContent where you can; use this only when building a template string.
 */
export function escapeHTML(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

export function formatMoney(amount) {
    return Number(amount ?? 0).toLocaleString('th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

export function formatNumber(amount) {
    return Number(amount ?? 0).toLocaleString('th-TH', {
        maximumFractionDigits: 0
    });
}

/** Date only, e.g. "28 ก.ค. 2569". Matches what the dashboard cards already showed. */
export function formatThaiDate(value) {
    const date = toDate(value);
    if (!date) return '-';
    return date.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

/**
 * Date and time, e.g. "28 ก.ค. 2569 14:32".
 *
 * Pinned to Asia/Bangkok rather than the viewer's local zone: an audit trail should
 * read the same for everyone looking at it, and these timestamps arrive from
 * Postgres as UTC.
 */
export function formatThaiDateTime(value) {
    const date = toDate(value);
    if (!date) return '-';
    return date.toLocaleString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Bangkok'
    });
}

/**
 * The "last edited by" line, e.g. "แก้ไขล่าสุด 28 ก.ค. 2569 14:32 โดย someone@chula.ac.th".
 *
 * Reads projects.updated_by_email, which the database records at write time -- so it
 * needs no access to other people's profile rows.
 *
 * NOTE: returns plain text. Escape it at the call site if inserting via innerHTML.
 *
 * @param {{updated_at?: string, updated_by_email?: string, created_at?: string}} project
 */
export function formatUpdatedMeta(project) {
    if (!project) return '';

    const when = project.updated_at ?? project.created_at;
    if (!when) return '';

    const editor = String(project.updated_by_email ?? '').trim();
    const stamp = formatThaiDateTime(when);

    return editor
        ? `แก้ไขล่าสุด ${stamp} โดย ${editor}`
        : `แก้ไขล่าสุด ${stamp}`;
}

function toDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
