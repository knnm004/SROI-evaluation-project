/**
 * "Is this assessment filled in completely?" -- one definition, used in two places:
 *   - the recheck modal at save time (src/app.js), to pre-set and explain the
 *     "กรอกข้อมูลครบแล้ว" switch;
 *   - the dashboard (src/dashboard.js), for projects saved before that switch existed.
 *
 * It reads the SAME snapshot shape the database stores (see assessmentSnapshot.js:
 * `fields`, `selectedSDGs`, `sroiRows`, `activityImages`), not the DOM, which is what lets
 * the dashboard run it on a row it just fetched. Pure: no DOM, no network.
 *
 * WHAT COUNTS: every field a person actually types or picks, per step. Deliberately NOT
 * counted: the hidden map fields (lat/lng/bounds/osm id -- filled by the map, not typed),
 * m_location_label (auto-filled from the chosen area and falls back gracefully in the
 * report), search boxes, and the team-member inputs.
 *
 * IMPORTANT: this is advisory. The person saving makes the final call through the switch
 * in the recheck modal; this module just tells them what it sees. Keeping it a plain list
 * means "why does it say incomplete?" always has a visible answer.
 */

import { isSROIRowStarted } from './assessmentSnapshot.js';

export const STEP_LABELS = Object.freeze({
    1: 'ข้อมูลพื้นฐาน',
    2: 'เป้าหมาย SDGs',
    3: 'Impact Pathway และ Indicator',
    4: 'การลงพื้นที่ (Site Visit)',
    5: 'การคำนวณ SROI'
});

/** Typed fields, keyed by the same ids the form uses (so snapshot.fields[id] is the value). */
const REQUIRED_FIELDS = [
    { id: 'm_projectName',          step: 1, label: 'ชื่อโครงการ' },
    { id: 'm_support_year',         step: 1, label: 'ปีที่ได้รับการสนับสนุนโครงการ' },
    { id: 'm_project_category',     step: 1, label: 'หมวดหมู่โครงการ' },
    { id: 'm_responsible',          step: 1, label: 'ผู้รับผิดชอบโครงการ' },
    { id: 'm_department',           step: 1, label: 'หน่วยงาน' },
    { id: 'm_area',                 step: 1, label: 'พื้นที่ดำเนินการ' },

    { id: 'i_inputs',               step: 3, label: 'Inputs: แหล่งทุนและมูลค่าทรัพยากร' },
    { id: 'i_knowledge',            step: 3, label: 'Inputs: องค์ความรู้และทรัพยากรบุคคล' },
    { id: 'i_stakeholders',         step: 3, label: 'ผู้มีส่วนได้ส่วนเสีย (Stakeholders)' },
    { id: 'i_activities',           step: 3, label: 'กิจกรรม (Activities)' },
    { id: 'i_output',               step: 3, label: 'Outputs: ผลผลิตที่เกิดขึ้นโดยตรง' },
    { id: 'i_output_sdg',           step: 3, label: 'Outputs: SDGs ที่เชื่อมกับผลผลิต' },
    { id: 'i_outcome',              step: 3, label: 'Outcomes: การเปลี่ยนแปลงที่คาดหวัง' },
    { id: 'i_outcome_stakeholders', step: 3, label: 'Outcomes: ผู้มีส่วนได้ส่วนเสียที่ได้รับผลลัพธ์' },
    { id: 'i_impact_economic',      step: 3, label: 'Impacts: มิติเศรษฐกิจ' },
    { id: 'i_impact_social',        step: 3, label: 'Impacts: มิติสังคม' },
    { id: 'i_impact_environment',   step: 3, label: 'Impacts: มิติสิ่งแวดล้อม' },
    { id: 'i_toc_statement',        step: 3, label: 'Theory of Change (ถ้า...แล้ว...)' },
    { id: 'i_indicator_output',     step: 3, label: 'Indicator ของ Output' },
    { id: 'i_indicator_outcome',    step: 3, label: 'Indicator ของ Outcome' },
    { id: 'i_indicator_impact',     step: 3, label: 'Indicator ของ Impact' },

    { id: 'sv_key_takeaway',        step: 4, label: 'Focus Group: Key Takeaway' },
    { id: 'sv_quote',               step: 4, label: 'Quote จาก Focus Group Interview' }
];

