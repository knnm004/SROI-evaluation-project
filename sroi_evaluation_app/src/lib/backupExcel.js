/**
 * "For Admin" backup: a full Excel export of the `projects` table, built entirely
 * client-side from the existing anon-key Supabase client. No server round trip --
 * RLS already lets an admin read every row (see supabase/migrations/0005_rls_v2.sql),
 * so this is just a paginated SELECT * plus a client-side spreadsheet build.
 *
 * assessment_data columns are NOT a hardcoded list: flattenAssessmentData()
 * (src/lib/backup.js) dot-flattens each project's assessment_data, and this module
 * takes the UNION of every key seen across every fetched project. A new wizard field
 * shows up in the next backup with zero code changes here.
 *
 * Uses exceljs, not the more common "xlsx" (SheetJS) package: SheetJS's free/
 * community edition cannot write embedded images (that's a Pro-only feature), and
 * this sheet embeds the actual project/activity photos rather than a "Yes/No" flag.
 * Every photo is downscaled through a canvas before embedding (see
 * resizeImageForEmbedding) -- without that, a handful of multi-megabyte originals per
 * project could make the exported file enormous.
 */

import ExcelJS from 'exceljs';
import { supabase } from './supabaseClient.js';
import { backupFilename, triggerBlobDownload, flattenAssessmentData } from './backup.js';

/** Admin lists are unbounded -- mirrors admin.js's own PAGE_SIZE pagination. */
const PAGE_SIZE = 500;

/** Preferred left-to-right order for the base (non assessment_data) columns. */
const BASE_COLUMN_ORDER = [
    'id', 'project_name', 'user_email', 'owner_id',
    'created_at', 'updated_at', 'updated_by_email', 'updated_by', 'revision', 'last_page_url'
];

/**
 * Columns that are real data (nothing here is deleted from the file) but are
 * platform/wizard internals rather than something a person typed or a result the
 * platform computed -- raw coordinates, a bounding box, an OpenStreetMap id, the
 * boundary-picker's raw selection JSON, an edit counter, internal user-id UUIDs
 * that are already shown readably elsewhere (user_email / updated_by_email), the
 * snapshot's own bookkeeping (schema version, which wizard step it was saved on,
 * when it autosaved), the last URL the wizard was on, and each activity photo's
 * crop settings from the image-cropper UI. They're hidden by default (not removed)
 * so a reviewer isn't wading through them, but they're one right-click-unhide away
 * for anyone who actually needs them.
 */
const HIDDEN_COLUMNS = new Set([
    'owner_id', 'updated_by', 'revision', 'last_page_url',
    'version', 'currentStep', 'savedAt',
    'fields.m_lat', 'fields.m_lng',
    'fields.m_bounds_north', 'fields.m_bounds_south', 'fields.m_bounds_east', 'fields.m_bounds_west',
    'fields.m_osm_id', 'fields.m_boundary_selection_json',
    'cropPosition', 'cropX', 'cropY'
]);

/**
 * Per-slot fields the codebase generates dynamically (see renderActivityPhotoSlots()
 * in app.js: sv_photo_crop_x_${index+1} / sv_photo_crop_y_${index+1}, one pair per
 * activity photo slot) -- a plain name list would silently stop matching if the slot
 * count ever changes, so these are matched by pattern instead. They duplicate the
 * same crop data already hidden above via activityImages[].cropX/cropY.
 */
const HIDDEN_COLUMN_PATTERNS = [
    /^fields\.sv_photo_crop_[xy]_\d+$/
];

function isHiddenColumn(column) {
    return HIDDEN_COLUMNS.has(column) || HIDDEN_COLUMN_PATTERNS.some(pattern => pattern.test(column));
}

// Excel's hard limit is 32,767 characters per cell, regardless of which library wrote
// the file. A long pasted description, or any base64 string that slips past
// flattenAssessmentData()'s image detection, would otherwise corrupt the workbook, so
// every cell is clamped defensively rather than trusting the source data.
const MAX_CELL_LENGTH = 32000;

// Thumbnails, not originals: a photo this size is still clearly recognizable in a
// review sheet, but keeps the workbook from ballooning if projects have many
// multi-megabyte uploads.
const THUMBNAIL_MAX_DIMENSION_PX = 160;
const THUMBNAIL_QUALITY = 0.72;
const IMAGE_COLUMN_WIDTH = 22;
const IMAGE_ROW_HEIGHT_PT = Math.round(THUMBNAIL_MAX_DIMENSION_PX * 0.75) + 10; // px -> pt, plus margin

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDA5F8E' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

/**
 * @param {(message: string) => void} [onProgress] optional progress callback for the UI
 */
export async function downloadExcelBackup(onProgress) {
    const projects = await fetchAllProjects(onProgress);
    onProgress?.('กำลังสร้างไฟล์ Excel... (Building spreadsheet...)');
    const workbook = await buildWorkbook(projects, onProgress);
    const buffer = await workbook.xlsx.writeBuffer();
    triggerBlobDownload(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        backupFilename('xlsx')
    );
}

