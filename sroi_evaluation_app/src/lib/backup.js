/**
 * Shared helpers for the admin "Backup" feature (src/admin.js).
 *
 * Two independent exports use this:
 *   - backupExcel.js  the client-side Excel export ("For Admin")
 *   - backupSql.js    the Edge Function call for the SQL dump ("For Dev")
 */

/** cu_triple_s_backup_MMDDYYYY_<ms>.<ext> -- <ms> makes repeated backups in the same day unique. */
export function backupFilename(extension) {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `cu_triple_s_backup_${mm}${dd}${yyyy}_${Date.now()}.${extension}`;
}

export function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

/** A base64 data URI is never useful in a spreadsheet cell and can be megabytes wide. */
export function isImageData(value) {
    return typeof value === 'string' && value.startsWith('data:image');
}

/**
 * Flatten one project's assessment_data into dot-notation scalar fields, dynamically
 * -- whatever keys are actually present, at whatever nesting. The caller takes the
 * union of `fields` keys across every project to build the sheet's columns, so a new
 * wizard field appears automatically with no code change here.
 *
 * Arrays of primitives (e.g. selectedSDGs) are joined into one cell with ", ".
 * Arrays of objects (e.g. sroiRows, activityImages) are pulled out into `arrayTables`
 * instead of flattened into the main row, keyed by the dot-path they were found at --
 * the caller puts each on its own sheet, cross-referenced by project id.
 *
 * Anything that looks like base64 image data becomes a "Yes"/"No" flag in `fields` /
 * `arrayTables` (a spreadsheet cell is never a sane place for it), but the raw data is
 * ALSO kept in `images` / `arrayImages` -- keyed by the exact column name the flag
 * landed under -- so a caller that wants to actually embed the photo (see
 * backupExcel.js) still has it, without every caller having to deal with raw base64.
 *
 * @returns {{
 *   fields: Record<string, string|number>,
 *   arrayTables: Record<string, object[]>,
 *   images: Record<string, string>,
 *   arrayImages: Record<string, Array<string|null>>
 * }}
 */
export function flattenAssessmentData(data) {
    const fields = {};
    const arrayTables = {};
    const images = {};
    const arrayImages = {};

    function flattenArrayItem(item) {
        if (!item || typeof item !== 'object') return { row: { value: item ?? '' }, image: null };
        const row = {};
        let image = null;
        Object.entries(item).forEach(([key, nested]) => {
            if (key === 'src' || isImageData(nested)) {
                if (isImageData(nested)) image = nested;
                row[key === 'src' ? 'Photo attached' : key] = nested ? 'Yes' : 'No';
            } else if (Array.isArray(nested)) {
                row[key] = nested.join(', ');
            } else if (nested && typeof nested === 'object') {
                row[key] = JSON.stringify(nested);
            } else {
                row[key] = nested ?? '';
            }
        });
        return { row, image };
    }

    function walk(value, path) {
        // uploadedImage is either a base64 data URI or null -- never a real column value.
        if (path === 'uploadedImage') {
            fields['Photo attached'] = value ? 'Yes' : 'No';
            if (isImageData(value)) images['Photo attached'] = value;
            return;
        }
        // sroiCalculations is a derived cache of sroiRows (see assessmentSnapshot.js);
        // the raw rows get their own sheet below, so only the headline numbers are
        // worth a column here.
        if (path === 'sroiCalculations') {
            fields['SROI Ratio'] = value?.sroiRatio ?? '';
            fields['Net Present Value'] = value?.netPresentValue ?? '';
            return;
        }
        if (value === null || value === undefined) {
            fields[path] = '';
            return;
        }
        if (isImageData(value)) {
            fields[path] = 'Yes';
            images[path] = value;
            return;
        }
        if (Array.isArray(value)) {
            const hasObjects = value.some(item => item && typeof item === 'object' && !Array.isArray(item));
            if (hasObjects) {
                const built = value.map(flattenArrayItem);
                arrayTables[path] = built.map(entry => entry.row);
                arrayImages[path] = built.map(entry => entry.image);
            } else {
                fields[path] = value.join(', ');
            }
            return;
        }
        if (typeof value === 'object') {
            Object.entries(value).forEach(([key, nested]) => walk(nested, path ? `${path}.${key}` : key));
            return;
        }
        fields[path] = value;
    }

    Object.entries(data ?? {}).forEach(([key, value]) => walk(value, key));

    return { fields, arrayTables, images, arrayImages };
}
