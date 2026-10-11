/**
 * The landing page's photo wall: an Instagram-profile-style feed that moves by itself. Pictures keep their own
 * proportions (tall, wide, square), are packed into 2-3 columns, and the person scrolls the
 * feed vertically with the wheel / finger. Clicking a photo opens it large.
 *
 * SOURCE OF TRUTH is the list of <img data-gallery-item> inside #landing-gallery-source
 * in index.html -- to add a photo, add an <img> line there; nothing here changes. Give it
 * width/height attributes (its real pixel size) so the tile reserves the right shape before
 * the picture loads. Optional: data-fit="contain" for artwork that must not be cropped
 * (e.g. a diagram).
 *
 * The wall is rebuilt from that list (as fresh elements, never by moving the originals)
 * whenever the column count changes with screen width, so resizing is always safe.
 */

const SOURCE_ID = 'landing-gallery-source';
const WALL_ID = 'landing-photo-wall';

/** Extreme shapes (3-photo strips) are limited so no tile is a sliver; the lightbox shows all. */
const MIN_RATIO = 0.56; // width / height
const MAX_RATIO = 1.8;
const FALLBACK_RATIO = 1;

/** Px per second of upward drift, and each column's starting offset (fraction of a loop). */
const DRIFT_PX_PER_S = 28;
const COLUMN_PHASE = [0, 0.43, 0.21];

let cleanup = null;

/** Idempotent: showView('view-landing') can run more than once per page load. */
export function initLandingPhotoWall() {
    const wall = document.getElementById(WALL_ID);
    const source = document.getElementById(SOURCE_ID);
    if (!wall || !source || wall.dataset.ready) return;

    const photos = Array.from(source.querySelectorAll('[data-gallery-item]')).map(img => {
        const width = Number(img.getAttribute('width'));
        const height = Number(img.getAttribute('height'));
        const natural = width > 0 && height > 0 ? width / height : FALLBACK_RATIO;
        return {
            src: img.getAttribute('src'),
            alt: img.getAttribute('alt') || '',
            contain: img.dataset.fit === 'contain',
            ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, natural))
        };
    });
    if (!photos.length) return;
    wall.dataset.ready = 'true';

    const host = wall.parentElement; // the clipped viewport
    let columnCount = 0;

    const desiredColumns = () => (host.clientWidth >= 480 ? 3 : 2);

    const build = () => {
        const cols = desiredColumns();
        if (cols === columnCount) return;
        columnCount = cols;
        wall.replaceChildren();

        const columns = Array.from({ length: cols }, () => {
            const column = document.createElement('div');
            column.className = 'photo-col';
            const track = document.createElement('div');
            track.className = 'photo-track';
            column.append(track);
            wall.append(column);
            return { track, indexes: [], height: 0 };
        });

        // Each photo goes to the currently shortest column (heights in column-widths, so
        // 1/ratio), which keeps the columns level whatever mix of shapes comes in.
        photos.forEach((photo, index) => {
            const target = columns.reduce((best, column) => (column.height < best.height ? column : best));
            target.indexes.push(index);
            target.height += 1 / photo.ratio;
        });

        const columnWidth = host.clientWidth / cols;
        columns.forEach((column, colIndex) => {
            // The column's photos twice, back to back: the track drifts up exactly one
            // copy's height and restarts, which is seamless because spacing is margin on
            // each tile (not flex gap), so half the track is exactly one copy.
            [false, true].forEach(isCopy => {
                column.indexes.forEach(photoIndex =>
                    column.track.append(makeTile(photos[photoIndex], photoIndex, isCopy)));
            });
            // Same speed in px/s whatever the column's length, started at different offsets
            // so the columns do not move in lockstep.
            const loopPx = column.height * columnWidth;
            const duration = Math.min(220, Math.max(30, loopPx / DRIFT_PX_PER_S));
            column.track.style.setProperty('--drift-duration', `${duration.toFixed(1)}s`);
            column.track.style.setProperty('--drift-delay', `${(-duration * COLUMN_PHASE[colIndex % COLUMN_PHASE.length]).toFixed(1)}s`);
        });
    };

    function makeTile(photo, photoIndex, isCopy) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'photo-tile';
        tile.style.aspectRatio = String(photo.contain ? 1 : photo.ratio);
        if (isCopy) {
            tile.tabIndex = -1;
            tile.setAttribute('aria-hidden', 'true');
        } else {
            tile.setAttribute('aria-label', photo.alt ? `ดูภาพใหญ่: ${photo.alt}` : 'ดูภาพใหญ่');
        }

        const img = document.createElement('img');
        img.src = photo.src;
        img.alt = isCopy ? '' : photo.alt;
        img.decoding = 'async';
        // The first photos load at once; the rest as the drift brings them near.
        img.loading = photoIndex < 6 ? 'eager' : 'lazy';
        img.draggable = false;
        if (photo.contain) img.className = 'is-contain';
        tile.append(img);

        // Caption revealed on hover / keyboard focus (the drift pauses on hover, so it is
        // readable). Decorative on the repeated copy.
        if (photo.alt && !isCopy) {
            const caption = document.createElement('span');
            caption.className = 'photo-caption';
            caption.textContent = photo.alt;
            tile.append(caption);
        }

        tile.addEventListener('click', () => openLightbox(photos, photoIndex));
        return tile;
    }

    build();

    let resizeTimer = 0;
    const onResize = () => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(build, 150);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(host);
    cleanup = () => observer.disconnect();
}

