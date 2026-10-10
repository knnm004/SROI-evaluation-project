/**
 * The "project overview" section of the public landing page.
 *
 * Editorial rather than chart-like: a sentence that carries the live number, two
 * streaming-service-style "rails" (category cards, SDG poster tiles) you can drag or
 * arrow through, and a clickable dot map of the 17 SDGs. Filtering by SDG and/or
 * category re-counts everything -- numbers tween, bars slide, the sentence rewrites.
 *
 * DATA: the landing page is viewed before sign-in and RLS blocks anonymous reads of
 * `projects`, so this only ever sees what get_public_project_stats() returns -- counts,
 * never a project (supabase/migrations/0009_public_project_stats.sql). If that
 * function has not been applied yet, the section simply stays hidden.
 *
 * Filter semantics (single SDG x single category, both optional):
 *   none             -> total
 *   sdg              -> by_sdg[sdg]
 *   category         -> by_category[category]
 *   sdg + category   -> matrix[category][sdg]
 */

import { supabase } from './supabaseClient.js';

/** Official UN SDG colours. */
const SDG_COLORS = {
    1: '#E5243B', 2: '#DDA63A', 3: '#4C9F38', 4: '#C5192D', 5: '#FF3A21', 6: '#26BDE2',
    7: '#FCC30B', 8: '#A21942', 9: '#FD6925', 10: '#DD1367', 11: '#FD9D24', 12: '#BF8B2E',
    13: '#3F7E44', 14: '#0A97D9', 15: '#56C02B', 16: '#00689D', 17: '#19486A'
};

const SECTION_ID = 'landing-stats';
const FALLBACK_TONE = '#DA5F8E';

const prefersReducedMotion = () =>
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export async function fetchPublicProjectStats() {
    const { data, error } = await supabase.rpc('get_public_project_stats');
    if (error) throw error;
    return normaliseStats(data);
}

/** Never trust the shape: a missing key must read as 0, not crash the landing page. */
export function normaliseStats(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const numberMap = value => Object.fromEntries(
        Object.entries(value && typeof value === 'object' ? value : {})
            .map(([key, n]) => [key, Number(n) || 0])
    );
    const matrix = {};
    Object.entries(data.matrix && typeof data.matrix === 'object' ? data.matrix : {})
        .forEach(([category, counts]) => { matrix[category] = numberMap(counts); });

    return {
        total: Number(data.total) || 0,
        uncategorized: Number(data.uncategorized) || 0,
        byCategory: numberMap(data.by_category),
        bySdg: numberMap(data.by_sdg),
        matrix
    };
}

/**
 * Fetch the stats and mount the section. Safe to call more than once -- later calls are
 * no-ops while a mount is live.
 *
 * @param {{sdgs: Array<{id:number,title:string}>,
 *          categories: Array<{title:string, icon?:string, tone?:string}>}} options
 */
export async function initLandingStats(options) {
    const section = document.getElementById(SECTION_ID);
    if (!section || section.dataset.mounted) return;

    try {
        mountLandingStats(await fetchPublicProjectStats(), options);
    } catch (error) {
        // Most likely 0009 has not been applied -- not worth surfacing to a visitor.
        console.warn('Landing stats unavailable:', error?.message ?? error);
    }
}

// ---- small DOM + animation helpers --------------------------------------------------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const fmt = n => Math.round(n).toLocaleString('th-TH');

const tweens = new WeakMap();
/** Count a number element up/down to `target`, from whatever it currently shows. */
function tween(node, target) {
    const state = tweens.get(node) ?? { shown: 0, raf: 0 };
    tweens.set(node, state);
    cancelAnimationFrame(state.raf);

    const from = state.shown;
    if (prefersReducedMotion() || from === target) {
        state.shown = target;
        node.textContent = fmt(target);
        return;
    }
    const start = performance.now();
    const duration = 900;
    const step = now => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        state.shown = from + (target - from) * eased;
        node.textContent = fmt(state.shown);
        if (t < 1) state.raf = requestAnimationFrame(step);
        else state.shown = target;
    };
    state.raf = requestAnimationFrame(step);
}

/**
 * Turn a scroll strip into a rail: arrow buttons, edge fades that only show on the side
 * that can still scroll, and mouse drag-to-scroll (touch/trackpad already scroll natively).
 */
