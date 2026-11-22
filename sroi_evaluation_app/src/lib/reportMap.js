/**
 * The report's location map: a real OpenStreetMap picture of the place the person chose in step 1,
 * with their selection drawn on it -- the pin, the rectangle, or the outlines of the selected
 * sub-districts / districts. It is made the way the step-1 map is made (same OSM tiles), but onto a
 * canvas, so it can be placed in the page and photographed into the PDF like any other picture.
 *
 * buildLocationMap() resolves to a data: URL, or null when there is nothing to draw or the tiles
 * could not be loaded (offline, blocked); the report then shows its simple drawn map instead.
 * OSM tiles are served with CORS headers, so the canvas stays readable (not "tainted").
 *
 * Tile use is light: one picture of a few tiles, once per location (the caller caches it).
 */

const TILE = 256;
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const TILE_TIMEOUT_MS = 8000;
const ACCENT = '#9f2147';

/** Web-Mercator pixel position of a coordinate at a zoom level. */
function project(lat, lng, zoom) {
    const scale = TILE * 2 ** zoom;
    const sin = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
    return {
        x: ((lng + 180) / 360) * scale,
        y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
    };
}

const loadTile = (z, x, y) => new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), TILE_TIMEOUT_MS);
    image.onload = () => { window.clearTimeout(timer); resolve(image); };
    image.onerror = () => { window.clearTimeout(timer); resolve(null); };
    image.src = TILE_URL(z, x, y);
});

/** Outer rings of a GeoJSON Polygon / MultiPolygon, as arrays of [lng, lat]. */
function ringsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return geometry.coordinates;
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
    return [];
}

/**
 * @param {{type:'pin'|'area'|'boundary', lat?:string|number, lng?:string|number,
 *          bounds?:{north:number,south:number,east:number,west:number}|null,
 *          boundaries?:Array<object>}} location  `boundaries` are GeoJSON geometries
 * @returns {Promise<string|null>}
 */
export async function buildLocationMap(location, { width = 1000, height = 380 } = {}) {
    const lat = Number.parseFloat(location.lat);
    const lng = Number.parseFloat(location.lng);
    const bounds = location.bounds;
    const polygons = location.type === 'boundary' ? (location.boundaries ?? []).flatMap(ringsOf) : [];
    const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
    if (!hasPoint && !bounds) return null;

    // What has to fit in the picture: the chosen area if there is one, else a street-level view of the pin.
    const box = (location.type !== 'pin' && bounds) ? bounds : null;
    let zoom = 15;
    let centreLat = lat;
    let centreLng = lng;
    if (box) {
        centreLat = (box.north + box.south) / 2;
        centreLng = (box.east + box.west) / 2;
        for (zoom = 17; zoom > 3; zoom -= 1) {
            const topLeft = project(box.north, box.west, zoom);
            const bottomRight = project(box.south, box.east, zoom);
            if ((bottomRight.x - topLeft.x) <= width * 0.8 && (bottomRight.y - topLeft.y) <= height * 0.8) break;
        }
    }
    if (!Number.isFinite(centreLat) || !Number.isFinite(centreLng)) return null;

    const centre = project(centreLat, centreLng, zoom);
    const originX = centre.x - width / 2;
    const originY = centre.y - height / 2;
    const toCanvas = (pointLat, pointLng) => {
        const p = project(pointLat, pointLng, zoom);
        return { x: p.x - originX, y: p.y - originY };
    };

    const tilesPerSide = 2 ** zoom;
    const jobs = [];
    for (let ty = Math.floor(originY / TILE); ty <= Math.floor((originY + height) / TILE); ty += 1) {
        for (let tx = Math.floor(originX / TILE); tx <= Math.floor((originX + width) / TILE); tx += 1) {
            if (ty < 0 || ty >= tilesPerSide) continue;
            const wrapped = ((tx % tilesPerSide) + tilesPerSide) % tilesPerSide;
            jobs.push(loadTile(zoom, wrapped, ty).then(image => ({ image, x: tx * TILE - originX, y: ty * TILE - originY })));
        }
    }
    const tiles = await Promise.all(jobs);
    if (!tiles.some(tile => tile.image)) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#e8e4dc';
    context.fillRect(0, 0, width, height);
    tiles.forEach(tile => { if (tile.image) context.drawImage(tile.image, tile.x, tile.y, TILE, TILE); });

    // The person's selection, in the colours of the report.
    context.lineJoin = 'round';
    if (polygons.length) {
        context.beginPath();
        polygons.forEach(ring => ring.forEach(([ringLng, ringLat], index) => {
            const point = toCanvas(ringLat, ringLng);
            if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
            if (index === ring.length - 1) context.closePath();
        }));
        context.fillStyle = 'rgba(159, 33, 71, 0.2)';
        context.fill('evenodd');
        context.strokeStyle = ACCENT;
        context.lineWidth = 3;
        context.stroke();
    } else if (box) {
        const a = toCanvas(box.north, box.west);
        const b = toCanvas(box.south, box.east);
        context.fillStyle = 'rgba(159, 33, 71, 0.15)';
        context.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        context.strokeStyle = ACCENT;
        context.lineWidth = 3;
        context.setLineDash([10, 6]);
        context.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        context.setLineDash([]);
    }
    if (location.type === 'pin' && hasPoint) {
        const pin = toCanvas(lat, lng);
        context.fillStyle = 'rgba(159, 33, 71, 0.18)';
        context.beginPath();
        context.arc(pin.x, pin.y, 26, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = ACCENT;
        context.beginPath();
        context.moveTo(pin.x, pin.y);
        context.bezierCurveTo(pin.x - 24, pin.y - 26, pin.x - 18, pin.y - 56, pin.x, pin.y - 56);
        context.bezierCurveTo(pin.x + 18, pin.y - 56, pin.x + 24, pin.y - 26, pin.x, pin.y);
        context.fill();
        context.fillStyle = '#ffffff';
        context.beginPath();
        context.arc(pin.x, pin.y - 36, 7, 0, Math.PI * 2);
        context.fill();
    }

    // OpenStreetMap's licence requires this credit on every use of its map.
    const credit = '© OpenStreetMap contributors';
    context.font = '12px sans-serif';
    const creditWidth = context.measureText(credit).width + 10;
    context.fillStyle = 'rgba(255, 255, 255, 0.85)';
    context.fillRect(width - creditWidth, height - 20, creditWidth, 20);
    context.fillStyle = '#374151';
    context.fillText(credit, width - creditWidth + 5, height - 6);

    return canvas.toDataURL('image/jpeg', 0.92);
}
