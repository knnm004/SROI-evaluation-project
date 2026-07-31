/**
 * One canonical shape for a saved assessment.
 *
 * Before this module there were FOUR disagreeing readers/writers:
 *   - collectDraft()          swept every field, saved raw sroiRows -> localStorage
 *   - loadDraft()             restored that shape
 *   - confirmAndSave()        wrote a hand-listed subset under `inputs` -> Supabase
 *   - loadExistingProject()   restored a hand-listed `fieldsToRestore`
 *
 * The two hand-written lists had drifted badly: six of their field IDs
 * (i_manpower, i_budget, i_impact, c_outcome_value, c_base_case, c_investment)
 * no longer exist in index.html, while ~14 real fields, every map/location field,
 * and the entire raw SROI table were never persisted to the database at all.
 * That is why reopening a saved project produced a read-only, mostly empty report:
 * there was nothing complete enough to edit.
 *
 * Now: localStorage drafts and database rows use the SAME shape, produced by one
 * reader and consumed by one writer, so they cannot drift again.
 */

/** Bump when the shape changes, and extend normaliseSnapshot() to upgrade it. */
export const SNAPSHOT_VERSION = 2;

/**
 * Fields inside #view-app that are UI state, not project data.
 *
 * The login inputs live in #view-login and are excluded structurally by the scoped
 * selector. These two sit inside #view-app and so must be named:
 *   sdg-search          - the SDG filter box
 *   member-email-input  - the "add a researcher" box; a half-typed colleague's
 *                         address must never be persisted into the assessment
 */
const TRANSIENT_FIELD_IDS = new Set(['sdg-search', 'member-email-input']);

/**
 * Read the whole form into a plain object. The ONLY reader.
 * @param {object} state - the appState object (for sroiRows, currentStep, uploadedImage)
 */
export function serialiseAssessment(state) {
    const fields = {};
    document
        .querySelectorAll('#view-app input[id], #view-app textarea[id], #view-app select[id]')
        .forEach(element => {
            if (element.type === 'file' || element.type === 'checkbox') return;
            if (element.dataset.sroiRow) return; // SROI inputs are rebuilt from state.sroiRows
            if (TRANSIENT_FIELD_IDS.has(element.id)) return;
            fields[element.id] = element.value;
        });

    const sdgReasons = {};
    document.querySelectorAll('.sdg-reason').forEach(note => {
        sdgReasons[note.dataset.sdgId] = note.value;
    });

    return {
        version: SNAPSHOT_VERSION,
        currentStep: state.currentStep,
        fields,
        selectedSDGs: Array.from(document.querySelectorAll('.sdg-checkbox:checked'), cb => cb.value),
        sdgReasons,
        sroiRows: state.sroiRows,
        uploadedImage: state.uploadedImage ?? null,
        savedAt: new Date().toISOString()
    };
}

/**
 * Write a snapshot back into the form. The ONLY writer.
 * Pass snapshots through normaliseSnapshot() first.
 * @returns {{currentStep: number}} the step the snapshot was saved on
 */
export function deserialiseAssessment(snapshot, state) {
    if (!snapshot) return { currentStep: 1 };

    // SROI rows first: renderSROIRows() replaces the rows container, so restoring
    // fields before this point would have their values discarded.
    if (Array.isArray(snapshot.sroiRows) && snapshot.sroiRows.length > 0) {
        state.sroiRows = snapshot.sroiRows.map(row => state.createSROIRow(row));
        state.renderSROIRows();
    }

    // Unknown IDs (e.g. fields removed from the markup since the row was saved)
    // resolve to null and are skipped.
    Object.entries(snapshot.fields ?? {}).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element && element.type !== 'file') element.value = value;
    });

    const selected = new Set(snapshot.selectedSDGs ?? []);
    document.querySelectorAll('.sdg-checkbox').forEach(cb => {
        cb.checked = selected.has(cb.value);
    });
    state.updateSelectedSDGs();

    Object.entries(snapshot.sdgReasons ?? {}).forEach(([sdgId, value]) => {
        const note = document.querySelector(`.sdg-reason[data-sdg-id="${CSS.escape(sdgId)}"]`);
        if (note) note.value = value;
    });

    if (snapshot.uploadedImage) {
        state.uploadedImage = snapshot.uploadedImage;
        const preview = document.getElementById('photo-preview');
        if (preview) {
            preview.src = snapshot.uploadedImage;
            preview.classList.remove('hidden');
            document.getElementById('photo-placeholder')?.classList.add('hidden');
        }
    }

    state.filterSDGs();

    // Rebuild the map from the restored lat/lng/bounds fields. Without this the
    // location fields hold values but the map shows nothing.
    state.setMapSelectionMode(state.getValue('m_location_type') || 'pin', false);
    state.syncAreaMarkerFromFields();
    state.updateAreaLocationUI();

    return { currentStep: Number(snapshot.currentStep) || 1 };
}

