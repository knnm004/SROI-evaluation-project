/**
 * The "list of rows" parts of step 3 (I2 Impact Pathway): the three questions that used to
 * be one free-text box each and are now lists the person adds rows to.
 *
 *   inputs        แหล่งทุน   -> { name: ชื่อทุน, type: ประเภททุน, amount: จำนวน (บาท) }
 *   stakeholders  ผู้มีส่วนได้ส่วนเสีย -> { name, count: จำนวน }
 *   outcomes      ผลลัพธ์    -> { stakeholders: ผู้ที่ได้รับผลลัพธ์, change: การเปลี่ยนแปลงที่คาดหวัง }
 *                 (`stakeholders` is not typed: it is brought over from the stakeholders list; see syncOutcomeStakeholders)
 *
 * Pure data: no DOM, no network. Shared by the snapshot (save/load), the completeness
 * check and the form (src/lib/pathwayLists.js), so all of them agree on the shape.
 * Every value is a string, exactly as typed -- numbers are parsed only where they are used.
 */

/** Options of the ประเภททุน dropdown. The stored value IS the label. */
export const FUND_TYPES = ['ทุนภายนอก', 'ทุนจากโครงการ', 'อื่น ๆ'];

export const PATHWAY_KINDS = {
    inputs:       { fields: ['name', 'type', 'amount'] },
    stakeholders: { fields: ['name', 'count'] },
    outcomes:     { fields: ['stakeholders', 'change'] }
};

const KIND_IDS = Object.keys(PATHWAY_KINDS);

/**
 * Plumbing kept on a row besides its cells: a stakeholder row has an `id`, and an outcome row
 * has the `stakeholderId` of the stakeholder row it belongs to. That link (not the name) is
 * what lets an outcome row follow its stakeholder through a rename and disappear with it.
 */
const newId = () => `s${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

export const blankPathwayRow = kind => {
    const row = Object.fromEntries(PATHWAY_KINDS[kind].fields.map(field => [field, '']));
    if (kind === 'stakeholders') row.id = newId();
    if (kind === 'outcomes') row.stakeholderId = '';
    return row;
};

export const emptyPathway = () => normalisePathway(null);

const asText = value => (value == null ? '' : String(value));

/** Keep only the known fields of one row, as strings; an unknown fund type becomes blank. */
function cleanRow(kind, raw) {
    const row = blankPathwayRow(kind);
    PATHWAY_KINDS[kind].fields.forEach(field => { row[field] = asText(raw?.[field]); });
    if (kind === 'inputs' && !FUND_TYPES.includes(row.type)) row.type = '';
    if (kind === 'stakeholders' && asText(raw?.id)) row.id = asText(raw.id);
    if (kind === 'outcomes') row.stakeholderId = asText(raw?.stakeholderId);
    return row;
}

/**
 * Whatever was stored (or nothing) -> the full shape, with at least one row per list so the
 * form always has a row to type into, and the outcomes lined up with the stakeholders.
 */
export function normalisePathway(raw) {
    const out = {};
    KIND_IDS.forEach(kind => {
        const rows = Array.isArray(raw?.[kind]) ? raw[kind].map(row => cleanRow(kind, row)) : [];
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
 *   - outcomes: the two boxes become the two cells of one row, newlines kept
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
    if (change || receivers) raw.outcomes = [{ change, stakeholders: receivers }];

    return normalisePathway(raw);
}

const isBlank = value => asText(value).trim() === '';

/**
 * Has anything been typed into this row? (A row nobody touched is the blank default.)
 * For outcomes only the change counts: the stakeholder cell is filled in automatically
 * (syncOutcomeStakeholders), so a row holding just a name is not yet an outcome somebody wrote.
 */
export function isPathwayRowStarted(kind, row) {
    if (kind === 'outcomes') return !isBlank(row?.change);
    return PATHWAY_KINDS[kind].fields.some(field => !isBlank(row?.[field]));
}

/** Every cell of the row filled in. */
export function isPathwayRowComplete(kind, row) {
    return PATHWAY_KINDS[kind].fields.every(field => !isBlank(row?.[field]));
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

/**
 * Line the outcomes list up with the stakeholders list, in place. Safe to run any number of
 * times; returns true if it changed anything.
 *   - every stakeholder row (even one with no name yet) has exactly one outcome row, in the
 *     same order, showing the stakeholder's current name
 *   - an outcome row whose stakeholder row was removed is removed too
 *   - an outcome row with no link yet (saved before the link existed) is adopted by the
 *     stakeholder with the same name, or else by one that has no row and itself is blank;
 *     any that nobody claims are kept at the end -- they hold text the person wrote, and are
 *     the only outcome rows that can be deleted by hand
 */
export function syncOutcomeStakeholders(pathway) {
    const before = JSON.stringify(pathway.outcomes);
    const previous = pathway.outcomes;
    const linked = new Map();
    previous.forEach(row => {
        if (row.stakeholderId && !linked.has(row.stakeholderId)) linked.set(row.stakeholderId, row);
    });
    const unlinked = previous.filter(row => !row.stakeholderId);
    const claimed = new Set();

    const next = pathway.stakeholders.map(stakeholder => {
        let row = linked.get(stakeholder.id);
        if (!row) {
            const name = asText(stakeholder.name).trim();
            row = (name && unlinked.find(r => !claimed.has(r) && asText(r.stakeholders).trim() === name))
                || unlinked.find(r => !claimed.has(r) && isBlank(r.stakeholders) && isBlank(r.change));
            if (row) claimed.add(row);
            else row = blankPathwayRow('outcomes');
            row.stakeholderId = stakeholder.id;
        }
        row.stakeholders = asText(stakeholder.name).trim();
        return row;
    });

    previous.splice(0, previous.length, ...next, ...unlinked.filter(row => !claimed.has(row)));
    return JSON.stringify(pathway.outcomes) !== before;
}
