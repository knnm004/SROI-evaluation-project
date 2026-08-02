/**
 * Admin page: every project in the system, with edit and delete.
 *
 * The isAdmin() check below is a redirect for convenience, NOT a security boundary --
 * anyone can request this file. What actually protects the data is RLS: the policies
 * in supabase/migrations/0005_rls_v2.sql only return other people's projects when
 * public.is_admin() is true for the caller. A non-admin who loads this page anyway
 * simply sees an empty table.
 */

import './style.css';
import { supabase } from './lib/supabaseClient.js';
import { loadIdentity, signOut } from './lib/session.js';
import { isAdmin } from './lib/permissions.js';
import { escapeHTML, formatThaiDateTime, formatMoney } from './lib/format.js';

/** An admin list is unbounded -- never select the whole table at once. */
const PAGE_SIZE = 50;

let identity = null;
let allProjects = [];
let offset = 0;
let hasMore = true;
let pendingDelete = null;

document.addEventListener('DOMContentLoaded', async () => {
    identity = await loadIdentity();
    if (!identity) return;

    if (!isAdmin(identity)) {
        alert('หน้านี้สำหรับผู้ดูแลระบบเท่านั้น (This page is for administrators only.)');
        window.location.replace('/dashboard.html');
        return;
    }

    document.getElementById('admin-email').textContent = identity.email;
    document.getElementById('logout-btn')?.addEventListener('click', () => signOut());
    document.getElementById('admin-search')?.addEventListener('input', renderTable);
    document.getElementById('admin-load-more')?.addEventListener('click', loadPage);

    bindDeleteModal();
    await loadPage();
});

async function loadPage() {
    const { data, error } = await supabase
        .from('projects')
        .select('id, project_name, user_email, owner_id, updated_at, updated_by_email, assessment_data, project_members(user_id)')
        .order('updated_at', { ascending: false, nullsFirst: false })
        .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
        console.error('Could not load projects:', error);
        alert(`ไม่สามารถโหลดข้อมูลได้ (Could not load projects): ${error.message}`);
        return;
    }

    allProjects = allProjects.concat(data ?? []);
    offset += data?.length ?? 0;
    hasMore = (data?.length ?? 0) === PAGE_SIZE;

    document.getElementById('admin-load-more')?.classList.toggle('hidden', !hasMore);
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('admin-tbody');
    const empty = document.getElementById('admin-empty');
    const count = document.getElementById('admin-count');
    if (!tbody) return;

    const query = (document.getElementById('admin-search')?.value ?? '').trim().toLowerCase();
    const rows = query
        ? allProjects.filter(p =>
              String(p.project_name ?? '').toLowerCase().includes(query) ||
              String(p.user_email ?? '').toLowerCase().includes(query))
        : allProjects;

    if (count) {
        // Says "loaded", not "total" -- pagination means this is not the whole table.
        count.textContent = query
            ? `แสดง ${rows.length} จาก ${allProjects.length} โครงการที่โหลดมา`
            : `โหลดมาแล้ว ${allProjects.length} โครงการ${hasMore ? ' (ยังมีเพิ่ม)' : ''}`;
    }

    empty?.classList.toggle('hidden', rows.length > 0);

    tbody.innerHTML = rows.map(project => {
        const name = project.project_name || 'ไม่ได้ระบุชื่อโครงการ';
        const ratio = project.assessment_data?.sroiCalculations?.sroiRatio;
        const teamCount = (project.project_members ?? []).length;

        return `
            <tr class="hover:bg-gray-50 transition-colors" data-testid="admin-row">
                <td class="px-4 py-3">
                    <a href="/index.html?id=${encodeURIComponent(project.id)}"
                       class="font-semibold text-gray-900 hover:text-chula hover:underline">
                        ${escapeHTML(name)}
                    </a>
                </td>
                <td class="px-4 py-3 text-gray-600">${escapeHTML(project.user_email)}</td>
                <td class="px-4 py-3 text-center text-gray-600">${teamCount || '-'}</td>
                <td class="px-4 py-3 text-right font-medium text-gray-900">
                    ${Number.isFinite(ratio) && ratio > 0 ? `1 : ${formatMoney(ratio)}` : '-'}
                </td>
                <td class="px-4 py-3 text-gray-500 text-xs">
                    ${project.updated_at ? escapeHTML(formatThaiDateTime(project.updated_at)) : '-'}
                    ${project.updated_by_email
                        ? `<br><span class="text-gray-400">โดย ${escapeHTML(project.updated_by_email)}</span>`
                        : ''}
                </td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                    <a href="/index.html?id=${encodeURIComponent(project.id)}"
                       data-testid="admin-edit-link"
                       class="text-chula-darker hover:underline font-medium mr-3">แก้ไข</a>
                    <button type="button" data-delete-id="${escapeHTML(project.id)}"
                            data-testid="admin-delete-btn"
                            class="text-red-500 hover:text-red-700 hover:underline font-medium">ลบ</button>
                </td>
            </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-delete-id]').forEach(btn => {
        btn.addEventListener('click', () => openDeleteModal(btn.dataset.deleteId));
    });
}

// --- Delete flow -------------------------------------------------------------

function openDeleteModal(projectId) {
    const project = allProjects.find(p => p.id === projectId);
    if (!project) return;

    // An untitled project would otherwise be impossible to confirm, so it gets a
    // fixed sentinel the admin can actually type.
    pendingDelete = {
        id: project.id,
        expected: project.project_name?.trim() || 'ไม่ได้ระบุชื่อโครงการ'
    };

    document.getElementById('delete-expected-name').textContent = pendingDelete.expected;

    const input = document.getElementById('delete-confirm-input');
    const confirmBtn = document.getElementById('delete-confirm-btn');
    input.value = '';
    confirmBtn.disabled = true;
    document.getElementById('delete-error')?.classList.add('hidden');

    document.getElementById('delete-modal').showModal();
    input.focus();
}

function bindDeleteModal() {
    const modal = document.getElementById('delete-modal');
    const input = document.getElementById('delete-confirm-input');
    const confirmBtn = document.getElementById('delete-confirm-btn');

    input?.addEventListener('input', () => {
        const matches =
            input.value.trim().toLowerCase() === (pendingDelete?.expected ?? '').toLowerCase();
        confirmBtn.disabled = !matches;
    });

    document.getElementById('delete-cancel')?.addEventListener('click', () => {
        pendingDelete = null;
        modal.close();
    });

    confirmBtn?.addEventListener('click', performDelete);
}

async function performDelete() {
    if (!pendingDelete) return;

    const confirmBtn = document.getElementById('delete-confirm-btn');
    const errorEl = document.getElementById('delete-error');
    const originalLabel = confirmBtn.innerHTML;

    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>กำลังลบ...';

    const { data, error } = await supabase
        .from('projects')
        .delete()
        .eq('id', pendingDelete.id)
        .select();

    const showError = message => {
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalLabel;
    };

    if (error) {
        console.error('Delete failed:', error);
        showError(`ลบไม่สำเร็จ: ${error.message}`);
        return;
    }

    // Zero rows means the policy refused it. Do NOT drop the row from the table --
    // that would imply the delete worked.
    if (!data || data.length === 0) {
        showError('ลบไม่สำเร็จ: ไม่พบโครงการ หรือคุณไม่มีสิทธิ์ลบ (Not found, or permission denied.)');
        return;
    }

    allProjects = allProjects.filter(p => p.id !== pendingDelete.id);
    pendingDelete = null;
    confirmBtn.innerHTML = originalLabel;
    document.getElementById('delete-modal').close();
    renderTable();
}