function enhanceRail(rail) {
    const wrap = rail.parentElement;
    wrap.querySelectorAll('.stats-rail-arrow').forEach(button => button.remove());

    [-1, 1].forEach(dir => {
        const button = el('button', `stats-rail-arrow stats-rail-arrow-${dir < 0 ? 'prev' : 'next'}`);
        button.type = 'button';
        button.setAttribute('aria-label', dir < 0 ? 'เลื่อนไปทางซ้าย' : 'เลื่อนไปทางขวา');
        const icon = el('i', `fa-solid fa-chevron-${dir < 0 ? 'left' : 'right'}`);
        button.append(icon);
        button.addEventListener('click', () => rail.scrollBy({
            left: dir * rail.clientWidth * 0.8,
            behavior: prefersReducedMotion() ? 'auto' : 'smooth'
        }));
        wrap.append(button);
    });

    const sync = () => {
        const max = rail.scrollWidth - rail.clientWidth;
        wrap.classList.toggle('can-scroll', max > 4);
        wrap.classList.toggle('at-start', rail.scrollLeft <= 4);
        wrap.classList.toggle('at-end', rail.scrollLeft >= max - 4);
    };
    rail.addEventListener('scroll', sync, { passive: true });
    new ResizeObserver(sync).observe(rail);
    sync();

    let down = false;
    let moved = false;
    let startX = 0;
    let startLeft = 0;
    rail.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        down = true;
        moved = false;
        startX = event.clientX;
        startLeft = rail.scrollLeft;
    });
    window.addEventListener('pointermove', event => {
        if (!down) return;
        const dx = event.clientX - startX;
        if (Math.abs(dx) > 5) {
            moved = true;
            rail.classList.add('is-dragging');
        }
        if (moved) rail.scrollLeft = startLeft - dx;
    });
    window.addEventListener('pointerup', () => {
        if (!down) return;
        down = false;
        rail.classList.remove('is-dragging');
    });
    // A drag must not also count as a click on whatever card the pointer ends over.
    rail.addEventListener('click', event => {
        if (!moved) return;
        event.stopPropagation();
        event.preventDefault();
        moved = false;
    }, true);
}

