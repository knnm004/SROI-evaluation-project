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

There is **no test framework and no linter installed** (verified via `npm ls`). Do not invent `npm test` or `npm run lint` commands. If asked to verify a change, run `npm run build` and/or drive the app in a browser.

Active development happens on the `develop` branch, not `main`.

## Environment

`sroi_evaluation_app/.env` (gitignored) must define:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Both are read via `import.meta.env` in `src/app.js` and `src/dashboard.js`. Because of the `VITE_` prefix they are inlined into the shipped bundle and are public by design — the anon/publishable key is not a secret, so database security depends entirely on Postgres RLS.

## Architecture

Vanilla JS + Vite multi-page app. No framework, no router, no client-side state library.

**Two HTML entry points**, both registered in `vite.config.js` under `build.rollupOptions.input` (without this, `dashboard.html` 404s in production):

| Page | Purpose | Scripts loaded |
|---|---|---|
| `index.html` | 6-step SROI assessment wizard (~45 KB of markup, all six steps inline as `#step-1`…`#step-6`) | `src/main.js` |
| `dashboard.html` | Lists the signed-in user's saved projects | `src/main.js` **and** `src/dashboard.js` |

**Source files** (only four, each with a distinct role):

- `src/main.js` — assigns `window.appState = appState` so the inline `onclick="appState.xxx()"` handlers throughout the HTML can reach it. This global bridge is load-bearing; the HTML has no other wiring.
- `src/app.js` — ~1600 lines. Exports the single monolithic `appState` object holding all wizard state, rendering, SROI math, and localStorage drafts, plus the Supabase auth/persistence layer at the bottom.
- `src/dashboard.js` — independent page logic for `dashboard.html`.
- `src/authConfig.js` — `ALLOWED_EMAIL_DOMAINS` allowlist shared by both pages.

**CDN globals, not bundled:** Leaflet is used as `window.L` (loaded from unpkg in `index.html`) and Font Awesome from cdnjs. Adding a Leaflet feature means relying on that global, not an import.

**Styling:** Tailwind with a custom `chula` color scale (`chula`, `chula-light`, `chula-dark`, `chula-darker`) and Sarabun as the sans font. UI copy is primarily Thai with English in parentheses.

### Wizard state model

`appState.currentStep` (1–6) drives everything; `updateStepUI()` shows the matching `#step-N` section and repaints the stepper. Step labels are hardcoded in `renderStepper()`: Metadata, I1 SDGs, I2/I3 Pathway, S1 Evidence, S2 SROI, S3 Report. `showView()` toggles between the `#view-landing` / `#view-login` / `#view-app` containers, all of which live in `index.html` only.

`appState.isViewMode = true` puts the form in read-only report mode.

### SROI calculation

`calculateSROIRow()` is the core formula, over a **hardcoded 6-year horizon**:

1. `adjustedAnnualValue = quantity × monetaryValue × (1−deadweight) × (1−displacement) × (1−attribution)`
2. Per year, apply drop-off compounding then discount to present value.
3. `sroiRatio = totalPV / investment`; `netPresentValue = totalPV − investment`.

`duration` is clamped to 1–6 and `outcomeStart: 'period-after'` shifts the stream one year later. `calculateSROI()` sums across active rows. Changing the horizon means touching the loop bound, the `duration` clamp, and `yearlyValues` array length together.

### Persistence — two incompatible shapes (important)

This is the main trap in the codebase. Drafts and saved projects use **different schemas**:

- **localStorage draft** — `collectDraft()` sweeps *every* `input/textarea/select` with an `id` into `fields`, plus `selectedSDGs`, `sdgReasons`, and the raw `sroiRows`. Autosaved on a 250 ms debounce. Keys are scoped per project: `sroi-evaluation-draft-<id|new>` via `getDraftKey()`.
- **Supabase `projects.assessment_data`** — `confirmAndSave()` writes a *hand-listed subset* of field IDs under `inputs`, plus `sroiCalculations` (the computed output).

Consequences of the mismatch:

