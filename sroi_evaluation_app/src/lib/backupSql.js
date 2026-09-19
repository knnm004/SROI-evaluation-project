/**
 * "For Dev" backup: a restorable SQL dump, generated server-side.
 *
 * This cannot be done client-side like the Excel export -- a real backup needs a
 * direct Postgres connection, and the credential capable of that must never reach
 * the browser bundle (see supabase/functions/admin-backup/index.ts for why). The
 * client's only job is calling the Edge Function with the signed-in user's own
 * session token and downloading whatever it returns.
 *
 * The Edge Function re-checks admin on the server before doing anything -- the
 * isAdmin() gate on this page is UI convenience only, same as admin.js's own
 * top-of-file comment says about the page redirect.
 */

import { supabase } from './supabaseClient.js';
import { backupFilename, triggerBlobDownload } from './backup.js';

const FUNCTION_NAME = 'admin-backup';

export async function downloadSqlBackup() {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
        throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่ (Your session has expired. Please sign in again.)');
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!supabaseUrl) {
        throw new Error('Missing VITE_SUPABASE_URL; cannot reach the backup function.');
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/${FUNCTION_NAME}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
        }
    });

    if (!response.ok) {
        const message = await response.text().catch(() => '');
        let detail = message;
        try { detail = JSON.parse(message).error ?? message; } catch { /* not JSON, use as-is */ }
        throw new Error(
            response.status === 403
                ? `ไม่มีสิทธิ์ดำเนินการนี้ (Permission denied): ${detail || 'admin only'}`
                : `สร้างไฟล์สำรองไม่สำเร็จ (Backup failed): ${detail || response.statusText}`
        );
    }

    const blob = await response.blob();
    triggerBlobDownload(blob, backupFilename('sql'));
}
