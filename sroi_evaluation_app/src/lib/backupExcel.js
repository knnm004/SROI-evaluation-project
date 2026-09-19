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
 */

import * as XLSX from 'xlsx';
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
 * @param {(message: string) => void} [onProgress] optional progress callback for the UI
 */
export async function downloadExcelBackup(onProgress) {
    const projects = await fetchAllProjects(onProgress);
    onProgress?.('กำลังสร้างไฟล์ Excel... (Building spreadsheet...)');
    const workbook = buildWorkbook(projects);
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true });
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

function buildWorkbook(projects) {
    const mainRows = [];
    // path -> { rows: object[] }, one entry per array-of-objects path seen (e.g. "sroiRows")
    const arraySheets = new Map();
    const baseColumnsSeen = new Set();
    const assessmentColumnsSeen = new Set();

    projects.forEach(project => {
        const { id, project_name, user_email, owner_id, created_at, updated_at,
            updated_by_email, updated_by, revision, last_page_url, assessment_data, ...rest } = project;

        const baseRow = { id, project_name, user_email, owner_id, created_at, updated_at,
            updated_by_email, updated_by, revision, last_page_url, ...rest };
        Object.keys(baseRow).forEach(key => baseColumnsSeen.add(key));

        const { fields, arrayTables } = flattenAssessmentData(assessment_data ?? {});
        Object.keys(fields).forEach(key => assessmentColumnsSeen.add(key));

        mainRows.push({ ...baseRow, ...fields });

        Object.entries(arrayTables).forEach(([path, items]) => {
            if (!arraySheets.has(path)) arraySheets.set(path, []);
            const sheetRows = arraySheets.get(path);
            items.forEach((item, index) => {
                sheetRows.push({ 'Project ID': id, 'Project Name': project_name ?? '', '#': index + 1, ...item });
            });
        });
    });

    const baseColumns = BASE_COLUMN_ORDER.filter(c => baseColumnsSeen.has(c))
        .concat([...baseColumnsSeen].filter(c => !BASE_COLUMN_ORDER.includes(c)).sort());
    const assessmentColumns = [...assessmentColumnsSeen].sort();
    const mainColumns = [...baseColumns, ...assessmentColumns];

    const workbook = XLSX.utils.book_new();
    const usedSheetNames = new Set(['Read Me', 'Projects']);

    XLSX.utils.book_append_sheet(workbook, buildReadMeSheet(projects.length, arraySheets), 'Read Me');
    XLSX.utils.book_append_sheet(workbook, buildSheet(mainRows, mainColumns), 'Projects');

    arraySheets.forEach((sheetRows, path) => {
        const columns = ['Project ID', 'Project Name', '#',
            ...[...new Set(sheetRows.flatMap(r => Object.keys(r)))].filter(c => !['Project ID', 'Project Name', '#'].includes(c))];
        const sheetName = uniqueSheetName(path, usedSheetNames);
        XLSX.utils.book_append_sheet(workbook, buildSheet(sheetRows, columns), sheetName);
    });

    return workbook;
}

/**
 * Excel sheet names are capped at 31 chars and can't contain : \ / ? * [ ] --
 * truncating two differently-named array fields (e.g. a future "sroiRowsDetail"
 * alongside "sroiRows") could otherwise collide once both are cut to 31 chars,
 * which XLSX.utils.book_append_sheet throws on. Dedup defensively as new wizard
 * fields are added over time, not just for what exists today.
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

function buildReadMeSheet(projectCount, arraySheets) {
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
        ['Sheets in this file'],
        ['Read Me', 'This page.'],
        ['Projects', 'One row per project: basic details (name, owner, dates) plus every field from the assessment form.'],
    ];

    arraySheets.forEach((_, path) => {
        rows.push([path.replace(/[:\\/?*[\]]/g, '_').slice(0, 31),
            `Repeating "${path}" entries for every project (e.g. multiple rows per outcome), matched back to a project via its Project ID.`]);
    });

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [{ wch: 20 }, { wch: 90 }];
    return sheet;
}

// Excel's hard limit is 32,767 characters per cell -- SheetJS throws rather than
// silently truncating. A long pasted description, or any base64 string that slips
// past flattenAssessmentData()'s image detection, would otherwise abort the whole
// export, so every cell is clamped defensively rather than trusting the source data.
const MAX_CELL_LENGTH = 32000;

function truncateForCell(value) {
    if (typeof value !== 'string' || value.length <= MAX_CELL_LENGTH) return value;
    return `${value.slice(0, MAX_CELL_LENGTH)}... [truncated, ${value.length} chars total]`;
}

/** Builds one worksheet with a bold/colored/frozen header row and estimated column widths. */
function buildSheet(rows, columns) {
    const headerStyle = {
        font: { bold: true, color: { rgb: 'FFFFFFFF' } },
        fill: { fgColor: { rgb: 'FFDA5F8E' } }
    };

    const safeRows = rows.map(row => {
        const sanitized = {};
        Object.entries(row).forEach(([key, value]) => { sanitized[key] = truncateForCell(value); });
        return sanitized;
    });

    const sheet = XLSX.utils.json_to_sheet(safeRows, { header: columns });

    columns.forEach((column, colIndex) => {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIndex });
        if (sheet[cellRef]) sheet[cellRef].s = headerStyle;
    });

    sheet['!cols'] = columns.map(column => {
        const maxLen = safeRows.reduce((max, row) => Math.max(max, String(row[column] ?? '').length), column.length);
        return { wch: Math.min(60, Math.max(10, maxLen + 2)) };
    });

    // Keep the header row visible while scrolling. Note: cell coloring/bold above
    // (and this freeze) render correctly in Excel and LibreOffice; the free SheetJS
    // "xlsx" package's style support is best-effort -- verify visually after export.
    sheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };

    return sheet;
}
