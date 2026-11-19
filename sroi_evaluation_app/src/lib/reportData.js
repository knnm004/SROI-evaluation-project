/**
 * Pure helpers for the step-6 report (no DOM, no network): the few numbers the report shows that
 * the SROI calculation does not hand over ready-made, plus small text helpers.
 *
 * The report pages themselves are built in reportPages.js from a plain "report model" that
 * appState.collectReportModel() assembles out of what steps 1-5 hold.
 */

/** Official UN SDG colours (same palette as the landing page's overview). */
export const SDG_COLORS = {
    1: '#E5243B', 2: '#DDA63A', 3: '#4C9F38', 4: '#C5192D', 5: '#FF3A21', 6: '#26BDE2',
    7: '#FCC30B', 8: '#A21942', 9: '#FD6925', 10: '#DD1367', 11: '#FD9D24', 12: '#BF8B2E',
    13: '#3F7E44', 14: '#0A97D9', 15: '#56C02B', 16: '#00689D', 17: '#19486A'
};

/**
 * What one outcome row would be worth WITHOUT the base-case adjustments (deadweight, displacement,
 * attribution), in present value: same quantity, unit value, duration, start year, drop-off and
 * discount rate as the row's own calculation (calculateSROIRow), so
 *     grossPresentValue - row.totalPV  =  the value those three adjustments take away.
 * `result` is one entry of calculateSROI().rows.
 */
export function grossPresentValue(result) {
    const annual = result.quantity * result.monetaryValue;
    let total = 0;
    for (let year = 0; year < 6; year += 1) {
        const active = year - result.startOffset;
        if (active < 0 || active >= result.duration) continue;
        total += (annual * Math.pow(1 - result.dropoff, active)) / Math.pow(1 + result.discountRate, year);
    }
    return total;
}

/**
 * Everything the report's result cards need, derived from calculateSROI():
 *   investment      project cost (paid at year 0)
 *   grossPV         present value before the base-case adjustments
 *   baseCase        what those adjustments remove  (grossPV - totalPV)
 *   totalPV         present value after them
 *   netBenefit      totalPV - investment  (the SROI step's net present value)
 *   ratio           totalPV / investment
 *   irr             internal rate of return as a fraction, or null when it does not exist
 */
export function summariseResults(calc) {
    const grossPV = calc.rows.reduce((sum, row) => sum + grossPresentValue(row), 0);
    const flows = calc.benefitYearly.map((benefit, year) => benefit - (year === 0 ? calc.investment : 0));
    return {
        investment: calc.investment,
        grossPV,
        baseCase: Math.max(0, grossPV - calc.totalPV),
        totalPV: calc.totalPV,
        netBenefit: calc.netPresentValue,
        ratio: calc.sroiRatio,
        irr: internalRateOfReturn(flows)
    };
}

/**
 * Internal rate of return of yearly net cash flows (index = year), by bisection.
 * Returns null unless the flows change sign (no IRR exists for all-cost or all-benefit streams).
 */
export function internalRateOfReturn(flows) {
    const npv = rate => flows.reduce((sum, flow, year) => sum + flow / Math.pow(1 + rate, year), 0);
    const hasLoss = flows.some(flow => flow < 0);
    const hasGain = flows.some(flow => flow > 0);
    if (!hasLoss || !hasGain) return null;

    let low = -0.99;
    let high = 100; // 10,000 %: beyond any realistic project
    if (npv(low) * npv(high) > 0) return null;
    for (let step = 0; step < 200; step += 1) {
        const mid = (low + high) / 2;
        if (npv(low) * npv(mid) <= 0) high = mid; else low = mid;
    }
    const rate = (low + high) / 2;
    return Number.isFinite(rate) ? rate : null;
}

/** Cut text to at most `max` characters (on a word-ish boundary when possible), adding "…". */
export function clipText(value, max) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** A textarea's content as bullet lines: one per non-blank line, list markers removed. */
export function textLines(value) {
    return String(value ?? '')
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
        .filter(Boolean);
}

/** A file name that is safe on every OS but keeps Thai: no path or reserved characters. */
export function safeFileName(value, fallback = 'SROI') {
    const cleaned = String(value ?? '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
        .trim();
    return cleaned || fallback;
}