// ---- lightbox ---------------------------------------------------------------------------

let lightbox = null;

function ensureLightbox() {
    if (lightbox) return lightbox;

    const dialog = document.createElement('dialog');
    dialog.className = 'photo-lightbox';
    dialog.setAttribute('aria-label', 'ภาพกิจกรรม');

    const img = document.createElement('img');
    img.className = 'photo-lightbox-img';
    img.alt = '';

    const makeButton = (className, label, iconClass) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `photo-lightbox-btn ${className}`;
        button.setAttribute('aria-label', label);
        const icon = document.createElement('i');
        icon.className = iconClass;
        button.append(icon);
        return button;
    };
    const closeBtn = makeButton('is-close', 'ปิด', 'fa-solid fa-xmark');
    const prevBtn = makeButton('is-prev', 'ภาพก่อนหน้า', 'fa-solid fa-chevron-left');
    const nextBtn = makeButton('is-next', 'ภาพถัดไป', 'fa-solid fa-chevron-right');
    const counter = document.createElement('span');
    counter.className = 'photo-lightbox-count';

    dialog.append(img, closeBtn, prevBtn, nextBtn, counter);
    document.body.append(dialog);

    const state = { photos: [], index: 0 };
    const show = index => {
        const total = state.photos.length;
        state.index = (index + total) % total;
        const photo = state.photos[state.index];
        img.src = photo.src;
        img.alt = photo.alt;
        counter.textContent = `${state.index + 1} / ${total}`;
        prevBtn.hidden = nextBtn.hidden = total < 2;
    };

    closeBtn.addEventListener('click', () => dialog.close());
    prevBtn.addEventListener('click', () => show(state.index - 1));
    nextBtn.addEventListener('click', () => show(state.index + 1));
    // A click on the dark backdrop (the dialog element itself, not its children) closes it.
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') show(state.index - 1);
        if (event.key === 'ArrowRight') show(state.index + 1);
    });

    lightbox = { dialog, state, show };
    return lightbox;
}

function openLightbox(photos, index) {
    const box = ensureLightbox();
    box.state.photos = photos;
    box.show(index);
    if (!box.dialog.open) box.dialog.showModal();
}

/** For tests / hot reload. */
export function disposeLandingPhotoWall() {
    cleanup?.();
    cleanup = null;
}
