/**
 * The add-a-row lists of step 3 (inputs / stakeholders / outcomes): rendering, the add and
 * remove buttons, and keeping appState.pathwayRows in step with what is typed.
 *
 * The data shape lives in pathwayData.js. The markup it fills is in index.html: one
 * `#pathway-<kind>-list` container per list, an add button carrying `data-pathway-add="<kind>"`,
 * and (inputs only) a `[data-pathway-total]` span.
 *
 * Inputs here deliberately have NO id: serialiseAssessment() sweeps every id'd field, and
 * these rows are saved from appState.pathwayRows instead (the `pathway` key of the snapshot).
 * Saving itself needs nothing from this file -- the document-level input/change handlers in
 * app.js already schedule an autosave for any input -- this only has to keep the state current.
 */

import { escapeHTML } from './format.js';
import {
    FUND_TYPES,
    PATHWAY_KINDS,
    blankPathwayRow,
    isPathwayRowStarted,
    namedStakeholders,
    syncOutcomeStakeholders,
    totalFundAmount
} from './pathwayData.js';

/** Column definitions per list, in display order. */
const COLUMNS = {
    inputs: [
        { field: 'name',   label: 'ชื่อทุน',          control: 'text',   placeholder: 'เช่น ทุนนวัตกรรมสังคม SiHub' },
        { field: 'type',   label: 'ประเภททุน',        control: 'select', placeholder: 'เลือกประเภททุน' },
        { field: 'amount', label: 'จำนวน (บาท)',      control: 'number', placeholder: '0' }
    ],
    stakeholders: [
        { field: 'name',   label: 'ผู้มีส่วนได้ส่วนเสีย', control: 'text',   placeholder: 'เช่น ชุมชน กลุ่มเป้าหมาย หน่วยงานรัฐ ผู้ประกอบการ' },
        { field: 'count',  label: 'จำนวน (กลุ่มเป้าหมาย)', control: 'number', placeholder: '0' }
    ],
    outcomes: [
        { field: 'change',       label: 'การเปลี่ยนแปลงที่คาดหวัง',             control: 'textarea',          placeholder: 'ระบุว่ากลุ่มเป้าหมายเปลี่ยนแปลงอย่างไร เช่น ทักษะ รายได้ พฤติกรรม คุณภาพชีวิต' },
        { field: 'stakeholders', label: 'ผู้มีส่วนได้ส่วนเสียที่ได้รับผลลัพธ์', control: 'stakeholderChecks', placeholder: 'ยังไม่มีผู้มีส่วนได้ส่วนเสีย' }
    ]
};

/** What "row 3" is called in the remove button's accessible name. */
const ITEM_NAME = { inputs: 'แหล่งทุน', stakeholders: 'ผู้มีส่วนได้ส่วนเสีย', outcomes: 'ผลลัพธ์' };

const KINDS = Object.keys(PATHWAY_KINDS);
const listEl = kind => document.getElementById(`pathway-${kind}-list`);

/** Digits (and at most one dot for amounts) only; the stored value stays a plain string. */
function sanitiseNumber(value, allowDecimal) {
    let text = String(value).replace(allowDecimal ? /[^\d.]/g : /\D/g, '');
    if (allowDecimal) {
        const dot = text.indexOf('.');
        if (dot !== -1) text = text.slice(0, dot + 1) + text.slice(dot + 1).replace(/\./g, '');
    }
    return text;
}

function controlHTML(kind, column, row, index, disabled, state) {
    const value = row[column.field] ?? '';
    const common = `data-pathway-field="${column.field}"${disabled ? ' disabled readonly' : ''}`;
    const aria = `aria-label="${escapeHTML(`${column.label} (${ITEM_NAME[kind]}ที่ ${index + 1})`)}"`;

    if (column.control === 'stakeholderChecks') {
        // One tick box per stakeholder named on the Stakeholders tab: tick every group this
        // change applies to, so one change is written once however many groups share it.
        const people = namedStakeholders(state.pathwayRows);
        if (!people.length) {
            return `<div class="pathway-fixed pathway-fixed-empty">${escapeHTML(column.placeholder)}</div>`;
        }
        const ticked = new Set(row.stakeholderIds);
        const boxes = people.map(person => `
            <label class="pathway-check">
                <input type="checkbox" data-pathway-stakeholder="${escapeHTML(person.id)}"${ticked.has(person.id) ? ' checked' : ''}${disabled ? ' disabled' : ''}>
                <span>${escapeHTML(person.name)}</span>
            </label>`).join('');
        const tools = people.length > 1 && !disabled
            ? `<div class="pathway-check-tools">
                   <button type="button" data-pathway-tick-all>เลือกทั้งหมด</button>
                   <span aria-hidden="true">·</span>
                   <button type="button" data-pathway-tick-none>ล้าง</button>
               </div>`
            : '';
        // Text written here before the tick boxes existed, until ticks replace it.
        const legacy = !row.stakeholderIds.length && row.legacy.trim()
            ? `<p class="pathway-fixed-note">ข้อความเดิม: ${escapeHTML(row.legacy.trim())} (เลือกจากรายการด้านบนเพื่อแทนที่)</p>`
            : '';
        return `<div class="pathway-checks" role="group" ${aria}>${boxes}${tools}${legacy}</div>`;
    }
    if (column.control === 'select') {
        const options = FUND_TYPES.map(type =>
            `<option value="${escapeHTML(type)}"${type === value ? ' selected' : ''}>${escapeHTML(type)}</option>`
        ).join('');
        return `<select class="form-control" ${common} ${aria}>
                    <option value=""${value ? '' : ' selected'} disabled>${escapeHTML(column.placeholder)}</option>
                    ${options}
                </select>`;
    }
    if (column.control === 'textarea') {
        return `<textarea rows="3" class="form-control resize-none" ${common} ${aria}
                    placeholder="${escapeHTML(column.placeholder)}">${escapeHTML(value)}</textarea>`;
    }
    // Numbers are text inputs on purpose: no spinner arrows, and the sanitiser decides what is allowed.
    const numeric = column.control === 'number';
    return `<input type="text" class="form-control${numeric ? ' text-right tabular-nums' : ''}" ${common} ${aria}
                ${numeric ? 'inputmode="decimal" autocomplete="off"' : ''}
                placeholder="${escapeHTML(column.placeholder)}" value="${escapeHTML(value)}">`;
}

