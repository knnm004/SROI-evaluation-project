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
        { field: 'stakeholders', label: 'ผู้มีส่วนได้ส่วนเสียที่ได้รับผลลัพธ์', control: 'stakeholderFixed', placeholder: 'ยังไม่มีผู้มีส่วนได้ส่วนเสีย' },
        { field: 'change',       label: 'การเปลี่ยนแปลงที่คาดหวัง',             control: 'textarea',          placeholder: 'ระบุว่ากลุ่มเป้าหมายเปลี่ยนแปลงอย่างไร เช่น ทักษะ รายได้ พฤติกรรม คุณภาพชีวิต' }
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

    if (column.control === 'stakeholderFixed') {
        // Not editable: the name is brought over from the Stakeholders tab (see refreshOutcomes).
        // A name that is no longer on that tab (text from before this list existed, or a
        // stakeholder since removed) is still shown, and flagged, so nothing silently vanishes.
        const name = value.trim();
        const orphan = name && !row.stakeholderId; // an unclaimed row from before the link existed
        return name
            ? `<div class="pathway-fixed" data-pathway-fixed>${escapeHTML(name)}${
                orphan ? '<span class="pathway-fixed-note">ไม่อยู่ในรายการผู้มีส่วนได้ส่วนเสียแล้ว</span>' : ''}</div>`
            : `<div class="pathway-fixed pathway-fixed-empty" data-pathway-fixed>${escapeHTML(column.placeholder)}</div>`;
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
        // A fixed (read-only) cell is not a form control, so it gets a <div>, not a <label>.
        const tag = column.control === 'stakeholderFixed' ? 'div' : 'label';
        return `
        <${tag} class="pathway-cell">
            <span class="pathway-cell-label">${escapeHTML(column.label)}</span>
            ${controlHTML(kind, column, row, index, disabled, state)}
        </${tag}>`;
    }).join('');

    // An outcome row that belongs to a stakeholder row cannot be removed by hand: it goes when
    // that stakeholder row is removed. Only rows with no stakeholder behind them can.
    const removable = kind !== 'outcomes' || !row.stakeholderId;
    const removeButton = removable
        ? `<button type="button" class="pathway-remove" data-pathway-remove
                    aria-label="ลบ${escapeHTML(ITEM_NAME[kind])}ที่ ${index + 1}"${disabled ? ' disabled' : ''}>
                <i class="fa-solid fa-trash-can"></i>
            </button>`
        : '<span class="pathway-remove pathway-remove-none" aria-hidden="true"></span>';

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

export function renderPathwayList(state, kind) {
    const container = listEl(kind);
    if (!container) return;
    const rows = state.pathwayRows[kind];
    container.innerHTML = rows.map((row, index) => rowHTML(kind, row, index, state.isViewMode, state)).join('');
    if (kind === 'inputs') updateTotal(state);
}

export function renderPathwayLists(state) {
    KINDS.forEach(kind => renderPathwayList(state, kind));
    updatePathwayControls(state);
}

/**
 * Called when the Outcomes tab is opened: line the outcomes up with the stakeholders (one row
 * per stakeholder row, gone when theirs is gone) and redraw. The sync also runs as the
 * stakeholders are edited, so this is mostly a redraw; in read-only mode nothing is changed.
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
    document.querySelectorAll('[data-pathway-remove]').forEach(button => {
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
            // The outcome rows show the stakeholders' names; keep their copy of a renamed one current.
            if (kind === 'stakeholders' && field === 'name') syncOutcomeStakeholders(state.pathwayRows);
        });

        // A <select> reports through `change`.
        container.addEventListener('change', event => {
            const target = event.target;
            const field = target?.dataset?.pathwayField;
            const row = field ? rowOf(target) : null;
            if (row) row[field] = target.value;
        });

        container.addEventListener('click', event => {
            const button = event.target.closest?.('[data-pathway-remove]');
            if (!button || state.isViewMode) return;
            const rowEl = button.closest('[data-pathway-row]');
            if (!rowEl) return;

            const rows = state.pathwayRows[kind];
            rows.splice(Number(rowEl.dataset.pathwayRow), 1);
            if (rows.length === 0) rows.push(blankPathwayRow(kind)); // always keep a row to type into
            if (kind === 'stakeholders') syncOutcomeStakeholders(state.pathwayRows); // its outcome row goes too
            renderPathwayList(state, kind);
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

            state.pathwayRows[kind].push(blankPathwayRow(kind));
            if (kind === 'stakeholders') syncOutcomeStakeholders(state.pathwayRows); // it gets an outcome row
            renderPathwayList(state, kind);
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
        // outcomes: who -> what changes for them
        const who = text(row.stakeholders);
        const change = text(row.change);
        return who ? `${who} <span class="text-chula">→</span> ${change || '-'}` : change;
    });
    return `<ul class="list-disc pl-4 space-y-0.5">${lines.map(line => `<li>${line}</li>`).join('')}</ul>`;
}
