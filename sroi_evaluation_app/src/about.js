// about.html is a static informational page -- no auth, no Supabase, no wizard
// state -- so it gets its own tiny script rather than importing all of app.js.
import './style.css';

/**
 * Which language to show comes from the top bar's "เกี่ยวกับระบบ" menu, which links to
 * /about.html?lang=th or ?lang=en. Anything else (a bare /about.html, a typo) is Thai --
 * the site's primary language -- rather than an error.
 */
function languageFromUrl() {
    return new URLSearchParams(window.location.search).get('lang') === 'en' ? 'en' : 'th';
}

function applyIntroLang(lang) {
    document.documentElement.lang = lang;

    document.querySelectorAll('[data-intro-lang]').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.introLang !== lang);
    });

    // Mark the matching option in the top-bar menu so the reader can see which one they're on.
    document.querySelectorAll('[data-lang-option]').forEach(option => {
        const active = option.dataset.langOption === lang;
        option.classList.toggle('font-semibold', active);
        option.classList.toggle('text-chula-dark', active);
        option.classList.toggle('text-gray-700', !active);
        if (active) option.setAttribute('aria-current', 'true');
        else option.removeAttribute('aria-current');
    });
}

applyIntroLang(languageFromUrl());
