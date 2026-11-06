/**
 * The "list of rows" parts of step 3 (I2 Impact Pathway): the three questions that used to
 * be one free-text box each and are now lists the person adds rows to.
 *
 *   inputs        แหล่งทุน   -> { name: ชื่อทุน, type: ประเภททุน, amount: จำนวน (บาท) }
 *   stakeholders  ผู้มีส่วนได้ส่วนเสีย -> { id, name, count: จำนวน (กลุ่มเป้าหมาย) }
 *   outcomes      ผลลัพธ์    -> { change: การเปลี่ยนแปลงที่คาดหวัง,
 *                                stakeholderIds: [id, ...] -- the stakeholders it applies to,
 *                                stakeholders: their names, comma-joined (derived, for reading) }
 *
 * One expected change can apply to several stakeholders, so an outcome row points at a SET of
 * stakeholder rows by id (ticked in the form) instead of repeating the change per stakeholder.
 * Ids, not names, so a rename carries through and a removed stakeholder simply drops out.
 *
 * Pure data: no DOM, no network. Shared by the snapshot (save/load), the completeness
 * check and the form (src/lib/pathwayLists.js), so all of them agree on the shape.
 * Typed values are strings, exactly as typed -- numbers are parsed only where they are used.
 */

/** Options of the ประเภททุน dropdown. The stored value IS the label. */
export const FUND_TYPES = ['ทุนภายนอก', 'ทุนจากโครงการ', 'อื่น ๆ'];

/** The cells the person types into, per list (an outcome's stakeholders are ticked, not typed). */
export const PATHWAY_KINDS = {
    inputs:       { fields: ['name', 'type', 'amount'] },
    stakeholders: { fields: ['name', 'count'] },
    outcomes:     { fields: ['change'] }
};

const KIND_IDS = Object.keys(PATHWAY_KINDS);