- **Raw `sroiRows` are never persisted to Supabase** — only their computed results. A reopened project cannot reconstruct an editable SROI table, which is why `loadExistingProject()` forces `currentStep = 6` and `isViewMode = true`.
- **Map/location fields are lost on save.** `m_location_type`, bounds, and lat/lng are captured in the draft but absent from the `inputs` list in `confirmAndSave()`.
- Adding a new form field requires editing the hardcoded lists in **both** `confirmAndSave()` (`inputs`) and `loadExistingProject()` (`fieldsToRestore`). The draft path picks it up automatically; the Supabase path will not.

### Known quirks

- **`appState.init()` runs twice** on `index.html` — once from `main.js`'s `DOMContentLoaded` and again from the separate handler at the bottom of `app.js`.
- **`dashboard.html` loads `main.js`, which cannot work there.** `init()` calls `renderSDGs()`, which does `container.innerHTML` with no null guard, and none of the elements it needs (`#sdg-container`, `#view-landing`, `#stepper-container`, …) exist on that page. Both `DOMContentLoaded` handlers throw a `TypeError`; `dashboard.js`'s own listener is unaffected, so the page still works but logs errors on every load. The throw also accidentally suppresses `app.js`'s "no `?id`/`?new` param → redirect to `/dashboard.html`" branch. **Adding null guards to `init()` would un-suppress that and cause a self-redirect loop on `dashboard.html`** — remove the `main.js` script tag from `dashboard.html` instead.

## Auth and data-access model

Google OAuth via Supabase, redirecting to `/dashboard.html`. `index.html` sends unauthenticated visitors to the landing view; requests with neither `?id=` nor `?new=` are bounced to the dashboard.

The domain restriction to `chula.ac.th` / `student.chula.ac.th` is checked client-side via `isEmailDomainAllowed()` after `getSession()` on both pages. Treat that check as a UX affordance, not a security control — the publishable key ships in the bundle, so the REST API is reachable without loading this JS. Server-side enforcement lives in `supabase/migrations/` (see below). Google's `hd` OAuth param was deliberately removed: it accepts only one domain and is explicitly not a security control per Google's docs.

### `public.projects` schema

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key; appears in URLs as `?id=` |
| `user_email` | `text` | Owner. **No `user_id` column exists**, so ownership keys on the JWT email claim, not `auth.uid()`. |
| `project_name` | `text` | Denormalised copy of `m_projectName` |
| `last_page_url` | `text` | Written on save; not currently read back |
| `created_at` | `timestamptz` | |
| `assessment_data` | `jsonb` | `{ currentStep, sroiCalculations, inputs }` — see the persistence mismatch above |

### Security state as of 2026-07-27

`supabase/migrations/` holds the server-side enforcement. **These files are written but not yet applied** — verify against the live project before assuming they are in effect:

- `0001_projects_rls.sql` — replaces the permissive "always true" policy flagged by Security Advisor with per-operation ownership + domain policies on `authenticated`. Includes a read-only pre-flight query for rows that would become orphaned.
- `0002_signup_domain_hook.sql` — Before User Created auth hook rejecting non-allowlisted domains at signup. **Requires wiring in Dashboard → Authentication → Hooks**; the SQL alone does nothing.

`public.is_allowed_email_domain(text)` in `0001` is the single source of truth for the domain list, shared by the RLS policies and the signup hook. The hardcoded array in `src/authConfig.js` duplicates it for the client-side UX check — **keep the two in sync when adding a domain.**

Already fixed in the client: the update path in `saveProjectData()` and the delete path in `dashboard.js` now both scope by `user_email` and treat a zero-row result as failure. These filters are defence in depth and readability, not enforcement — RLS is what actually stops a forged request.

Still open: the signup hook only fires at account creation, so any non-allowlisted account already in `auth.users` can still authenticate. RLS denies it access to all data, which is why the riskier Custom Access Token hook was deliberately left out (a bug in it locks out every user, including you) — reasoning is recorded at the bottom of `0002`.
