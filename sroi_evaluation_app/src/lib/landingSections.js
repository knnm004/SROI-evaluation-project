/**
 * Scroll behaviour for the landing page's two "scenes" (hero, then project overview).
 *
 * Everything here is conditional on there being a second scene at all: the overview is
 * hidden until get_public_project_stats() succeeds (src/lib/landingStats.js), and a
 * "scroll down for more" cue or side dots pointing at nothing would be worse than none.
 * landingStats announces itself with a `landing-stats-ready` event; until then the page
 * is just the hero, with no snapping and no cue.
 */

const SCENE_IDS = ['landing-hero', 'landing-stats'];

const prefersReducedMotion = () =>
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Idempotent: showView('view-landing') can run more than once per page load. */
export function initLandingSections() {
    const nav = document.getElementById('landing-section-nav');
    const cue = document.getElementById('landing-scroll-cue');
    const stats = document.getElementById('landing-stats');
    if (!nav || !cue || !stats || nav.dataset.bound) return;
    nav.dataset.bound = 'true';

    const scrollToScene = id => document.getElementById(id)?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start'
    });

    nav.querySelectorAll('[data-scene]').forEach(button =>
        button.addEventListener('click', () => scrollToScene(button.dataset.scene)));
    cue.addEventListener('click', () => scrollToScene('landing-stats'));

    const setActive = id => nav.querySelectorAll('[data-scene]').forEach(button =>
        button.classList.toggle('is-active', button.dataset.scene === id));

    // Whichever scene crosses the middle band of the viewport is "current".
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => { if (entry.isIntersecting) setActive(entry.target.id); });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    SCENE_IDS.forEach(id => {
        const scene = document.getElementById(id);
        if (scene) observer.observe(scene);
    });

    // The cue only makes sense while the first scene is what you're looking at.
    const syncCue = () => cue.classList.toggle('is-gone', window.scrollY > 80);
    window.addEventListener('scroll', syncCue, { passive: true });
    syncCue();

    const enable = () => {
        nav.classList.add('is-ready');
        cue.classList.add('is-ready');
        document.documentElement.classList.add('landing-snap');
    };
    if (!stats.classList.contains('hidden')) enable();
    else document.addEventListener('landing-stats-ready', enable, { once: true });
}