const newId = () => `s${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
const asText = value => (value == null ? '' : String(value));
const isBlank = value => asText(value).trim() === '';

export const blankPathwayRow = kind => {
    const row = Object.fromEntries(PATHWAY_KINDS[kind].fields.map(field => [field, '']));
    if (kind === 'stakeholders') row.id = newId();
    if (kind === 'outcomes') {
        row.stakeholderIds = [];
        row.stakeholders = '';
        row.legacy = ''; // free text from before the tick boxes existed, until it is replaced by ticks
    }
    return row;
};

export const emptyPathway = () => normalisePathway(null);

/** Keep only the known fields of one row, as strings; an unknown fund type becomes blank. */
function cleanRow(kind, raw) {
    const row = blankPathwayRow(kind);
    PATHWAY_KINDS[kind].fields.forEach(field => { row[field] = asText(raw?.[field]); });
    if (kind === 'inputs' && !FUND_TYPES.includes(row.type)) row.type = '';
    if (kind === 'stakeholders' && asText(raw?.id)) row.id = asText(raw.id);
    if (kind === 'outcomes') {
        row.stakeholderIds = Array.isArray(raw?.stakeholderIds) ? raw.stakeholderIds.map(asText).filter(Boolean) : [];
        row.legacy = asText(raw?.legacy);
        row.stakeholders = asText(raw?.stakeholders);
    }
    return row;
}

/**
 * Rows saved while an outcome belonged to exactly one stakeholder (`stakeholderId`, one row per
 * stakeholder) become the many-to-many shape: rows with the same change are merged into one that
 * lists all their stakeholders, and the empty placeholder rows are dropped. Anything else
 * (rows already in the new shape, or with no link at all) passes through untouched.
 */
function upgradeSingleStakeholderOutcomes(rows) {
    if (!rows.some(row => row && 'stakeholderId' in row && !('stakeholderIds' in row))) return rows;

    const out = [];
    const byChange = new Map();
    rows.forEach(row => {
        if (!row || !('stakeholderId' in row) || 'stakeholderIds' in row) { out.push(row); return; }
        const change = asText(row.change).trim();
        const id = asText(row.stakeholderId);
        if (!change) {
            // A row with a stakeholder but no change was just a placeholder.
            if (!id && asText(row.stakeholders).trim()) out.push({ ...row, stakeholderIds: [] });
            return;
        }
        const existing = byChange.get(change);
        if (existing) { if (id) existing.stakeholderIds.push(id); return; }
        const merged = { change: row.change, stakeholderIds: id ? [id] : [], stakeholders: '', legacy: id ? '' : asText(row.stakeholders) };
        byChange.set(change, merged);
        out.push(merged);
    });
    return out;
}

/**
 * Whatever was stored (or nothing) -> the full shape, with at least one row per list so the
 * form always has a row to type into, and the outcomes consistent with the stakeholders.
 */
export function normalisePathway(raw) {
    const out = {};
    KIND_IDS.forEach(kind => {
        let source = Array.isArray(raw?.[kind]) ? raw[kind] : [];
        if (kind === 'outcomes') source = upgradeSingleStakeholderOutcomes(source);
        const rows = source.map(row => cleanRow(kind, row));
        out[kind] = rows.length ? rows : [blankPathwayRow(kind)];
    });
    syncOutcomeStakeholders(out);
    return out;
}

/**
 * Projects saved before these lists existed kept one free-text box per question
 * (fields.i_inputs, i_stakeholders, i_outcome, i_outcome_stakeholders). Carry that text over
 * instead of dropping it, so opening an old project and saving it again loses nothing:
 *   - inputs / stakeholders: one row per non-blank line, the line going in the name cell
 *     (those cells are single-line, which is also why the text is split)
 *   - outcomes: one row; the "who" text is kept as `legacy` and turned into ticks if it
 *     names stakeholders that exist (syncOutcomeStakeholders)
 */
export function pathwayFromLegacyFields(fields) {
    const lines = text => asText(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const raw = {};

    const inputLines = lines(fields?.i_inputs);
    if (inputLines.length) raw.inputs = inputLines.map(name => ({ name }));

    const stakeholderLines = lines(fields?.i_stakeholders);
    if (stakeholderLines.length) raw.stakeholders = stakeholderLines.map(name => ({ name }));

    const change = asText(fields?.i_outcome).trim();
    const receivers = asText(fields?.i_outcome_stakeholders).trim();
    if (change || receivers) raw.outcomes = [{ change, legacy: receivers }];

    return normalisePathway(raw);
}

/**
 * Has anything been typed into this row? (A row nobody touched is the blank default.)
 * An outcome counts once its change is written; ticking stakeholders alone does not.
 */
export function isPathwayRowStarted(kind, row) {
    return PATHWAY_KINDS[kind].fields.some(field => !isBlank(row?.[field]));
}

/** Every cell filled in -- for an outcome, that also means at least one stakeholder ticked. */
export function isPathwayRowComplete(kind, row) {
    const cells = PATHWAY_KINDS[kind].fields.every(field => !isBlank(row?.[field]));
    return kind === 'outcomes' ? cells && (row?.stakeholderIds ?? []).length > 0 : cells;
}

/** Does any list in this pathway hold typed content? (For the "worth resuming?" check.) */
export function pathwayHasContent(pathway) {
    return KIND_IDS.some(kind =>
        (pathway?.[kind] ?? []).some(row => isPathwayRowStarted(kind, row)));
}

/** Sum of the amounts in บาท, ignoring blanks and anything that is not a number. */
export function totalFundAmount(rows) {
    return (rows ?? []).reduce((sum, row) => {
        const n = Number.parseFloat(asText(row?.amount).replace(/,/g, ''));
        return Number.isFinite(n) ? sum + n : sum;
    }, 0);
}

/** Stakeholder rows that have a name, as { id, name } (the ones that can be ticked). */
export function namedStakeholders(pathway) {
    return (pathway?.stakeholders ?? [])
        .map(row => ({ id: row.id, name: asText(row.name).trim() }))
        .filter(row => row.name);
}

/**
 * Keep the outcomes consistent with the stakeholders, in place. Safe to run any number of
 * times; returns true if it changed anything.
 *   - ticks for stakeholder rows that no longer exist are dropped, and duplicates removed
 *   - each outcome's `stakeholders` text is rebuilt from the current names of its ticked
 *     stakeholders (so a rename shows up, and saved data stays readable without the ids)
 *   - `legacy` text (written before the tick boxes) is turned into ticks when every
 *     comma/newline-separated part of it is the name of a stakeholder; otherwise it stays,
 *     shown as a note, until the person ticks something
 */
export function syncOutcomeStakeholders(pathway) {
    const before = JSON.stringify(pathway.outcomes);
    const nameById = new Map((pathway.stakeholders ?? []).map(row => [row.id, asText(row.name).trim()]));
    const idByName = new Map();
    nameById.forEach((name, id) => { if (name && !idByName.has(name)) idByName.set(name, id); });

    pathway.outcomes.forEach(row => {
        row.stakeholderIds = [...new Set(row.stakeholderIds)].filter(id => nameById.has(id));

        if (!row.stakeholderIds.length && !isBlank(row.legacy)) {
            const parts = asText(row.legacy).split(/[\n,]+/).map(part => part.trim()).filter(Boolean);
            if (parts.length && parts.every(part => idByName.has(part))) {
                row.stakeholderIds = [...new Set(parts.map(part => idByName.get(part)))];
            }
        }
        if (row.stakeholderIds.length) row.legacy = '';

        row.stakeholders = row.stakeholderIds.length
            ? row.stakeholderIds.map(id => nameById.get(id)).filter(Boolean).join(', ')
            : '';
    });
    return JSON.stringify(pathway.outcomes) !== before;
}
