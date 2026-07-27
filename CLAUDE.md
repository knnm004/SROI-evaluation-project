# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `sroi_evaluation_app/`, not the repo root.

```bash
cd sroi_evaluation_app
npm install
npm run dev        # Vite dev server
npm run build      # production build -> dist/
npm run preview    # serve the built dist/
```

There is **no test framework and no linter installed** (verified via `npm ls`). Do not invent `npm test` or `npm run lint`. To verify a change, run `npm run build` and drive the app in a browser.

Active development happens on the `develop` branch, not `main`.

## Environment

`sroi_evaluation_app/.env` (gitignored) must define:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Read via `import.meta.env` in `src/lib/supabaseClient.js` only. The `VITE_` prefix inlines them into the shipped bundle, which is by design — the publishable key is not a secret. Database security therefore rests **entirely** on Postgres RLS.

## Architecture

Vanilla JS + Vite multi-page app. No framework, no router, no state library.

**Three HTML entry points.** Each must be registered in **two** places or it breaks in production only:

| Page | Purpose | Script |
|---|---|---|
| `index.html` | 6-step assessment wizard (~50 KB, steps inline as `#step-1`…`#step-6`) plus `#view-landing` / `#view-login` | `src/main.js` |
| `dashboard.html` | The signed-in user's projects (own + shared) | `src/dashboard.js` |
| `admin.html` | Admin-only list of every project | `src/admin.js` |

- `vite.config.js` → `build.rollupOptions.input` — omit it and the page 404s in production (commit `3b86e68` fixed exactly this for `dashboard.html`).
- `tailwind.config.js` → `content` — an explicit list, not a glob. Omit it and the page builds fine but ships **unstyled**, visible only in production because dev does not purge.

**Source layout:**

- `src/main.js` — loaded by `index.html` only. Assigns `window.appState = appState` so the inline `onclick="appState.xxx()"` handlers throughout the HTML can reach it. This global bridge is load-bearing. Also imports `style.css`.
- `src/app.js` — ~2000 lines. The monolithic `appState` object: wizard state, rendering, SROI maths, drafts, auth wiring, and the Supabase persistence layer at the bottom.
- `src/dashboard.js`, `src/admin.js` — independent page logic; each imports `style.css` itself.
- `src/lib/` — shared modules:
  - `supabaseClient.js` — the single client for all pages
  - `session.js` — `loadIdentity()` (memoised), sign-in/out
  - `permissions.js` — pure role logic, no DOM or network
  - `format.js` — `escapeHTML`, money/number, Thai date-time, `formatUpdatedMeta`
  - `assessmentSnapshot.js` — the one canonical save/load shape

`escapeHTML`, `formatMoney` and `formatNumber` are re-attached to `appState` as methods so the many `this.escapeHTML(...)` calls inside its template strings keep working.

**CDN globals, not bundled:** Leaflet is `window.L` (unpkg, in `index.html`); Font Awesome from cdnjs. A new Leaflet feature uses that global, not an import.

**Styling:** Tailwind with a custom `chula` scale (`chula`, `chula-light`, `chula-dark`, `chula-darker`) and Sarabun. UI copy is Thai-first with English in parentheses.

### Wizard state model

`appState.currentStep` (1–6) drives everything; `updateStepUI()` reveals `#step-N`, repaints the stepper, and calls `generateReport()` on step 6. Step labels are hardcoded in `renderStepper()`. `showView()` toggles `#view-landing` / `#view-login` / `#view-app`, which exist in `index.html` only.

`appState.isViewMode = true` is read-only mode. **Permission may only tighten it, never loosen it** — see `applyProjectAccess()`.

### SROI calculation

`calculateSROIRow()` over a **hardcoded 6-year horizon**:

1. `adjustedAnnualValue = quantity × monetaryValue × (1−deadweight) × (1−displacement) × (1−attribution)`
2. Per year: drop-off compounding, then discount to present value.
3. `sroiRatio = totalPV / investment`; `netPresentValue = totalPV − investment`.

`duration` clamps to 1–6; `outcomeStart: 'period-after'` shifts the stream one year later. Changing the horizon means touching the loop bound, the `duration` clamp, and the `yearlyValues` length together.

### Persistence — one canonical shape

`src/lib/assessmentSnapshot.js` is the single reader/writer. localStorage drafts and `projects.assessment_data` use the **same** shape, so a new form field is picked up automatically by both — there are no longer any hardcoded field lists to update.

- `serialiseAssessment(state)` — sweeps every `input/textarea/select` with an id inside `#view-app`, plus SDG selections, SDG reasons, raw `sroiRows`, and the uploaded image. Excludes `TRANSIENT_FIELD_IDS` (`sdg-search`, `member-email-input`).
- `deserialiseAssessment(snapshot, state)` — restores all of it, including rebuilding the Leaflet map from the restored coordinate fields.
- `normaliseSnapshot(raw)` — upgrades the pre-2026-07 shape (`{ inputs, sroiCalculations }`) and **recovers raw SROI rows from `sroiCalculations.rows[].row`**. Do not remove this: without it a legacy project loads with an empty SROI table and the next save writes zeros over real results.
- `buildProjectPayload(state)` — snapshot + computed `sroiCalculations` (derived, ignored on load).

