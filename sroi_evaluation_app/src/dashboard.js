import { createClient } from '@supabase/supabase-js'

// 1. Initialize Supabase securely using Vite environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

document.addEventListener('DOMContentLoaded', async () => {
    // 2. Check Authentication Status
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()

    if (sessionError || !session) {
        // If not logged in, redirect back to login page
        window.location.href = '/';
        return;
    }

    const userEmail = session.user.email;
    
    // 3. Update Header UI (Matches new HTML IDs)
    document.getElementById('user-email-display').innerText = userEmail;
    document.getElementById('welcome-message').innerText = `Welcome back, ${userEmail}`;

    // 4. Fetch Previous Projects
    fetchProjects(userEmail);

    // 5. Bind Logout Button
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        // 1. Sign out from Supabase
        await supabase.auth.signOut();
        
        // 2. Clear cached local drafts
        localStorage.clear(); 
        
        // 3. Redirect back to landing/login page cleanly
        window.location.href = '/';
    });
});

async function fetchProjects(email) {
    const container = document.getElementById('projects-container');
    
    const { data: projects, error } = await supabase
        .from('projects')
        .select('*')
        .eq('user_email', email)
        .order('updated_at', { ascending: false });

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
        const dateStr = new Date(project.created_at).toLocaleDateString('th-TH', {
            year: 'numeric', month: 'short', day: 'numeric'
        });
        const updatedDateStr = new Date(project.updated_at || project.created_at).toLocaleDateString('th-TH', {
            year: 'numeric', month: 'short', day: 'numeric'
        });

        const card = document.createElement('div');
        // Added 'relative' to the card classes so we can position the delete button perfectly
        card.className = "bg-white rounded-xl shadow-sm hover:shadow-lg border border-gray-200 p-6 transition-all duration-300 flex flex-col h-full relative group hover:-translate-y-1";
        
        card.innerHTML = `
            <!-- The main clickable area of the card -->
            <div class="flex-grow cursor-pointer" onclick="window.location.href='/index.html?id=${project.id}'">
                <div class="flex items-start justify-between mb-3">
                    <div class="bg-chula bg-opacity-10 text-chula text-xs font-bold px-3 py-1 rounded-full">
                        SROI Project
                    </div>
                </div>
                <h3 class="text-xl font-bold text-gray-900 mb-2 pr-8 group-hover:text-chula transition-colors line-clamp-2">
                    ${project.project_name || 'ไม่ได้ระบุชื่อโครงการ (Untitled)'}
                </h3>
                <p class="text-sm text-gray-500 mb-1">
                    <i class="fa-regular fa-calendar mr-1"></i> เริ่มต้นเมื่อ: ${dateStr}
                </p>
                <p class="text-sm text-gray-500 mb-4">
                    <i class="fa-regular fa-clock mr-1"></i> แก้ไขล่าสุด: ${updatedDateStr}
                </p>
            </div>
            
            <!-- Bottom Link -->
            <div class="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center cursor-pointer" onclick="window.location.href='/index.html?id=${project.id}'">
                <span class="text-chula font-medium text-sm flex items-center">
                    ดูรายละเอียด <i class="fa-solid fa-arrow-right ml-2 text-xs transform group-hover:translate-x-1 transition-transform"></i>
                </span>
            </div>

            <!-- Delete Button (Positioned top-right) -->
            <button class="delete-btn absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors z-10" title="ลบโครงการ">
                <i class="fa-solid fa-xmark text-lg"></i>
            </button>
        `;
        
        // --- ADD THE DELETE LOGIC HERE ---
        const deleteBtn = card.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', async (e) => {
            // Stop the click from opening the project!
            e.stopPropagation(); 
            
            const isConfirmed = confirm(`คุณต้องการลบโครงการ "${project.project_name || 'ไม่ได้ระบุชื่อโครงการ'}" ใช่หรือไม่?`);
            
            if (isConfirmed) {
                // Change the icon to a spinner while deleting
                deleteBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                
                // 1. Delete AND ask Supabase to return the deleted row data
                const { data, error } = await supabase
                    .from('projects')
                    .delete()
                    .eq('id', project.id)
                    .select(); // <-- This forces Supabase to tell us what it actually deleted

                // 2. Check for explicit errors
                if (error) {
                    console.error("Error deleting project:", error);
                    alert(`เกิดข้อผิดพลาดจากฐานข้อมูล (Database Error): ${error.message}`);
                    deleteBtn.innerHTML = '<i class="fa-solid fa-xmark text-lg"></i>'; 
                } 
                // 3. Check for silent failures (RLS blocked it!)
                else if (data && data.length === 0) {
                    alert("ลบไม่สำเร็จ: ระบบความปลอดภัยของ Supabase บล็อกการลบ");
                    deleteBtn.innerHTML = '<i class="fa-solid fa-xmark text-lg"></i>'; 
                } 
                // 4. Success!
                else {
                    fetchProjects(email);
                }
            }
        });

        container.appendChild(card);
    });
}