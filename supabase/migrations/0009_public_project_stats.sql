-- 0009_public_project_stats.sql
--
-- Adds get_public_project_stats(), the aggregate-only function behind the "project
-- overview" section of the PUBLIC landing page (index.html, shown before sign-in).
--
-- WHY A FUNCTION: RLS (0005_rls_v2.sql) blocks anonymous reads of public.projects, so
-- the landing page cannot just query the table. This SECURITY DEFINER function reads
-- it on the caller's behalf and returns COUNTS ONLY -- never a project name, owner,
-- email, id, or any assessment content. That is the whole privacy boundary, so keep
-- it that way: do not add per-project fields to this result.
--
-- WHAT IT RETURNS (jsonb):
--   total          projects in the system
--   uncategorized  projects with no m_project_category yet
--   by_category    { "<category title>": n }               projects per category
--   by_sdg         { "1": n, ... "17": n }                 projects per SDG
--   matrix         { "<category>": { "<sdg>": n } }        projects per category AND sdg
-- A project that selected several SDGs is counted once under each (by_sdg values can
-- therefore add up to more than total); within one SDG it is only ever counted once.
--
-- SHAPES READ (see src/lib/assessmentSnapshot.js):
--   current:  assessment_data.fields.m_project_category, assessment_data.selectedSDGs
--   legacy v1: assessment_data.inputs.sdgs (selectedSDGs did not exist yet)
-- SDG entries are strings like 'SDG 4: การศึกษาที่มีคุณภาพ'; the number is parsed out.
--
-- Apply via the Supabase Dashboard's SQL Editor, the same way 0008 was.

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