/** Per SROI row. Text columns must be non-blank; "positive" columns must be > 0. */
const ROW_TEXT = [
    ['stakeholderGroup',   'กลุ่มผู้ได้รับผลกระทบ'],
    ['inputDescription',   'สิ่งที่ลงทุน/สนับสนุน'],
    ['outputSummary',      'Output เชิงตัวเลข'],
    ['changeDepth',        'จำนวน/ระดับการเปลี่ยนแปลงต่อคน'],
    ['outcomeDescription', 'Outcome description'],
    ['valuationApproach',  'Valuation approach / financial proxy'],
    ['indicatorSource',    'Indicator และแหล่งข้อมูล']
];
const ROW_POSITIVE = [
    ['groupSize',     'จำนวนคนในกลุ่มทั้งหมด'],
    ['investment',    'มูลค่าการลงทุนรวม'],
    ['quantity',      'จำนวนผู้ได้รับ outcome'],
    ['monetaryValue', 'มูลค่าต่อคนต่อปี']
];
// 1-10 per the input's own min/max; blank means "not provided".
const ROW_WEIGHTING = ['weighting', 'น้ำหนักความสำคัญ (1-10)'];

const isBlank = value => String(value ?? '').trim() === '';
const toNumber = value => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
};

/** The objectives live in one hidden field, newline-joined; any non-blank line counts. */
function hasObjective(fields) {
    return String(fields?.m_objective ?? '')
        .split(/\n+/)
        .some(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim() !== '');
}

function hasActivityPhoto(snapshot) {
    return (snapshot.activityImages ?? []).some(image => image?.src) || !!snapshot.uploadedImage;
}

/**
 * @param {object|null} snapshot  a NORMALISED snapshot (run legacy rows through
 *                                normaliseSnapshot() first)
 * @returns {{complete: boolean, total: number, filled: number,
 *            missing: Array<{step: number, label: string}>}}
 */
export function evaluateCompleteness(snapshot) {
    const snap = snapshot ?? {};
    const fields = snap.fields ?? {};
    const items = []; // { step, label, ok }
    const add = (step, label, ok) => items.push({ step, label, ok: !!ok });

    REQUIRED_FIELDS.filter(f => f.step === 1)
        .forEach(f => add(f.step, f.label, !isBlank(fields[f.id])));
    add(1, 'วัตถุประสงค์ (อย่างน้อย 1 ข้อ)', hasObjective(fields));

    add(2, 'เลือกเป้าหมาย SDGs อย่างน้อย 1 ข้อ', (snap.selectedSDGs ?? []).length > 0);

    REQUIRED_FIELDS.filter(f => f.step === 3)
        .forEach(f => add(f.step, f.label, !isBlank(fields[f.id])));

    REQUIRED_FIELDS.filter(f => f.step === 4)
        .forEach(f => add(f.step, f.label, !isBlank(fields[f.id])));
    add(4, 'ภาพกิจกรรมอย่างน้อย 1 ภาพ', hasActivityPhoto(snap));

    // Step 5. Rows nobody touched are the blank row the form hands out by default and are
    // ignored; what matters is that at least one real row exists and every real row is whole.
    const startedRows = (snap.sroiRows ?? []).filter(row => row && isSROIRowStarted(row));
    add(5, 'มีข้อมูล SROI อย่างน้อย 1 แถว', startedRows.length > 0);

    startedRows.forEach((row, index) => {
        const gaps = [
            ...ROW_TEXT.filter(([key]) => isBlank(row[key])),
            ...ROW_POSITIVE.filter(([key]) => toNumber(row[key]) <= 0),
            ...(() => {
                const w = row[ROW_WEIGHTING[0]];
                return isBlank(w) || toNumber(w) < 1 || toNumber(w) > 10 ? [ROW_WEIGHTING] : [];
            })()
        ].map(([, label]) => label);

        // One item per row (not per cell) so a long table doesn't drown the list; the
        // label names exactly what is missing in it.
        add(5,
            gaps.length
                ? `แถว SROI ที่ ${index + 1} ยังไม่ครบ: ${gaps.join(', ')}`
                : `แถว SROI ที่ ${index + 1}`,
            gaps.length === 0);
    });

    const missing = items.filter(item => !item.ok).map(({ step, label }) => ({ step, label }));
    return {
        complete: missing.length === 0,
        total: items.length,
        filled: items.length - missing.length,
        missing
    };
}
