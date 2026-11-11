-- 0012_financial_proxy_submissions.sql
--
-- Two changes to the financial-proxy library from 0009:
--
-- 1. financial_proxy_library.category now holds a stable KEY (medical, agriculture,
--    ...) instead of a free-text Thai label, so step 5's category dropdown can filter
--    on it. Fresh installs already get keys from the 0009 seed; the UPDATE below only
--    matters if 0009 was applied BEFORE the keys change, and is a no-op otherwise.
--
-- 2. public.financial_proxy_submissions: proxies that users type in themselves when
--    the indicator they need isn't in the library. Deliberately a SEPARATE table --
--    nothing a user submits ever reaches the curated library directly. An admin
--    screens the rows later (Supabase Dashboard table editor for now): good ones are
--    copied into financial_proxy_library by hand, then the submission is deleted.
--
--    Users can insert and nothing else: they cannot read back, edit, or delete
--    submissions (not even their own), so there is no way to browse other people's
--    pending entries. Only admins can read/update/delete.
--
-- Apply via the Supabase Dashboard's SQL Editor, after 0009. Assumes
-- public.is_admin() already exists in the live database (see 0008's note).

update public.financial_proxy_library
set category = case category
    when 'ปศุสัตว์/อาหาร' then 'agriculture'
    when 'เกษตรกรรม' then 'agriculture'
    when 'แพลตฟอร์มออนไลน์' then 'economy'
    when 'เศรษฐกิจมหภาค' then 'economy'
    when 'ศิลปะการแสดง' then 'arts_culture'
    when 'สิ่งแวดล้อม/เศรษฐกิจหมุนเวียน' then 'environment'
    when 'แรงงาน/ค่าจ้าง' then 'labor'
    when 'ค่าใช้จ่ายราชการ (ฝึกอบรม/เดินทาง)' then 'training'
    when 'สวัสดิการสังคม' then 'social_welfare'
    when 'การศึกษา' then 'education'
    when 'สาธารณสุข' then 'medical'
    when 'สุขภาพจิต' then 'mental_health'
    else category
end
where category in (
    'ปศุสัตว์/อาหาร', 'เกษตรกรรม', 'แพลตฟอร์มออนไลน์', 'เศรษฐกิจมหภาค', 'ศิลปะการแสดง',
    'สิ่งแวดล้อม/เศรษฐกิจหมุนเวียน', 'แรงงาน/ค่าจ้าง', 'ค่าใช้จ่ายราชการ (ฝึกอบรม/เดินทาง)',
    'สวัสดิการสังคม', 'การศึกษา', 'สาธารณสุข', 'สุขภาพจิต'
);

create table if not exists public.financial_proxy_submissions (
    id uuid primary key default gen_random_uuid(),
    indicator_th text not null,
    category text not null default 'other',
    proxy_type text not null default 'other' check (proxy_type in (
        'market_price',
        'willingness_to_pay',
        'avoided_cost',
        'wage_rate',
        'government_rate',
        'benchmark_transfer',
        'advertising_value_equivalent',
        'other'
    )),
    amount numeric not null check (amount >= 0),
    -- The "per x" the user typed (e.g. 'กก.', 'ครัวเรือน'); the amount is in baht.
    unit text not null,
    -- How the user derived the number / where it came from. Optional, but what the
    -- screener needs most.
    source_note text,
    submitted_by uuid not null default auth.uid() references auth.users(id),
    submitted_by_email text default (auth.jwt() ->> 'email'),
    created_at timestamptz not null default now()
);

comment on table public.financial_proxy_submissions is
    'User-entered financial proxies awaiting admin screening (step 5 "other / enter your own"). Insert-only for users; admins read, promote into financial_proxy_library by hand, then delete.';

-- Never FORCE this -- project-wide rule, see CLAUDE.md.
alter table public.financial_proxy_submissions enable row level security;

create policy financial_proxy_submissions_insert_own
    on public.financial_proxy_submissions
    for insert
    to authenticated
    with check (submitted_by = auth.uid());

create policy financial_proxy_submissions_select_admin
    on public.financial_proxy_submissions
    for select
    to authenticated
    using (public.is_admin());

create policy financial_proxy_submissions_update_admin
    on public.financial_proxy_submissions
    for update
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy financial_proxy_submissions_delete_admin
    on public.financial_proxy_submissions
    for delete
    to authenticated
    using (public.is_admin());
