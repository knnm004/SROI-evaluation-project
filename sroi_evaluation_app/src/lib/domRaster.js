/**
 * Photograph a DOM element with the browser's OWN layout and text engine (no library).
 *
 * Why not html2canvas: it draws text itself, and with this Thai font it puts the text a little
 * below where the browser puts it (so bullets, badges and icons no longer line up with their
 * words), and it does not honour `object-fit: cover`, so photos came out shrunk and soft.
 *
 * How this works: the element is cloned with every computed style written inline, wrapped in an
 * SVG <foreignObject>, and the SVG is drawn onto a canvas. The browser lays the clone out exactly
 * as it laid out the original, so what is on the canvas is what is on the page. An SVG used as
 * an image cannot load anything from the network, so the fonts and pictures are embedded as
 * data: URLs first.
 *
 * rasteriseElement() resolves to a canvas, or throws if the browser could not do it (the
 * caller falls back to html2canvas).
 */

const FONT_FILES = [
    { url: '/fonts/ChulaCharasNewReg.ttf',      weight: 400, style: 'normal' },
    { url: '/fonts/ChulaCharasNewBold.ttf',     weight: 700, style: 'normal' },
    { url: '/fonts/ChulaCharasNewIta.ttf',      weight: 400, style: 'italic' },
    { url: '/fonts/ChulaCharasNewBoldIta.ttf',  weight: 700, style: 'italic' }
];

let fontCSSPromise = null;

const blobToDataURL = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
});

async function urlToDataURL(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not read ${url}`);
    return blobToDataURL(await response.blob());
}

/** The @font-face rules with the font files inlined (fetched once, then reused for every page). */
function embeddedFontCSS() {
    if (!fontCSSPromise) {
        fontCSSPromise = Promise.all(FONT_FILES.map(async font => {
            const data = await urlToDataURL(font.url);
            return `@font-face{font-family:'ChulaCharasNew';src:url(${data}) format('truetype');font-weight:${font.weight};font-style:${font.style};}`;
        })).then(rules => rules.join('')).catch(error => {
            fontCSSPromise = null; // try again next time
            throw error;
        });
    }
    return fontCSSPromise;
}

/** Copy every computed style of `source` (and its descendants) onto the matching node of `clone`. */
function inlineStyles(source, clone) {
    const computed = getComputedStyle(source);
    let text = '';
    for (let index = 0; index < computed.length; index += 1) {
        const name = computed[index];
        text += `${name}:${computed.getPropertyValue(name)};`;
    }
    clone.setAttribute('style', text);

    for (let index = 0; index < source.children.length; index += 1) {
        inlineStyles(source.children[index], clone.children[index]);
    }
}

/** Make every <img> self-contained, so the SVG needs nothing from the network. */
async function embedImages(clone) {
    await Promise.all(Array.from(clone.querySelectorAll('img')).map(async img => {
        const src = img.getAttribute('src') || '';
        if (!src || src.startsWith('data:')) return;
        img.setAttribute('src', await urlToDataURL(src));
    }));
}

/**
 * Inline <svg> pictures (the SDG ring, the fallback map) are turned into ordinary <img> data URLs:
 * Safari's engine places an <svg> inside a foreignObject in the wrong spot.
 */
function svgsToImages(source, clone) {
    const sourceSvgs = source.querySelectorAll('svg');
    const cloneSvgs = clone.querySelectorAll('svg');
    sourceSvgs.forEach((svg, index) => {
        const target = cloneSvgs[index];
        if (!target || !target.parentNode) return;
        const box = svg.getBoundingClientRect();
        const copy = svg.cloneNode(true);
        copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        copy.setAttribute('width', String(box.width));
        copy.setAttribute('height', String(box.height));
        const image = document.createElement('img');
        image.setAttribute('src', `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`);
        // Keep the svg's own computed layout (its place in a grid or flex parent), then pin the size.
        image.setAttribute('style', `${target.getAttribute('style') || ''};display:block;width:${box.width}px;height:${box.height}px;`);
        target.parentNode.replaceChild(image, target);
    });
}

const loadImage = src => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The page could not be drawn'));
    image.src = src;
});

/**
 * @param {HTMLElement} element  attached to the document and fully laid out
 * @param {{width:number, height:number, pixelRatio?:number}} options  size in CSS px
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function rasteriseElement(element, { width, height, pixelRatio = 2 }) {
    const [fontCSS] = await Promise.all([embeddedFontCSS(), document.fonts?.ready]);

    const clone = element.cloneNode(true);
    inlineStyles(element, clone);
    svgsToImages(element, clone);
    clone.style.transform = 'none';
    clone.style.margin = '0';
    clone.style.position = 'static';
    await embedImages(clone);
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

    const markup = new XMLSerializer().serializeToString(clone);
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width * pixelRatio}" height="${height * pixelRatio}" viewBox="0 0 ${width} ${height}">` +
        `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
        `<style>${fontCSS}</style>${markup}</foreignObject></svg>`;

    const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    const canvas = document.createElement('canvas');
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    const context = canvas.getContext('2d');

    // Safari paints the pictures inside the SVG only on a later pass: draw once to make it decode them,
    // then load and draw again. (Harmless, and quick, in other browsers.)
    context.drawImage(await loadImage(source), 0, 0, canvas.width, canvas.height);
    await new Promise(resolve => window.setTimeout(resolve, 150));
    const image = await loadImage(source);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    // A browser that taints the canvas (some versions of Safari) would fail here, not later.
    canvas.toDataURL('image/png', 0.01);
    return canvas;
}
