// dashboard.html no longer loads main.js, so this page imports its own styles.
import './style.css';
import { supabase } from './lib/supabaseClient.js';
import { escapeHTML, formatThaiDate, formatUpdatedMeta } from './lib/format.js';
import { loadIdentity, signOut } from './lib/session.js';
import { isAdmin, canDeleteProject } from './lib/permissions.js';

let currentIdentity = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Replaces the old getSession() + isEmailDomainAllowed() pair. Access now comes
    // from having a user_profiles row, not from an email domain -- which is what lets
    // non-Chula member accounts in. Redirects to '/' on its own if not signed in.
    const identity = await loadIdentity();
    if (!identity) return;

    currentIdentity = identity;

    document.getElementById('user-email-display').innerText = identity.email;
    document.getElementById('welcome-message').innerText = `Welcome back, ${identity.displayName}`;

    // Admins get a link to the admin page; everyone else never sees it exists.
    if (isAdmin(identity)) {
        document.getElementById('admin-link')?.classList.remove('hidden');
    }

    fetchProjects();

    document.getElementById('logout-btn')?.addEventListener('click', () => signOut());
});

async function fetchProjects() {
    const container = document.getElementById('projects-container');

    // No .eq('user_email', ...): RLS (0005) already limits this to projects you own,
    // are a researcher on, or -- if you are an admin -- all of them. Filtering here as
    // well would hide the shared ones.
    const { data: projects, error } = await supabase
        .from('projects')
        .select('*, project_members(user_id, member_email)')
        .order('updated_at', { ascending: false, nullsFirst: false });

    if (error) {
        console.error("Error fetching projects:", error);
        container.innerHTML = `<div class="col-span-full text-center py-10 text-red-500">เกิดข้อผิดพลาดในการโหลดข้อมูล (Error loading projects)</div>`;
        return;
    }

    container.innerHTML = '';

    if (projects.length === 0) {
        container.innerHTML = `
            <div class="col-span-full bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center text-gray-400 mx-auto mb-4 text-2xl">
                    <i class="fa-regular fa-folder-open"></i>
                </div>
                <h3 class="text-xl font-bold text-gray-800 mb-2">No projects found</h3>
                <p class="text-gray-500">You haven't started any SROI assessments yet.</p>
            </div>
        `;
        return;
    }

    projects.forEach(project => {
        const dateStr = formatThaiDate(project.created_at);
        const updatedMeta = formatUpdatedMeta(project);

        // Shared-with-me vs mine, so the list is readable once colleagues appear in it.
        const isMine = project.owner_id === currentIdentity?.userId;
        const teamCount = (project.project_members ?? []).length;
        const mayDelete = canDeleteProject(currentIdentity, project);

        const badge = isMine
            ? '<div class="bg-chula bg-opacity-10 text-chula text-xs font-bold px-3 py-1 rounded-full">โครงการของฉัน</div>'
            : `<div class="bg-blue-50 text-blue-700 text-xs font-bold px-3 py-1 rounded-full" title="${escapeHTML(project.user_email)}">
                   <i class="fa-solid fa-users mr-1"></i>ร่วมวิจัย
               </div>`;

        const card = document.createElement('div');
        card.className = "bg-white rounded-xl shadow-sm hover:shadow-lg border border-gray-200 p-6 transition-all duration-300 flex flex-col h-full relative group hover:-translate-y-1";
        card.setAttribute('data-testid', 'project-card');

        card.innerHTML = `
            <div class="flex-grow cursor-pointer" onclick="window.location.href='/index.html?id=${project.id}'">
                <div class="flex items-start justify-between mb-3 pr-8 gap-2 flex-wrap">
                    ${badge}
                    ${teamCount > 0
                        ? `<div class="text-xs text-gray-500 font-medium" data-testid="project-card-team">
                               <i class="fa-solid fa-user-group mr-1"></i>${teamCount} ผู้ร่วมวิจัย
                           </div>`
                        : ''}
                </div>
                <h3 class="text-xl font-bold text-gray-900 mb-2 pr-8 group-hover:text-chula transition-colors line-clamp-2">
                    ${escapeHTML(project.project_name) || 'ไม่ได้ระบุชื่อโครงการ (Untitled)'}
                </h3>
                <p class="text-sm text-gray-500 mb-1">
                    <i class="fa-regular fa-calendar mr-1"></i> เริ่มต้นเมื่อ: ${dateStr}
                </p>
                ${updatedMeta
                    ? `<p class="text-xs text-gray-400 mb-4" data-testid="project-card-updated">
                           <i class="fa-regular fa-pen-to-square mr-1"></i>${escapeHTML(updatedMeta)}
                       </p>`
                    : '<div class="mb-4"></div>'}
            </div>

            <div class="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center cursor-pointer" onclick="window.location.href='/index.html?id=${project.id}'">
                <span class="text-chula font-medium text-sm flex items-center">
                    ดูรายละเอียด <i class="fa-solid fa-arrow-right ml-2 text-xs transform group-hover:translate-x-1 transition-transform"></i>
                </span>
            </div>

            ${mayDelete
                ? `<button class="delete-btn absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors z-10"
                           title="ลบโครงการ" data-testid="project-delete-btn">
                       <i class="fa-solid fa-xmark text-lg"></i>
                   </button>`
                : ''}
        `;

        // Only owners and admins get a delete button, so this may legitimately be absent.
        const deleteBtn = card.querySelector('.delete-btn');
        deleteBtn?.addEventListener('click', async (e) => {
            // Stop the click from opening the project!
            e.stopPropagation(); 
            
            const isConfirmed = confirm(`คุณต้องการลบโครงการ "${project.project_name || 'ไม่ได้ระบุชื่อโครงการ'}" ใช่หรือไม่?\n(Are you sure you want to delete this project? This cannot be undone.)`);
            
            if (isConfirmed) {
                // Change the icon to a spinner while deleting
                deleteBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                
                // No .eq('user_email', ...): an admin deleting someone else's project
                // would match zero rows. RLS's delete policy (owner or admin) decides,
                // and .select() reports what was actually removed.
                const { data, error } = await supabase
                    .from('projects')
                    .delete()
                    .eq('id', project.id)
                    .select();

                if (error) {
                    console.error("Error deleting project:", error);
                    alert(`เกิดข้อผิดพลาดจากฐานข้อมูล (Database Error): ${error.message}`);
                    deleteBtn.innerHTML = '<i class="fa-solid fa-xmark text-lg"></i>';
                }
                // Zero rows: already gone, or the policy refused it.
                else if (data && data.length === 0) {
                    alert("ลบไม่สำเร็จ: ไม่พบโครงการนี้ หรือคุณไม่มีสิทธิ์ลบ (Delete failed: project not found, or you don't have permission to delete it.)");
                    deleteBtn.innerHTML = '<i class="fa-solid fa-xmark text-lg"></i>';
                }
                else {
                    fetchProjects();
                }
            }
        });

        container.appendChild(card);
    });
}