function rowHTML(kind, row, index, disabled, state) {
    const cells = COLUMNS[kind].map(column => {
        // The tick-box group holds several controls, so it gets a <div>, not a <label>.
        const tag = column.control === 'stakeholderChecks' ? 'div' : 'label';
        return `
        <${tag} class="pathway-cell">
            <span class="pathway-cell-label">${escapeHTML(column.label)}</span>
            ${controlHTML(kind, column, row, index, disabled, state)}
        </${tag}>`;
    }).join('');

    const removeButton = `<button type="button" class="pathway-remove" data-pathway-remove
                aria-label="ลบ${escapeHTML(ITEM_NAME[kind])}ที่ ${index + 1}"${disabled ? ' disabled' : ''}>
            <i class="fa-solid fa-trash-can"></i>
        </button>`;

    return `
        <div class="pathway-row pathway-row-${kind}" data-pathway-row="${index}">
            <div class="pathway-number" aria-hidden="true">${index + 1}</div>
            ${cells}
            ${removeButton}
        </div>`;
}

function updateTotal(state) {
    const el = document.querySelector('[data-pathway-total]');
    if (!el) return;
    const total = totalFundAmount(state.pathwayRows?.inputs);
    el.textContent = total > 0 ? `รวม ${total.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท` : '';
}

/** Under the outcomes: which named stakeholders no change has been ticked for yet (a nudge only). */
function updateOutcomeHint(state) {
    const el = document.getElementById('pathway-outcomes-hint');
    if (!el) return;
    const covered = new Set(state.pathwayRows.outcomes.flatMap(row => row.stakeholderIds));
    const missing = namedStakeholders(state.pathwayRows).filter(person => !covered.has(person.id));
    el.textContent = missing.length
        ? `ยังไม่ได้เลือกในผลลัพธ์ใดเลย: ${missing.map(person => person.name).join(', ')}`
        : '';
}

export function renderPathwayList(state, kind) {
    const container = listEl(kind);
    if (!container) return;
    const rows = state.pathwayRows[kind];
    container.innerHTML = rows.map((row, index) => rowHTML(kind, row, index, state.isViewMode, state)).join('');
    if (kind === 'inputs') updateTotal(state);
    if (kind === 'outcomes') updateOutcomeHint(state);
}

export function renderPathwayLists(state) {
    KINDS.forEach(kind => renderPathwayList(state, kind));
    updatePathwayControls(state);
}

/**
 * Called when the Outcomes tab is opened: bring the outcomes in line with the stakeholders
 * (a removed stakeholder is un-ticked everywhere, a renamed one shows its new name) and redraw
 * the tick boxes. In read-only mode nothing is changed.
 */
export function refreshOutcomes(state) {
    if (!state.isViewMode && syncOutcomeStakeholders(state.pathwayRows)) {
        state.scheduleSave();
        state.updateLiveSummary();
    }
    renderPathwayList(state, 'outcomes');
    updatePathwayControls(state);
}

/** Add buttons follow view mode (the row inputs themselves are handled by updateStepUI). */
export function updatePathwayControls(state) {
    document.querySelectorAll('[data-pathway-add]').forEach(button => {
        button.disabled = !!state.isViewMode;
        button.classList.toggle('opacity-50', !!state.isViewMode);
        button.classList.toggle('cursor-not-allowed', !!state.isViewMode);
    });
    document.querySelectorAll('[data-pathway-remove], .pathway-check-tools button').forEach(button => {
        button.disabled = !!state.isViewMode;
    });
}