Bump `SNAPSHOT_VERSION` and extend `normaliseSnapshot()` when changing the shape.

**Fixed here, worth not reintroducing:** `nextStep()` used to call `saveProjectData({projectName, currentStep})` on every step advance, overwriting the whole `assessment_data` column. It now saves a local draft only; server writes happen exclusively in `confirmAndSave()`.

### Known quirks

- **`appState.init()` runs twice** on `index.html` — from `main.js`'s `DOMContentLoaded` and again from the handler at the bottom of `app.js`. Harmless but wasteful; left alone deliberately.
- Six field IDs that older saved rows contain (`i_manpower`, `i_budget`, `i_impact`, `c_outcome_value`, `c_base_case`, `c_investment`) **do not exist in the markup**. They restore to nothing and are skipped. Existing projects are emptier than they look because the old save path never captured most fields.
- `#project-title-chip` and `#draft-status` live inside a commented-out block, so `setText()` on them is a silent no-op.

## Auth and data-access model

Two ways in, both landing on `/dashboard.html`:

1. **Google OAuth** — Chula staff and students.
2. **Email + password** — สมาชิก/บุคคลทั่วไป. Accounts are created by hand; there is deliberately **no signup and no forgot-password**.

**Access comes from having a `user_profiles` row, not from an email domain.** `loadIdentity()` signs out anyone without one. The old `isEmailDomainAllowed()` gate and `src/authConfig.js` are gone — they made non-Chula member accounts impossible. Email domain now governs only who may *create* an account (`0007`'s signup hook).

Google's `hd` parameter is not used: it accepts a single domain and Google's docs state it is not a security control.

### Roles and permissions

Roles live in `public.user_profiles.role` — change one by editing that field in the Supabase table editor.

| | see | edit | delete | add researchers | admin page |
|---|---|---|---|---|---|
| `admin` | all | all | all | all | yes |
| `researcher` | own + shared | yes | own only | own projects | no |
| `member` | own + shared | yes | own only | own projects | no |

`researcher` and `member` have identical rights; the label records which kind of account it is. New signups are seeded `researcher` for Chula domains, `member` otherwise. Nobody becomes `admin` automatically.

`src/lib/permissions.js` mirrors the RLS policies **for UI shaping only** — it decides which buttons render. Change a rule there and you must change `0005` too.

### Schema

`public.projects` — `id`, `user_email` (owner address, kept as a readable fallback), `project_name`, `last_page_url`, `created_at`, `assessment_data` (jsonb), `owner_id`, `updated_at`, `updated_by`, `updated_by_email`, `revision`.

| Table | Holds |
|---|---|
| `user_profiles` | one row per person: email, display name, role |
| `project_members` | extra researchers. **The owner is NOT listed here** — ownership is `projects.owner_id`, one fact in one place |
| `project_invitations` | people added by email before they ever signed in; converted to memberships at first sign-in |
| `approved_signup_emails` | non-Chula addresses pre-approved for an account |

`updated_at` / `updated_by` / `updated_by_email` / `revision` are set by the `projects_set_audit_fields` trigger and **ignored if sent by the client** — a browser can claim to be anyone.

### Migrations (`supabase/migrations/`)

All applied as of 2026-07-28.

| File | Purpose |
|---|---|
| `0001_projects_rls.sql` | interim owner-only policies; replaced the permissive "always true" policy |
| `0002_…(achives).sql` | **archived, never applied** — superseded by `0007` |
| `0003_collaboration_schema.sql` | the four tables, new columns, audit + new-user triggers |
| `0004_backfill_owner.sql` | profiles for existing accounts; `owner_id` from `user_email` |
| `0005_rls_v2.sql` | the real policies + `add_project_researcher` / `remove_project_researcher` RPCs |
| `0007_signup_hook_v2.sql` | signup gate: Chula domain OR pre-approved email |

**Two constraints that will bite if forgotten:**

1. **Never enable `FORCE ROW LEVEL SECURITY`** on `projects`, `project_members`, `user_profiles`, or `project_invitations`. The policies are mutually recursive by nature (a rule on `projects` reads `project_members` and vice versa) and are only safe because `can_access_project()` / `can_manage_project()` / `is_admin()` are `SECURITY DEFINER` and thus exempt from RLS. `FORCE` re-subjects them and the recursion returns as error `42P17`. `0005` asserts this before creating any policy.
2. **`user_profiles` has no UPDATE policy, on purpose.** If users could edit their own row they would set `role = 'admin'` and gain every project. Roles change only through the table editor or `0004` STEP 4.

Adding a researcher goes through `add_project_researcher(project_id, email)` rather than a plain insert: the browser has no privileges on `auth.users`, so resolving an email to a user id must happen server-side. It authorises the caller *before* reading anything, and falls back to `project_invitations` when no account exists.

Adding a member account has a required order: insert into `approved_signup_emails` **first**, then create the user. Removing an allowlist row does **not** revoke access — the hook only runs at account creation, so an existing account keeps signing in; delete the user to actually cut them off.

### Unverified

- Whether the Before User Created hook fires for accounts created by hand in the dashboard. The allowlist-first order is correct either way.
- Whether `create trigger on auth.users` succeeded in this project. `session.js` calls `ensure_own_profile()` as a self-healing fallback, so a missing profile row repairs itself on first sign-in.