/** Render already-fetched stats. Split out from initLandingStats so it can be driven directly. */
export function mountLandingStats(stats, { sdgs, categories }) {
    const section = document.getElementById(SECTION_ID);
    const sentence = document.getElementById('landing-stats-sentence');
    const catRail = document.getElementById('landing-stats-categories');
    const sdgRail = document.getElementById('landing-stats-sdgs');
    const dotBox = document.getElementById('landing-stats-dots');
    const linkedEl = document.getElementById('landing-stats-linked');
    const noteEl = document.getElementById('landing-stats-note');
    const resetBtn = document.getElementById('landing-stats-reset');
    if (!section || !sentence || !catRail || !sdgRail || !dotBox || !linkedEl) return;

    // Re-mounting (tests, hot reload) starts from a clean slate.
    section.dataset.mounted = 'true';
    section.classList.remove('is-visible');
    [sentence, catRail, sdgRail, dotBox].forEach(node => node.replaceChildren());

    const state = { sdg: null, category: null, revealed: false };

    // ---- counts for the current filter --------------------------------------------
    const sdgCount = id => state.category
        ? stats.matrix[state.category]?.[id] ?? 0
        : stats.bySdg[id] ?? 0;

    const categoryCount = title => state.sdg
        ? stats.matrix[title]?.[state.sdg] ?? 0
        : stats.byCategory[title] ?? 0;

    const headlineCount = () => {
        if (state.sdg && state.category) return stats.matrix[state.category]?.[state.sdg] ?? 0;
        if (state.sdg) return stats.bySdg[state.sdg] ?? 0;
        if (state.category) return stats.byCategory[state.category] ?? 0;
        return stats.total;
    };

    // ---- the sentence: [lead] [chips] [mid] (N) [tail] ------------------------------
    const lead = el('span');
    const chips = el('span', 'stats-chips');
    const mid = el('span');
    const pill = el('span', 'stats-inline-pill');
    const totalEl = el('span');
    totalEl.id = 'landing-stats-total';
    totalEl.dataset.testid = 'landing-stats-total';
    pill.append(totalEl);
    const tail = el('span');
    sentence.append(lead, ' ', chips, ' ', mid, ' ', pill, ' ', tail);

    // ---- category rail: biggest first (fixed at mount so cards don't jump on filter) -
    const ordered = categories
        .map((category, index) => ({ category, index }))
        .sort((a, b) =>
            (stats.byCategory[b.category.title] ?? 0) - (stats.byCategory[a.category.title] ?? 0)
            || a.index - b.index)
        .map(item => item.category);

    const catCards = ordered.map((category, index) => {
        const card = el('button', 'rail-card cat-card');
        card.type = 'button';
        card.style.setProperty('--tone', category.tone || FALLBACK_TONE);
        card.style.setProperty('--i', String(index));

        const iconTile = el('span', 'cat-icon');
        iconTile.append(el('i', `fa-solid ${category.icon || 'fa-folder-open'}`));

        const body = el('span', 'cat-body');
        const figure = el('span', 'cat-figure');
        const num = el('b', 'cat-num', '0');
        figure.append(num, el('span', 'cat-unit', 'โครงการ'));
        body.append(el('span', 'cat-name', category.title), figure);

        const bar = el('span', 'rail-bar');
        const fill = el('span', 'rail-bar-fill');
        bar.append(fill);

        card.append(iconTile, body, bar);
        card.addEventListener('click', () => {
            state.category = state.category === category.title ? null : category.title;
            update();
        });
        catRail.append(card);
        return { category, card, num, fill };
    });

    // ---- SDG rail: poster tiles -------------------------------------------------------
    const sdgCards = sdgs.map((sdg, index) => {
        const card = el('button', 'rail-card stat-sdg-card');
        card.type = 'button';
        card.style.setProperty('--c', SDG_COLORS[sdg.id] ?? FALLBACK_TONE);
        card.style.setProperty('--i', String(index));

        const foot = el('span', 'sdg-foot');
        const num = el('b', 'sdg-count', '0');
        foot.append(num, el('span', 'sdg-unit', 'โครงการ'));

        const bar = el('span', 'rail-bar');
        const fill = el('span', 'rail-bar-fill');
        bar.append(fill);

        card.append(el('span', 'sdg-num', String(sdg.id)), el('span', 'sdg-title', sdg.title), foot, bar);
        card.addEventListener('click', () => {
            state.sdg = state.sdg === sdg.id ? null : sdg.id;
            update();
        });
        sdgRail.append(card);
        return { sdg, card, num, fill };
    });

    // ---- dot map (the compact SDG selector) ---------------------------------------------
    const dots = sdgs.map(sdg => {
        const dot = el('button', 'stats-dot');
        dot.type = 'button';
        dot.style.setProperty('--c', SDG_COLORS[sdg.id] ?? FALLBACK_TONE);
        dot.addEventListener('click', () => {
            state.sdg = state.sdg === sdg.id ? null : sdg.id;
            update();
        });
        dotBox.append(dot);
        return { sdg, dot };
    });

    resetBtn?.addEventListener('click', () => {
        state.sdg = null;
        state.category = null;
        update();
    });

    // ---- paint everything for the current state ---------------------------------------
    function update() {
        const shown = n => (state.revealed ? n : 0);

        const sdgCounts = sdgCards.map(({ sdg }) => sdgCount(sdg.id));
        const sdgMax = Math.max(1, ...sdgCounts);
        sdgCards.forEach(({ sdg, card, num, fill }, index) => {
            const n = sdgCounts[index];
            const selected = state.sdg === sdg.id;
            card.classList.toggle('is-selected', selected);
            card.classList.toggle('is-dim', state.sdg !== null && !selected);
            card.classList.toggle('is-empty', n === 0);
            card.setAttribute('aria-pressed', String(selected));
            card.setAttribute('aria-label', `SDG ${sdg.id} ${sdg.title}: ${fmt(n)} โครงการ`);
            fill.style.width = `${shown(n) / sdgMax * 100}%`;
            tween(num, shown(n));
        });

        const catCounts = catCards.map(({ category }) => categoryCount(category.title));
        const catMax = Math.max(1, ...catCounts);
        catCards.forEach(({ category, card, num, fill }, index) => {
            const n = catCounts[index];
            const selected = state.category === category.title;
            card.classList.toggle('is-selected', selected);
            card.classList.toggle('is-dim', state.category !== null && !selected);
            card.classList.toggle('is-empty', n === 0);
            card.setAttribute('aria-pressed', String(selected));
            card.setAttribute('aria-label', `${category.title}: ${fmt(n)} โครงการ`);
            fill.style.width = `${shown(n) / catMax * 100}%`;
            tween(num, shown(n));
        });

        dots.forEach(({ sdg, dot }, index) => {
            const selected = state.sdg === sdg.id;
            dot.classList.toggle('is-selected', selected);
            dot.classList.toggle('is-dim', state.sdg !== null && !selected);
            dot.classList.toggle('is-empty', sdgCounts[index] === 0);
            dot.setAttribute('aria-pressed', String(selected));
            dot.setAttribute('aria-label', `SDG ${sdg.id} ${sdg.title}`);
            dot.title = `SDG ${sdg.id} · ${sdg.title} — ${fmt(sdgCounts[index])} โครงการ`;
        });

        // The sentence rewrites itself around the active filters.
        const filtered = state.category !== null || state.sdg !== null;
        lead.textContent = filtered ? 'ในระบบมีโครงการ' : 'ปัจจุบันในระบบมีโครงการที่ลงทะเบียนแล้วทั้งหมด';
        mid.textContent = filtered ? 'อยู่ทั้งหมด' : '';
        tail.textContent = filtered
            ? 'โครงการ'
            : 'โครงการ ที่กำลังร่วมกันขับเคลื่อนและวัดผลลัพธ์สู่สังคมจริง โดยแบ่งตามหมวดหมู่สำคัญ ได้แก่';

        chips.replaceChildren();
        const sdgInfo = sdgs.find(item => item.id === state.sdg);
        if (state.category) {
            const meta = categories.find(item => item.title === state.category);
            const chip = el('button', 'stats-chip', `หมวดหมู่ ${state.category}`);
            chip.type = 'button';
            chip.style.setProperty('--tone', meta?.tone || FALLBACK_TONE);
            chip.append(el('i', 'fa-solid fa-xmark'));
            chip.setAttribute('aria-label', `ล้างตัวกรองหมวดหมู่ ${state.category}`);
            chip.addEventListener('click', () => { state.category = null; update(); });
            chips.append(chip);
        }
        if (sdgInfo) {
            const chip = el('button', 'stats-chip', `เกี่ยวข้องกับ SDG ${sdgInfo.id} · ${sdgInfo.title}`);
            chip.type = 'button';
            chip.style.setProperty('--tone', SDG_COLORS[sdgInfo.id] ?? FALLBACK_TONE);
            chip.append(el('i', 'fa-solid fa-xmark'));
            chip.setAttribute('aria-label', `ล้างตัวกรอง SDG ${sdgInfo.id}`);
            chip.addEventListener('click', () => { state.sdg = null; update(); });
            chips.append(chip);
        }

        tween(totalEl, shown(headlineCount()));
        // "k of 17 SDGs": how many goals the projects in view actually touch.
        tween(linkedEl, shown(sdgCounts.filter(n => n > 0).length));

        resetBtn?.classList.toggle('hidden', !filtered);
        if (noteEl) {
            noteEl.textContent = stats.uncategorized
                ? `หนึ่งโครงการเลือกได้หลาย SDGs · ยังไม่ระบุหมวดหมู่ ${fmt(stats.uncategorized)} โครงการ`
                : 'หนึ่งโครงการเลือกได้หลาย SDGs';
        }
    }

    // ---- reveal ------------------------------------------------------------------------
    section.classList.remove('hidden');
    // Tells landingSections.js there is a second scene now (scroll cue, side dots, snapping).
    document.dispatchEvent(new CustomEvent('landing-stats-ready'));
    enhanceRail(catRail);
    enhanceRail(sdgRail);
    update(); // zeros + empty bars until the section scrolls into view

    const reveal = () => {
        state.revealed = true;
        section.classList.add('is-visible'); // cards fly in (CSS), numbers count up (update)
        update();
    };
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
        reveal();
        return;
    }
    const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        reveal();
    }, { threshold: 0.2 });
    observer.observe(section);
}
