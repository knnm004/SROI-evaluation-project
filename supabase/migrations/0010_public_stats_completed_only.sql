-- 0010_public_stats_completed_only.sql
--
-- Replaces get_public_project_stats() (0009) so the landing page's project overview counts
-- ONLY projects whose owner confirmed "กรอกข้อมูลครบถ้วนแล้ว" at the recheck-and-save screen.
-- Half-finished projects no longer inflate the public numbers.
--
-- WHAT "COMPLETED" MEANS HERE: assessment_data.completion.declaredComplete = true, the
-- switch the person confirms when saving (written by src/lib/assessmentSnapshot.js).
-- Deliberately the person's own declaration, not a server-side re-check of every field:
-- that check lives in src/lib/completeness.js and is advisory (someone may rightly mark a
-- project complete with a field that doesn't apply to them), and duplicating its rules in
-- SQL would mean two definitions that drift apart.
--   * declaredComplete = false  -> not counted
--   * declaredComplete = null / missing (projects saved before the switch existed, or
--     never confirmed) -> not counted until someone re-saves and confirms.
--
-- Everything else is exactly as 0009: aggregate COUNTS ONLY -- never a project name, owner,
-- email, id or content -- granted to anon because the landing page is public. Keep it that
-- way: do not add per-project fields to this result.
--
-- Result shape is unchanged (so no frontend change is needed for the numbers themselves):
--   total, uncategorized, by_category, by_sdg, matrix
-- where every figure is now over completed projects only.
--
-- Apply via the Supabase Dashboard's SQL Editor, the same way 0008 and 0009 were.

create or replace function public.get_public_project_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with base as (
        select
            nullif(btrim(coalesce(assessment_data -> 'fields' ->> 'm_project_category', '')), '') as category,
            coalesce((
                select array_agg(distinct (regexp_match(val, '^SDG\s*(\d+)'))[1]::int)
                from jsonb_array_elements_text(
                    case
                        when jsonb_typeof(assessment_data -> 'selectedSDGs') = 'array'
                            then assessment_data -> 'selectedSDGs'
                        when jsonb_typeof(assessment_data -> 'inputs' -> 'sdgs') = 'array'
                            then assessment_data -> 'inputs' -> 'sdgs'
                        else '[]'::jsonb
                    end
                ) as val
                where val ~ '^SDG\s*\d+'
            ), '{}'::int[]) as sdgs
        from public.projects
        -- Compared as JSON, not text: ->> would turn the JSON *string* "true" into the same
        -- text as the boolean true, and the dashboard (which only trusts a real boolean)
        -- would then disagree with this count. A missing key gives NULL, so unconfirmed
        -- and legacy rows fall out here without a separate case.
        where (assessment_data -> 'completion' -> 'declaredComplete') = 'true'::jsonb
    ),
    by_cat as (
        select category, count(*) as n
        from base
        where category is not null
        group by category
    ),
    by_sdg as (
        select s as sdg, count(*) as n
        from base, unnest(sdgs) as s
        group by s
    ),
    matrix_rows as (
        select category, s as sdg, count(*) as n
        from base, unnest(sdgs) as s
        where category is not null
        group by category, s
    ),
    matrix as (
        select category, jsonb_object_agg(sdg::text, n) as sdg_counts
        from matrix_rows
        group by category
    )
    select jsonb_build_object(
        'total',         (select count(*) from base),
        'uncategorized', (select count(*) from base where category is null),
        'by_category',   coalesce((select jsonb_object_agg(category, n) from by_cat), '{}'::jsonb),
        'by_sdg',        coalesce((select jsonb_object_agg(sdg::text, n) from by_sdg), '{}'::jsonb),
        'matrix',        coalesce((select jsonb_object_agg(category, sdg_counts) from matrix), '{}'::jsonb)
    );
$$;

revoke all on function public.get_public_project_stats() from public;
-- anon on purpose: the landing page is viewed before anyone signs in.
grant execute on function public.get_public_project_stats() to anon, authenticated;