/** Bind once. All listeners are delegated, so re-rendering a list never loses them. */
export function initPathwayLists(state) {
    KINDS.forEach(kind => {
        const container = listEl(kind);
        if (!container || container.dataset.bound) return;
        container.dataset.bound = 'true';

        const rowOf = element => {
            const rowEl = element.closest('[data-pathway-row]');
            return rowEl ? state.pathwayRows[kind][Number(rowEl.dataset.pathwayRow)] : null;
        };

        container.addEventListener('input', event => {
            const target = event.target;
            const field = target?.dataset?.pathwayField;
            const row = field ? rowOf(target) : null;
            if (!row) return;

            if (field === 'amount' || field === 'count') {
                const clean = sanitiseNumber(target.value, field === 'amount');
                if (clean !== target.value) target.value = clean;
            }
            row[field] = target.value;
            if (kind === 'inputs') updateTotal(state);
            // The outcomes keep a readable copy of the ticked names; keep it current on a rename.
            if (kind === 'stakeholders' && field === 'name') syncOutcomeStakeholders(state.pathwayRows);
        });

        // A <select> reports through `change`; so does a ticked / unticked stakeholder.
        container.addEventListener('change', event => {
            const target = event.target;
            const stakeholderId = target?.dataset?.pathwayStakeholder;
            if (stakeholderId) {
                const row = rowOf(target);
                if (!row) return;
                const ids = new Set(row.stakeholderIds);
                if (target.checked) ids.add(stakeholderId); else ids.delete(stakeholderId);
                row.stakeholderIds = [...ids];
                syncOutcomeStakeholders(state.pathwayRows);
                updateOutcomeHint(state);
                return;
            }
            const field = target?.dataset?.pathwayField;
            const row = field ? rowOf(target) : null;
            if (row) row[field] = target.value;
        });

        container.addEventListener('click', event => {
            // "เลือกทั้งหมด" / "ล้าง" above a row's tick boxes.
            const tickAll = event.target.closest?.('[data-pathway-tick-all]');
            const tickNone = event.target.closest?.('[data-pathway-tick-none]');
            if ((tickAll || tickNone) && !state.isViewMode) {
                const rowEl = event.target.closest('[data-pathway-row]');
                const row = rowEl ? state.pathwayRows[kind][Number(rowEl.dataset.pathwayRow)] : null;
                if (!row) return;
                row.stakeholderIds = tickAll ? namedStakeholders(state.pathwayRows).map(person => person.id) : [];
                syncOutcomeStakeholders(state.pathwayRows);
                renderPathwayList(state, kind);
                updatePathwayControls(state);
                state.scheduleSave();
                state.updateLiveSummary();
                return;
            }

            const button = event.target.closest?.('[data-pathway-remove]');
            if (!button || state.isViewMode) return;
            const rowEl = button.closest('[data-pathway-row]');
            if (!rowEl) return;

            const rows = state.pathwayRows[kind];
            rows.splice(Number(rowEl.dataset.pathwayRow), 1);
            if (rows.length === 0) rows.push(blankPathwayRow(kind)); // always keep a row to type into
            renderPathwayList(state, kind);
            if (kind === 'stakeholders') refreshOutcomes(state); // its ticks disappear from the outcomes
            updatePathwayControls(state);
            state.scheduleSave();
            state.updateLiveSummary();
        });
    });

    document.querySelectorAll('[data-pathway-add]').forEach(button => {
        if (button.dataset.bound) return;
        button.dataset.bound = 'true';
        button.addEventListener('click', () => {
            if (state.isViewMode) return;
            const kind = button.dataset.pathwayAdd;
            if (!state.pathwayRows[kind]) return;

            state.pathwayRows[kind].push(blankPathwayRow(kind)); // a new outcome starts with nothing ticked
            renderPathwayList(state, kind);
            if (kind === 'stakeholders') refreshOutcomes(state); // it appears as a new tick box
            updatePathwayControls(state);
            state.scheduleSave();
            state.updateLiveSummary();

            const rows = listEl(kind)?.querySelectorAll('[data-pathway-row]');
            rows?.[rows.length - 1]?.querySelector('input, textarea, select')?.focus();
        });
    });
}

/**
 * The report's version of a list: one line per started row, or "-" when there is none.
 * Returns HTML (escaped); the caller sets it with innerHTML.
 */
export function pathwayReportHTML(kind, rows) {
    const started = (rows ?? []).filter(row => isPathwayRowStarted(kind, row));
    if (!started.length) return '-';

    const text = value => escapeHTML(String(value ?? '').trim());
    const lines = started.map(row => {
        if (kind === 'inputs') {
            const amount = Number.parseFloat(row.amount);
            const parts = [text(row.name)];
            if (row.type) parts.push(text(row.type));
            if (Number.isFinite(amount)) parts.push(`${amount.toLocaleString('th-TH')} บาท`);
            return parts.filter(Boolean).join(' · ');
        }
        if (kind === 'stakeholders') {
            return [text(row.name), row.count ? `จำนวน ${text(row.count)}` : ''].filter(Boolean).join(' · ');
        }
        // outcomes: who (one or several) -> what changes for them
        const who = text(row.stakeholders || row.legacy);
        const change = text(row.change);
        return who ? `${who} <span class="text-chula">→</span> ${change || '-'}` : change;
    });
    return `<ul class="list-disc pl-4 space-y-0.5">${lines.map(line => `<li>${line}</li>`).join('')}</ul>`;
}