/**
 * Upgrade an older saved shape to the current one.
 *
 * v1 (what confirmAndSave used to write) looked like:
 *   { currentStep, sroiCalculations, inputs: { m_projectName, ..., sdgs, uploadedImage } }
 *
 * Raw SROI rows were never stored in v1 -- but they are RECOVERABLE, because
 * calculateSROIRow() returns `{ row, ...computed }` and the whole result array was
 * serialised into sroiCalculations. So each original row survives at
 * sroiCalculations.rows[i].row.
 *
 * This recovery is not optional: without it a legacy project loads with an empty
 * SROI table, the report shows a ratio of 0.00, and the next save would overwrite
 * the real stored numbers with zeros.
 */
export function normaliseSnapshot(raw) {
    if (!raw) return null;
    if (Number(raw.version) >= 2) return raw;

    const { sdgs = [], uploadedImage = null, ...legacyFields } = raw.inputs ?? {};

    const recoveredRows = Array.isArray(raw.sroiCalculations?.rows)
        ? raw.sroiCalculations.rows.map(result => result?.row).filter(Boolean)
        : [];

    return {
        version: SNAPSHOT_VERSION,
        currentStep: raw.currentStep ?? 6,
        fields: legacyFields,
        selectedSDGs: Array.isArray(sdgs) ? sdgs : [],
        sdgReasons: {},
        sroiRows: recoveredRows,
        uploadedImage,
        savedAt: raw.savedAt ?? null,
        migratedFrom: 1
    };
}

/**
 * The database payload: the snapshot plus the computed results.
 *
 * sroiRows stays the single source of truth -- sroiCalculations is derived, stored
 * only so SQL and the admin page can read a project's ratio without re-running the
 * maths in JS, and deliberately ignored on load.
 */
export function buildProjectPayload(state) {
    return {
        ...serialiseAssessment(state),
        sroiCalculations: state.calculateSROI()
    };
}

/**
 * Is there anything in this snapshot worth offering to resume?
 *
 * Used only for the dashboard's "continue draft / start new" prompt on the never-
 * saved-project draft (getDraftKey()'s 'new' slot) -- an autosave can fire on trivial
 * interaction (e.g. filtering the SDG list) and leave a technically-non-null but
 * empty draft behind, which should not trigger the prompt.
 */
const parseNumberValue = value => parseFloat(value) || 0;

/**
 * Has anything actually been typed into this SROI row, vs. it still being the blank
 * row createSROIRow() hands out by default? Shared with appState.isSROIRowStarted()
 * so "started" means the same thing whether it's driving the SROI calculation or the
 * dashboard's draft-resume prompt.
 */
export function isSROIRowStarted(row) {
    const textFields = [
        'stakeholderGroup',
        'inputDescription',
        'outputSummary',
        'changeDepth',
        'weighting',
        'outcomeDescription',
        'valuationApproach',
        'indicatorSource'
    ];
    const moneyFields = ['groupSize', 'investment', 'quantity', 'monetaryValue'];
    const adjustmentFields = ['deadweight', 'displacement', 'attribution', 'dropoff'];

    return textFields.some(field => String(row[field] ?? '').trim())
        || moneyFields.some(field => parseNumberValue(row[field]) > 0)
        || adjustmentFields.some(field => parseNumberValue(row[field]) > 0)
        || parseNumberValue(row.duration) !== 1
        || parseNumberValue(row.discountRate) !== 3.5
        || row.outcomeStart !== 'period-activity';
}

export function hasMeaningfulContent(snapshot) {
    if (!snapshot) return false;
    if ((snapshot.selectedSDGs ?? []).length > 0) return true;
    if (snapshot.uploadedImage) return true;
    if ((snapshot.sroiRows ?? []).some(isSROIRowStarted)) return true;
    return Object.values(snapshot.fields ?? {}).some(value => String(value ?? '').trim() !== '');
}
