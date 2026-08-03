// about.html is a static informational page -- no auth, no Supabase, no wizard
// state -- so it gets its own tiny script rather than importing all of app.js.
import './style.css';

window.showIntroLang = function showIntroLang(lang) {
    document.querySelectorAll('[data-intro-lang]').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.introLang !== lang);
    });
    document.querySelectorAll('[data-intro-tab]').forEach(tab => {
        const active = tab.dataset.introTab === lang;
        tab.classList.toggle('framework-tab-active', active);
        tab.classList.toggle('framework-tab-idle', !active);
    });
};
