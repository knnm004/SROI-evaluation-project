/**
 * Pure helpers for step 5's SROI rows that depend on what step 3 (the impact pathway) holds.
 *
 *   - Cost is project-level: the sum of the funding sources listed under Inputs in step 3.
 *     One investment can serve several stakeholder groups, so rows no longer carry their own.
 *   - A row's quantity ("who received the outcome") is the total head-count of the
 *     stakeholder groups ticked on the row, read from step 3, instead of being typed again.
 *   - Deadweight, displacement, attribution and drop-off can be entered as a percentage or as a
 *     number of units (same unit as the quantity); either way they end up as a 0..1 fraction.
 *
 * No DOM and no network, so the form (app.js) and the completeness check agree on the maths.
 * Rows saved before these rules (no stakeholderIds, own investment/quantity) keep their values:
 * a row with no ticked stakeholders falls back to its own stored quantity, and a project with
 * no funding listed in step 3 falls back to the sum of the rows' own investments.
 */

import { totalFundAmount } from './pathwayData.js';

export const ADJUSTMENT_FIELDS = ['deadweight', 'displacement', 'attribution', 'dropoff'];

const toNumber = value => {
    const n = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
};

/** Head-count of the ticked stakeholder groups that still exist in step 3. */
export function stakeholderQuantity(stakeholderIds, pathway) {
    const wanted = new Set(stakeholderIds ?? []);
    return (pathway?.stakeholders ?? [])
        .filter(row => wanted.has(row.id))
        .reduce((sum, row) => sum + Math.max(0, toNumber(row.count)), 0);
}

/** The quantity a row is calculated with: derived from ticked stakeholders, else its own legacy value. */
export function rowQuantity(row, pathway) {
    const ids = row?.stakeholderIds ?? [];
    if (ids.length) return stakeholderQuantity(ids, pathway);
    return Math.max(0, toNumber(row?.quantity));
}

/** Project cost: step 3's funding total, or (old projects) the sum of the rows' own investments. */
export function projectInvestment(rows, pathway) {
    const fromPathway = totalFundAmount(pathway?.inputs);
    if (fromPathway > 0) return fromPathway;
    return (rows ?? []).reduce((sum, row) => sum + Math.max(0, toNumber(row?.investment)), 0);
}

/**
 * One adjustment as a fraction 0..1. Percent mode: value / 100. Number mode: value / quantity
 * (a number of units out of everyone who received the outcome). Always clamped to 0..1.
 */
export function adjustmentFraction(row, field, quantity) {
    const value = toNumber(row?.[field]);
    const mode = row?.[`${field}Mode`] === 'number' ? 'number' : 'percent';
    const fraction = mode === 'number' ? (quantity > 0 ? value / quantity : 0) : value / 100;
    return Math.max(0, Math.min(1, fraction));
}
