/**
 * The landing page's photo wall: several columns of pictures drifting in opposite
 * directions on a slight tilt, so a lot of photos are in view at once.
 *
 * SOURCE OF TRUTH is the list of <img data-gallery-item> inside #landing-gallery-source
 * in index.html -- to add a photo, add an <img> line there; nothing here changes.
 * Optional per-image attribute: data-fit="contain" for artwork that must not be cropped
 * (e.g. a diagram); everything else is cropped to fill its tile.
 *
 * The wall is rebuilt from that list (as fresh elements, never by moving the originals)
 * whenever the column count changes with screen width, so resizing is always safe.
 */

const SOURCE_ID = 'landing-gallery-source';
const WALL_ID = 'landing-photo-wall';

/** Tile shapes cycle through these so the wall has a masonry feel rather than a grid. */
const TILE_RATIOS = ['4 / 5', '1 / 1', '5 / 6', '3 / 4'];

/** Rough px per second of drift, and per-column speed/phase variation. */
const DRIFT_PX_PER_S = 26;
const COLUMN_SPEED = [1, 0.82, 1.18, 0.92];
const COLUMN_PHASE = [0, 0.37, 0.71, 0.18];
const AVG_TILE_PX = 230;

/** Every column needs at least this many tiles per loop so the drift never shows a gap. */
const MIN_TILES_PER_LOOP = 6;

const prefersReducedMotion = () =>
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let cleanup = null;

/** Idempotent: showView('view-landing') can run more than once per page load. */
export function initLandingPhotoWall() {
    const wall = document.getElementById(WALL_ID);
    const source = document.getElementById(SOURCE_ID);
    if (!wall || !source || wall.dataset.ready) return;

    const photos = Array.from(source.querySelectorAll('[data-gallery-item]')).map(img => ({
        src: img.getAttribute('src'),
        alt: img.getAttribute('alt') || '',
        contain: img.dataset.fit === 'contain'
    }));
    if (!photos.length) return;
    wall.dataset.ready = 'true';

    const host = wall.parentElement; // the clipped viewport the wall tilts inside
    let columnCount = 0;

    const desiredColumns = () => (host.clientWidth >= 480 ? 3 : 2);

    const build = () => {
        const cols = desiredColumns();
        if (cols === columnCount) return;
        columnCount = cols;
        wall.replaceChildren();
        wall.style.setProperty('--wall-cols', String(cols));

        // Diagonal shift (i + floor(i/cols)) so a short list that repeats the same few
        // photos does not put the same photo down an entire column.
        const perColumn = Array.from({ length: cols }, () => []);
        photos.forEach((photo, index) => {
            perColumn[(index + Math.floor(index / cols)) % cols].push(index);
        });

        let tileCounter = 0;
        perColumn.forEach((indexes, colIndex) => {
            if (!indexes.length) return;
            const repeats = Math.max(1, Math.ceil(MIN_TILES_PER_LOOP / indexes.length));
            const loop = [];
            for (let r = 0; r < repeats; r += 1) loop.push(...indexes);

            const column = document.createElement('div');
            column.className = 'photo-col';
            const track = document.createElement('div');
            track.className = 'photo-track';
            if (colIndex % 2 === 1) track.classList.add('is-down');

            const duration = Math.min(140, Math.max(32,
                (loop.length * AVG_TILE_PX) / (DRIFT_PX_PER_S * COLUMN_SPEED[colIndex % COLUMN_SPEED.length])));
            track.style.setProperty('--drift-duration', `${duration.toFixed(1)}s`);
            track.style.setProperty('--drift-delay', `${(-duration * COLUMN_PHASE[colIndex % COLUMN_PHASE.length]).toFixed(1)}s`);

            // Two identical loops back to back: the track drifts exactly one loop's height.
            [false, true].forEach(isCopy => {
                loop.forEach(photoIndex => {
                    track.append(makeTile(photos[photoIndex], photoIndex, tileCounter, isCopy));
                    tileCounter += 1;
                });
            });

            column.append(track);
            wall.append(column);
        });
    };

    function makeTile(photo, photoIndex, counter, isCopy) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'photo-tile';
        tile.style.aspectRatio = photo.contain ? '1 / 1' : TILE_RATIOS[counter % TILE_RATIOS.length];
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
        img.draggable = false;
        if (photo.contain) img.className = 'is-contain';
        tile.append(img);

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