async function fetchAllProjects(onProgress) {
    const rows = [];
    let offset = 0;

    for (;;) {
        onProgress?.(`กำลังดึงข้อมูลโครงการ... (Fetching projects: ${rows.length} so far...)`);
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .order('created_at', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw new Error(`Could not fetch projects: ${error.message}`);

        rows.push(...(data ?? []));
        offset += data?.length ?? 0;
        if (!data || data.length < PAGE_SIZE) break;
    }

    return rows;
}

async function buildWorkbook(projects, onProgress) {
    const mainRows = [];
    const mainImagesByColumn = new Map(); // column -> array parallel to mainRows (data URI | undefined)
    // path -> { rows: object[], imagesByColumn: Map<column, array parallel to rows> }
    const arraySheets = new Map();
    const baseColumnsSeen = new Set();
    const assessmentColumnsSeen = new Set();

    projects.forEach(project => {
        const { id, project_name, user_email, owner_id, created_at, updated_at,
            updated_by_email, updated_by, revision, last_page_url, assessment_data, ...rest } = project;

        const baseRow = { id, project_name, user_email, owner_id, created_at, updated_at,
            updated_by_email, updated_by, revision, last_page_url, ...rest };
        Object.keys(baseRow).forEach(key => baseColumnsSeen.add(key));

        const { fields, arrayTables, images, arrayImages } = flattenAssessmentData(assessment_data ?? {});
        Object.keys(fields).forEach(key => assessmentColumnsSeen.add(key));

        const rowIndex = mainRows.length;
        mainRows.push({ ...baseRow, ...fields });
        Object.entries(images).forEach(([column, dataUri]) => {
            if (!mainImagesByColumn.has(column)) mainImagesByColumn.set(column, []);
            mainImagesByColumn.get(column)[rowIndex] = dataUri;
        });

        Object.entries(arrayTables).forEach(([path, items]) => {
            if (!arraySheets.has(path)) arraySheets.set(path, { rows: [], imagesByColumn: new Map() });
            const sheet = arraySheets.get(path);
            items.forEach((item, index) => {
                const sheetRowIndex = sheet.rows.length;
                sheet.rows.push({ 'Project ID': id, 'Project Name': project_name ?? '', '#': index + 1, ...item });
                const rawImage = arrayImages[path]?.[index];
                if (rawImage) {
                    if (!sheet.imagesByColumn.has('Photo attached')) sheet.imagesByColumn.set('Photo attached', []);
                    sheet.imagesByColumn.get('Photo attached')[sheetRowIndex] = rawImage;
                }
            });
        });
    });

    const baseColumns = BASE_COLUMN_ORDER.filter(c => baseColumnsSeen.has(c))
        .concat([...baseColumnsSeen].filter(c => !BASE_COLUMN_ORDER.includes(c)).sort());
    const assessmentColumns = [...assessmentColumnsSeen].sort();
    const mainColumns = [...baseColumns, ...assessmentColumns];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CU Triple S -- Admin Backup';
    workbook.created = new Date();

    addReadMeSheet(workbook, projects.length, arraySheets);
    await addDataSheet(workbook, 'Projects', mainRows, mainColumns, mainImagesByColumn, onProgress);

    const usedSheetNames = new Set(['Read Me', 'Projects']);
    for (const [path, sheet] of arraySheets) {
        const columns = ['Project ID', 'Project Name', '#',
            ...[...new Set(sheet.rows.flatMap(r => Object.keys(r)))].filter(c => !['Project ID', 'Project Name', '#'].includes(c))];
        const sheetName = uniqueSheetName(path, usedSheetNames);
        await addDataSheet(workbook, sheetName, sheet.rows, columns, sheet.imagesByColumn, onProgress);
    }

    return workbook;
}

/**
 * Excel sheet names are capped at 31 chars and can't contain : \ / ? * [ ] --
 * truncating two differently-named array fields (e.g. a future "sroiRowsDetail"
 * alongside "sroiRows") could otherwise collide once both are cut to 31 chars, which
 * ExcelJS throws on. Dedup defensively as new wizard fields are added over time, not
 * just for what exists today.
 */
function uniqueSheetName(path, usedNames) {
    const base = path.replace(/[:\\/?*[\]]/g, '_').slice(0, 31);
    let name = base;
    let suffix = 2;
    while (usedNames.has(name)) {
        const suffixText = ` (${suffix})`;
        name = base.slice(0, 31 - suffixText.length) + suffixText;
        suffix += 1;
    }
    usedNames.add(name);
    return name;
}

function addReadMeSheet(workbook, projectCount, arraySheets) {
    const worksheet = workbook.addWorksheet('Read Me');
    worksheet.columns = [{ width: 20 }, { width: 90 }];

    const rows = [
        ['CU Triple S -- Project Backup (Excel)'],
        [`Generated: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} (Asia/Bangkok)`],
        [`Projects included: ${projectCount}`],
        [''],
        ['What this file is'],
        ['A snapshot of every project in the system, exported from the admin backup tool.'],
        ['It is meant for reading and reference, not for restoring the database -- for a'],
        ['restorable copy, use the "For Dev" SQL backup instead.'],
        [''],
        ['A note on photos'],
        ['Photos are embedded as downscaled thumbnails for review, not the original full-'],
        ['resolution files -- this keeps the workbook a reasonable size. Get the originals'],
        ['from the project itself if you need them.'],
        [''],
        ['A note on hidden columns'],
        ['A few columns (raw map coordinates, an edit counter, internal user IDs, wizard'],
        ['bookkeeping like the schema version/save timestamp, and photo crop settings) are'],
        ['hidden by default -- they are platform internals, not something anyone typed or'],
        ['a result the platform computed. Nothing is deleted: right-click the column'],
        ['headers and choose "Unhide" in Excel/Google Sheets if you ever need them.'],
        [''],
        ['Sheets in this file'],
        ['Read Me', 'This page.'],
        ['Projects', 'One row per project: basic details (name, owner, dates) plus every field from the assessment form.']
    ];

    arraySheets.forEach((_, path) => {
        rows.push([path.replace(/[:\\/?*[\]]/g, '_').slice(0, 31),
            `Repeating "${path}" entries for every project (e.g. multiple rows per outcome), matched back to a project via its Project ID.`]);
    });

    worksheet.addRows(rows);
}

function truncateForCell(value) {
    if (typeof value !== 'string' || value.length <= MAX_CELL_LENGTH) return value;
    return `${value.slice(0, MAX_CELL_LENGTH)}... [truncated, ${value.length} chars total]`;
}

/**
 * Builds one worksheet with a bold/colored/frozen header row, estimated column
 * widths, and any images embedded over their placeholder "Yes"/"No" cell.
 *
 * @param {Map<string, Array<string|undefined>>} imagesByColumn column name -> raw
 *   data-URI array, parallel to `rows`, wherever that project/item actually had a photo
 */
async function addDataSheet(workbook, name, rows, columns, imagesByColumn, onProgress) {
    const worksheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });

    worksheet.columns = columns.map(column => ({
        header: column,
        key: column,
        width: imagesByColumn.has(column)
            ? IMAGE_COLUMN_WIDTH
            : estimateTextColumnWidth(column, rows),
        hidden: isHiddenColumn(column)
    }));

    worksheet.addRows(rows.map(row => {
        const sanitized = {};
        Object.entries(row).forEach(([key, value]) => { sanitized[key] = truncateForCell(value); });
        return sanitized;
    }));

    const headerRow = worksheet.getRow(1);
    headerRow.eachCell(cell => {
        cell.font = HEADER_FONT;
        cell.fill = HEADER_FILL;
    });

    for (const [column, images] of imagesByColumn) {
        const colNumber = columns.indexOf(column) + 1;
        if (colNumber <= 0) continue;

        for (let i = 0; i < images.length; i++) {
            const dataUri = images[i];
            if (!dataUri) continue;

            onProgress?.(`กำลังฝังรูปภาพ... (Embedding photos in "${name}"...)`);
            const thumbnail = await resizeImageForEmbedding(dataUri);
            if (!thumbnail) continue; // corrupt/undecodable image -- leave the "Yes" text as-is

            const excelRow = i + 2; // header occupies row 1
            worksheet.getCell(excelRow, colNumber).value = '';
            const imageId = workbook.addImage({ base64: thumbnail.dataUri, extension: 'jpeg' });
            worksheet.addImage(imageId, {
                tl: { col: colNumber - 1, row: excelRow - 1 },
                ext: { width: thumbnail.width, height: thumbnail.height }
            });
            worksheet.getRow(excelRow).height = Math.max(worksheet.getRow(excelRow).height || 0, IMAGE_ROW_HEIGHT_PT);
        }
    }

    return worksheet;
}

function estimateTextColumnWidth(column, rows) {
    const maxLen = rows.reduce((max, row) => Math.max(max, String(row[column] ?? '').length), column.length);
    return Math.min(60, Math.max(10, maxLen + 2));
}

/**
 * Decodes a base64 data URI through an offscreen canvas and re-encodes it as a small
 * JPEG thumbnail. Using canvas (rather than trusting the original format/size) means
 * any browser-decodable format works uniformly and output size is bounded regardless
 * of how large the original upload was.
 *
 * @returns {Promise<{dataUri: string, width: number, height: number}|null>} null if
 *   the image is corrupt or the browser can't decode it -- caller falls back to text.
 */
function resizeImageForEmbedding(dataUri) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, THUMBNAIL_MAX_DIMENSION_PX / Math.max(img.naturalWidth, img.naturalHeight));
            const width = Math.max(1, Math.round(img.naturalWidth * scale));
            const height = Math.max(1, Math.round(img.naturalHeight * scale));

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            try {
                resolve({ dataUri: canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY), width, height });
            } catch (error) {
                console.error('Could not re-encode image for embedding:', error);
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = dataUri;
    });
}
