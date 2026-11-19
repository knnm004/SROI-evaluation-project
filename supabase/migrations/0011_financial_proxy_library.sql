-- 0011_financial_proxy_library.sql
--
-- Adds public.financial_proxy_library: the first real relational reference-data
-- table in this schema (every other table is identity/access-control, or an
-- opaque assessment_data jsonb blob on public.projects -- see CLAUDE.md's Schema
-- section). Read-only reference data for the step-5 SROI calculation's inline
-- financial-proxy picker (src/lib/financialProxyLibrary.js).
--
-- v1 scope: no user-facing "add to library" UI. Only admins can write rows, via
-- the Supabase Dashboard table editor or future admin.html tooling (not built in
-- this round). Everyone with an account (i.e. anyone who can reach step 5 of the
-- wizard) can read active rows.
--
-- WTP + premium pattern: there is deliberately no separate "premium amount"
-- column. A willingness_to_pay entry's amount IS the premium itself; the base
-- market price (if relevant) belongs in source_note as context -- see the
-- "used cooking oil" seed row below for the reference example.
--
-- Apply via the Supabase Dashboard's SQL Editor, same as 0008. Assumes
-- public.is_admin() already exists in the live database (see 0008's note).

create table if not exists public.financial_proxy_library (
    id uuid primary key default gen_random_uuid(),
    indicator_th text not null,
    indicator_en text,
    proxy_type text not null check (proxy_type in (
        'market_price',
        'willingness_to_pay',
        'avoided_cost',
        'wage_rate',
        'government_rate',
        'benchmark_transfer',
        'advertising_value_equivalent',
        'other'
    )),
    -- Single-value entries store the same number in both columns. Range entries
    -- (e.g. "100-120 บาท/กก.") store the real min/max rather than a pre-averaged
    -- figure, so the app decides how to represent it (see representativeAmount()
    -- in src/lib/financialProxyLibrary.js) instead of baking in a lossy choice.
    amount_min numeric not null check (amount_min >= 0),
    amount_max numeric not null check (amount_max >= amount_min),
    unit text not null,
    source_note text,
    -- "Social impact factor" category KEY: medical, mental_health, agriculture,
    -- education, social_welfare, labor, training, economy, environment, arts_culture,
    -- other. Labels live in PROXY_CATEGORY_LABELS (src/lib/financialProxyLibrary.js).
    category text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    created_by uuid references auth.users(id)
);

comment on table public.financial_proxy_library is
    'Reference data for the SROI wizard''s financial-proxy picker (step 5). Read-only for regular users; admin-managed.';

-- Never FORCE this: unlike projects/project_members/user_profiles, this table has
-- no cross-table recursive policies, but the project-wide rule stands regardless
-- (see CLAUDE.md, "Never enable FORCE ROW LEVEL SECURITY").
alter table public.financial_proxy_library enable row level security;

create policy financial_proxy_library_select_authenticated
    on public.financial_proxy_library
    for select
    to authenticated
    using (true);

create policy financial_proxy_library_insert_admin
    on public.financial_proxy_library
    for insert
    to authenticated
    with check (public.is_admin());

create policy financial_proxy_library_update_admin
    on public.financial_proxy_library
    for update
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy financial_proxy_library_delete_admin
    on public.financial_proxy_library
    for delete
    to authenticated
    using (public.is_admin());

-- Seed data: curated from 5 real SROI workbooks (see /Users/thanawattraipat/Documents/SROI ARM).
-- source_note carries the ORIGINAL calculation basis (quantities x unit rates) from
-- the source workbook, not just a project citation -- so a user picking this proxy
-- can see how the number was actually derived, not only where it came from.
insert into public.financial_proxy_library
    (indicator_th, indicator_en, proxy_type, amount_min, amount_max, unit, source_note, category)
values
    ('ขายไก่มีชีวิต', 'Live chicken sale', 'market_price', 100, 120, 'บาท/กก.', 'ขายไก่ ก.ก.ละ 120 บาท (พ่อณรงค์) -- โครงการไก่พื้นเมืองน่าน', 'agriculture'),
    ('ขายไก่ชำแหละ', 'Dressed chicken sale', 'market_price', 120, 170, 'บาท/กก.', 'ขายไก่ชำแหละ ก.ก.ละ 170 บาท ขายได้ 10 ตัว = 1,700 บาท -- โครงการไก่พื้นเมืองน่าน', 'agriculture'),
    ('ขายไก่พ่อแม่พันธุ์', 'Breeding-stock chicken sale', 'market_price', 120, 120, 'บาท/ตัว', 'ราคาขายไก่พ่อแม่พันธุ์ตัวละ 120 บาท -- โครงการไก่พื้นเมืองน่าน', 'agriculture'),
    ('ขายลูกไก่', 'Chick sale', 'market_price', 25, 25, 'บาท/ตัว', 'ค่าลูกไก่ประดู่หางดำ ตัวละ 25 บาท x 480 ตัว = 12,000 บาท -- โครงการไก่พื้นเมืองน่าน', 'agriculture'),
    ('ลดการจ่ายค่าอาหารในครัวเรือน', 'Avoided household food expense', 'avoided_cost', 300, 400, 'บาท/ครัวเรือน/เดือน', 'ลดค่าอาหารในครัวเรือน เดือนละ 400 บาท x 3 ครัวเรือน x 2 เดือน = 2,400 บาท -- โครงการไก่พื้นเมืองน่าน', 'agriculture'),
    ('ขายขี้ไก่', 'Chicken-manure byproduct sale', 'market_price', 30, 40, 'บาท/กระสอบ', 'ขายขี้ไก่ 10 กระสอบ x กระสอบละ 30 บาท = 300 บาท -- โครงการไก่พื้นเมืองน่าน', 'agriculture'),
    ('ค่าไฟฟ้าตู้ฟักไข่', 'Incubator electricity (displacement)', 'other', 300, 1000, 'บาท/เดือน', 'ค่าไฟฟ้าตู้ฟักไก่ เดือนละ 1,000 บาท x 2 เดือน = 2,000 บาท -- โครงการไก่พื้นเมืองน่าน', 'agriculture'),
    ('ค่าจ้างแรงงานชำแหละที่ลดลง', 'Avoided slaughter/dressing labor', 'avoided_cost', 30, 30, 'บาท/ตัว', 'ต้นทุนที่ลดลงจากการจ้างฆ่าไก่ ตัวละ 30 บาท x 900 ตัว = 27,000 บาท -- โครงการไก่พื้นเมืองน่าน (เชียงกลาง)', 'agriculture'),
    ('ไส้อั่วไก่', 'Chicken sausage product sale', 'market_price', 400, 400, 'บาท/กก.', 'ไส้อั่วไก่ 235 กก. x กก.ละ 400 บาท = 94,000 บาท -- โครงการไก่พื้นเมืองน่าน (ทุ่งช้าง)', 'agriculture'),
    ('ไก่ต้มน้ำปลา', 'Boiled chicken product sale', 'market_price', 280, 280, 'บาท/กก.', 'ไก่ต้มน้ำปลา 160 กก. x กก.ละ 280 บาท = 44,800 บาท -- โครงการไก่พื้นเมืองน่าน (ทุ่งช้าง)', 'agriculture'),
    ('รายได้ร้านค้าแพลตฟอร์ม', 'Platform merchant income', 'other', 8398, 75092, 'บาท/ปี', 'รายได้ร้านค้าในสามย่าน baseline 8,398 บาท เติบโต +20%/ปี (สูงสุด 75,092 บาท) -- โครงการตามสั่งตามส่ง', 'economy'),
    ('ลดการใช้เชื้อเพลิงจากการรวมออเดอร์', 'Avoided fuel from combined orders', 'avoided_cost', 450, 912.5, 'บาท/ปี', 'คำนวณจาก (ระยะทาง / อัตราสิ้นเปลืองน้ำมัน) x ราคาเชื้อเพลิง = 450-912.5 บาท/ปี -- โครงการตามสั่งตามส่ง', 'economy'),
    ('ค่าจ้างพนักงานดูแลพื้นที่', 'Area-coordinator employment', 'wage_rate', 78000, 78000, 'บาท/คน/พื้นที่/ปี', '2 คน ดูแล 6 พื้นที่ เฉลี่ยพื้นที่ละ 78,000 บาท/ปี ค่าจ้างเพิ่มปีละ 5% -- โครงการตามสั่งตามส่ง', 'economy'),
    ('มูลค่าสื่อประชาสัมพันธ์', 'Earned media coverage', 'advertising_value_equivalent', 130000, 130000, 'บาท', 'มูลค่าเทียบเท่าสื่อโฆษณาจากเพจ the momentum และข่าว Bangkok Post รวม 130,000 บาท -- โครงการตามสั่งตามส่ง', 'economy'),
    ('ค่าเช่าพื้นที่สาธารณะ', 'Public-space rental rate', 'market_price', 200000, 200000, 'บาท/วัน', 'เปิดพื้นที่ public space เทียบค่าเช่าตลาดวันละ 200,000 บาท (จุฬาฯ จ่ายจริง 20,000 บาท/วัน) -- โครงการศิลปะการละคร', 'arts_culture'),
    ('การขายบัตรการแสดง', 'Theatre ticket sale', 'market_price', 555, 555, 'บาท/ใบ', 'ยอดขายบัตร 9 รอบการแสดง x ราคาบัตร 555 บาท x ผู้ชม 160 ที่นั่ง -- โครงการศิลปะการละคร', 'arts_culture'),
    ('ค่าเขียนบทละคร', 'Script-writing commission', 'market_price', 40000, 40000, 'บาท/เรื่อง', 'ค่าเขียนบทละคร ประมาณ 40,000 บาทต่อเรื่อง x 12 โรงเรียน = 480,000 บาท -- โครงการศิลปะการละคร', 'arts_culture'),
    ('ค่าตอบแทนทีมงาน/นักแสดง', 'Facilitator/actor day rate', 'wage_rate', 20000, 20000, 'บาท/คน/ครั้ง', 'ค่าตอบแทน core team 20,000 บาท/คน/ครั้ง -- โครงการศิลปะการละคร', 'arts_culture'),
    ('ค่าเทอมที่สูญเสียถ้าเปลี่ยนสาย', 'Tuition opportunity cost', 'other', 150000, 150000, 'บาท', 'ค่าเทอมที่ต้องสูญเสียหากเปลี่ยนสายการเรียน (โอกาสสูญเสีย) ประมาณ 150,000 บาท -- โครงการศิลปะการละคร', 'education'),
    ('รับซื้อน้ำมันพืชใช้แล้ว ส่วนเพิ่มพิเศษ', 'Used cooking oil purchase premium over market', 'willingness_to_pay', 5, 5, 'บาท/ลิตร', 'รับซื้อพรีเมียม 5 บาท/ลิตร เหนือราคาตลาดเฉลี่ย 15 บาท/ลิตร: 224 ลิตร x 5 บาท = 1,120 บาท -- โครงการ Repids', 'environment'),
    ('ลดการคัดผักทิ้ง เทียบเกณฑ์ Lemon Farm', 'Avoided vegetable-culling loss (benchmark)', 'benchmark_transfer', 1728, 1728, 'บาท/หน่วย', 'เทียบเกณฑ์เกษตรกรผักสลัด (Lemon Farm) ลดอัตราคัดทิ้งจาก 50% เหลือ 10% เทียบเท่ามูลค่า 1,728 บาท/หน่วย -- โครงการ Repids', 'agriculture'),
    ('ราคาขายสบู่โพแทสเซียม', 'Potassium soap product sale', 'market_price', 80, 80, 'บาท/ลิตร', 'สบู่โพแทสเซียมเข้มข้น 441 แกลลอน x 99 บาท = 43,659 บาท -- โครงการ Repids', 'environment'),
    ('รับจ้างผลิต OEM', 'OEM contract-manufacturing fee', 'market_price', 1900, 1900, 'บาท/50ลิตร', 'ค่าจ้างผลิต OEM 1,900 บาท ต่อการผลิต 50 ลิตร (~38 บาท/ลิตร) -- โครงการ Repids', 'environment'),
    ('ค่าจ้างผู้ช่วยวิจัย', 'Research-assistant wage', 'wage_rate', 500, 500, 'บาท/คน/วัน', 'ค่าจ้างผู้ช่วยนักวิจัย 500 บาท/คน/วัน หรือเหมาจ่าย 18,000 บาท/เดือน -- โครงการ Repids', 'labor'),
    ('ค่าจ้างวิทยากร', 'Trainer/speaker fee', 'wage_rate', 700, 700, 'บาท/ชั่วโมง/คน', 'ค่าจ้างวิทยากร 700 บาท/ชั่วโมง/คน -- โครงการ Repids', 'labor'),
    -- Below: Thailand-wide OFFICIAL reference rates (not tied to one case-study project),
    -- researched and cross-checked against government/official sources so any Thai SROI
    -- project can use them, not just the 5 sample workbooks above. Each carries an agency +
    -- document/circular + year citation in source_note. Two figures the research turned up
    -- were deliberately excluded: the Social Security unemployment benefit (a % of wage, not
    -- a baht amount -- would auto-fill monetaryValue misleadingly) and NESDC's public-project
    -- discount-rate guidance (methodological context, not a per-unit financial proxy).
    ('ค่าจ้างขั้นต่ำ', 'Minimum daily wage', 'wage_rate', 337, 400, 'บาท/วัน', 'อัตราค่าจ้างขั้นต่ำรายจังหวัด 17 ระดับ -- กระทรวงแรงงาน, ประกาศคณะกรรมการค่าจ้าง ฉบับที่ 14, มีผลตั้งแต่ 1 ก.ค. 2568 (ตรวจสอบอัตราล่าสุดก่อนใช้งาน)', 'labor'),
    ('ค่าสมนาคุณวิทยากร (บุคลากรของรัฐ)', 'Trainer honorarium -- government personnel', 'government_rate', 600, 800, 'บาท/ชั่วโมง/คน', 'อัตราสูงสุดตามประเภทการฝึกอบรม: ประเภท ข 600 / ประเภท ก 800 บาท/ชม./คน -- กรมบัญชีกลาง, ระเบียบกระทรวงการคลังว่าด้วยค่าใช้จ่ายในการฝึกอบรมฯ พ.ศ. 2549 (แก้ไขเพิ่มเติมฉบับที่ 3 พ.ศ. 2555)', 'training'),
    ('ค่าสมนาคุณวิทยากร (บุคคลภายนอก)', 'Trainer honorarium -- external/non-government', 'government_rate', 1200, 1600, 'บาท/ชั่วโมง/คน', 'อัตราสูงสุดตามประเภทการฝึกอบรม: ประเภท ข 1,200 / ประเภท ก 1,600 บาท/ชม./คน -- กรมบัญชีกลาง, ระเบียบกระทรวงการคลังฯ พ.ศ. 2549 (แก้ไขเพิ่มเติมฉบับที่ 3 พ.ศ. 2555)', 'training'),
    ('ค่าอาหารว่างและเครื่องดื่ม (ฝึกอบรม)', 'Training tea-break/refreshment allowance', 'government_rate', 35, 50, 'บาท/มื้อ/คน', 'จัดในสถานที่ราชการไม่เกิน 35 บาท, จัดในสถานที่เอกชนไม่เกิน 50 บาท -- กรมบัญชีกลาง, ระเบียบกระทรวงการคลังฯ พ.ศ. 2549 (แก้ไขเพิ่มเติม)', 'training'),
    ('ค่าอาหารกลางวัน-เย็น (ฝึกอบรม)', 'Training meal allowance (lunch/dinner)', 'government_rate', 200, 350, 'บาท/มื้อ/คน', 'จัดในสถานที่ราชการ 200 บาท, จัดในสถานที่เอกชน 300 บาท (กลางวัน)/350 บาท (เย็น) -- กรมบัญชีกลาง, ระเบียบกระทรวงการคลังฯ พ.ศ. 2549 (แก้ไขเพิ่มเติม) -- ตรวจสอบเอกสารต้นฉบับก่อนใช้งานจริง', 'training'),
    ('ค่าเช่าที่พักเหมาจ่าย (ฝึกอบรม)', 'Training accommodation allowance (lump-sum)', 'government_rate', 750, 2400, 'บาท/คน/คืน', 'อัตราเหมาจ่าย: ประเภท ก ห้องเดี่ยวไม่เกิน 2,400/ห้องคู่ไม่เกิน 1,300, ประเภท ข ห้องเดี่ยวไม่เกิน 1,450/ห้องคู่ไม่เกิน 900 บาท/คน/คืน -- กรมบัญชีกลาง, ระเบียบกระทรวงการคลังฯ พ.ศ. 2549 (แก้ไขเพิ่มเติม) -- ตรวจสอบเอกสารต้นฉบับก่อนใช้งานจริง', 'training'),
    ('ค่าเบี้ยเลี้ยงเดินทางไปราชการ', 'Government travel per-diem allowance', 'government_rate', 240, 240, 'บาท/วัน', 'อัตราสำหรับข้าราชการระดับปฏิบัติงานถึงชำนาญการพิเศษ -- กรมบัญชีกลาง, ระเบียบกระทรวงการคลังว่าด้วยค่าใช้จ่ายในการเดินทางไปราชการ (ฉบับที่ 2) พ.ศ. 2554', 'training'),
    ('เบี้ยยังชีพผู้สูงอายุ', 'Elderly living allowance (tiered by age)', 'government_rate', 700, 1250, 'บาท/เดือน', 'อัตราขั้นบันไดตามช่วงอายุ: 60-69 ปี 700 / 70-79 ปี 850 / 80-89 ปี 1,000 / 90 ปีขึ้นไป 1,250 บาท/เดือน -- พม./กรมส่งเสริมการปกครองท้องถิ่น, มติ ครม. 29 พ.ย. 2567, มีผลตั้งแต่ 1 ต.ค. 2568 -- ตรวจสอบสถานะล่าสุดก่อนใช้งาน', 'social_welfare'),
    ('เบี้ยความพิการ', 'Disability allowance', 'government_rate', 800, 1000, 'บาท/เดือน', 'อัตราฐาน 800 บาท/เดือน ปรับเพิ่มเป็น 1,000 บาท/เดือนตามมติ กพช. (ทยอยขยายกลุ่มเป้าหมาย) -- พม., มิ.ย. 2569 -- ตรวจสอบสถานะการจ่ายจริงก่อนใช้งาน', 'social_welfare'),
    ('GDP ต่อหัวประชากรไทย', 'Thailand GDP per capita', 'benchmark_transfer', 264608, 264608, 'บาท/คน/ปี', 'GDP ต่อหัว ปี 2567 (≈7,496 ดอลลาร์สหรัฐ) -- สศช. (NESDC), รายงานภาวะเศรษฐกิจไทยไตรมาส 4/2567 (แถลง ก.พ. 2568)', 'economy'),
    ('เส้นความยากจน', 'Thailand poverty line', 'benchmark_transfer', 3078, 3078, 'บาท/คน/เดือน', 'เส้นความยากจนปี 2567 -- สศช., รายงานการวิเคราะห์สถานการณ์ความยากจนและความเหลื่อมล้ำของประเทศไทย ปี 2567 -- บางแหล่งอ้างอิงตัวเลขปีก่อนหน้า (3,043) ควรตรวจสอบปีข้อมูลก่อนใช้', 'economy'),
    ('เงินอุดหนุนรายหัวนักเรียน (การจัดการเรียนการสอน)', 'Per-student subsidy -- instructional cost', 'government_rate', 1836, 12674, 'บาท/คน/ปี', 'อัตราเงินอุดหนุนรายหัว: อนุบาล 1,836 / ประถม 2,052 / ม.ต้น 3,780 / ม.ปลาย 4,104 / ปวช. 12,674 บาท/คน/ปี (ปรับเพิ่ม 8% จากปีก่อน) -- สพฐ., กระทรวงศึกษาธิการ, ปีงบประมาณ 2567', 'education'),
    ('เงินอุดหนุนรายหัวนักเรียน (เครื่องแบบนักเรียน)', 'Per-student subsidy -- school uniform', 'government_rate', 325, 950, 'บาท/คน/ปี', 'อัตราเงินอุดหนุนรายหัว: อนุบาล 325 / ประถม 400 / ม.ต้น 500 / ม.ปลาย 550 / ปวช. 950 บาท/คน/ปี -- สพฐ., กระทรวงศึกษาธิการ, ปีงบประมาณ 2567', 'education'),
    ('มูลค่าความเต็มใจจ่ายต่อหน่วยคุณภาพชีวิต (เกณฑ์ CE Threshold)', 'Willingness-to-pay / cost-effectiveness threshold per QALY', 'willingness_to_pay', 160000, 160000, 'บาท/QALY', 'เกณฑ์อ้างอิงความคุ้มค่าทางเศรษฐศาสตร์สาธารณสุข/บัญชียาหลักแห่งชาติ ปรับจาก 100,000 (2551) และ 120,000 (2553) เป็น 160,000 บาท/QALY (2556) -- HITAP, อ้างอิงการนำเสนอ ISPOR Asia Pacific 2018 -- ตรวจสอบว่ามีเกณฑ์ใหม่กว่านี้หรือไม่ก่อนใช้งาน', 'medical'),
    -- Below: medical, mental health, and farmer-income reference rates. Two figures the
    -- research turned up were deliberately excluded: Value of Statistical Life (the only
    -- available figures were in USD from a 2011-2014 study and would need re-derivation, not
    -- a trustworthy pre-converted baht number) and the UK WELLBY wellbeing-valuation figure
    -- (no Thai-specific monetized wellbeing figure exists; the only benchmark found is in GBP,
    -- which this schema has no currency field for -- forcing it in would silently mis-fill the
    -- "(บาท)" value field with a pound figure).
    ('อัตราเหมาจ่ายรายหัว หลักประกันสุขภาพแห่งชาติ (บัตรทอง)', 'NHSO Universal Coverage Scheme capitation rate per person', 'government_rate', 3844.55, 3844.55, 'บาท/คน/ปี', 'งบเหมาจ่ายรายหัวที่ ครม. อนุมัติ (9 เม.ย. 2567) ปีงบประมาณ 2568 ครอบคลุมผู้มีสิทธิ 47.15 ล้านคน วงเงินรวม 181,297 ล้านบาท -- สปสช./มติ ครม., ปีงบประมาณ 2568', 'medical'),
    ('อัตราจ่ายค่าบริการผู้ป่วยใน (IP) ต่อหน่วย AdjRW', 'NHSO inpatient (DRG-based) payment rate per Adjusted Relative Weight', 'government_rate', 8350, 8350, 'บาท/1 AdjRW', 'อัตราจ่ายชดเชยค่าบริการผู้ป่วยในเบื้องต้นที่ สปสช. ประกาศใช้ทั่วประเทศ ปีงบประมาณ 2568 -- สปสช. (รายงานผ่าน Hfocus.org, พ.ค. 2568) -- ตรวจสอบประกาศต้นฉบับก่อนใช้งานจริง', 'medical'),
    ('ต้นทุนการรักษาพยาบาลผู้ป่วยนอกโรคเบาหวานเฉลี่ยต่อครั้ง', 'Average outpatient medical cost per visit -- type-2 diabetes', 'avoided_cost', 945, 945, 'บาท/ครั้ง', 'วิเคราะห์จากข้อมูลผู้ป่วยเบาหวาน 11,769 ครั้งการรับบริการ (2557-2560) รพ.บันนังสตา จ.ยะลา -- วิกฤตนรากรณ์ คงแดง, วารสาร TJPHS ปีที่ 2 ฉบับที่ 2, 2562 -- เป็นข้อมูลระดับโรงพยาบาลเดียว ใช้เป็นค่าประมาณระดับขนาดเท่านั้น', 'medical'),
    ('ต้นทุนการรักษาโรคซึมเศร้าต่อราย (มี vs ไม่มีการคัดกรองเชิงรุก)', 'Per-case depression care cost -- with early screening vs. without', 'avoided_cost', 930, 14381, 'บาท/ราย', 'หากคัดกรองด้วย 2Q/9Q แล้วรักษาด้วยยา ลดต้นทุนจาก 14,381 เหลือ 930 บาท/ราย -- กรมสุขภาพจิต, แนวทางการดูแลเฝ้าระวังโรคซึมเศร้าระดับจังหวัด ฉบับปรับปรุงครั้งที่ 3, 2557', 'mental_health'),
    ('ภาระทางเศรษฐกิจต่อปีของผู้ป่วยโรคซึมเศร้า (ทั่วไป vs ดื้อยา)', 'Annual per-patient economic burden -- major depressive disorder vs. treatment-resistant depression', 'avoided_cost', 173487.04, 276059.97, 'บาท/คน/ปี', 'ต้นทุนมุมมองสังคม รวมค่ารักษาทางตรง ค่าเสียโอกาส/ผลิตภาพ และภาระผู้ดูแล (ไม่รวมประกัน) -- Prasartpornsirichoke et al., BMC Public Health, 2023', 'mental_health'),
    ('รายได้เงินสดรวมของครัวเรือนเกษตรไทย (เฉลี่ย)', 'Average total household cash income -- Thai farm households', 'benchmark_transfer', 472886, 472886, 'บาท/ครัวเรือน/ปี', 'ผลสำรวจภาวะเศรษฐกิจสังคมครัวเรือนเกษตร ปีเพาะปลูก 2567/68 -- สศก. (OAE), รายงานผ่าน Bangkokbiznews, 2568 -- ควรตรวจสอบกับรายงานต้นฉบับของ สศก. ก่อนใช้งานจริง', 'agriculture'),
    ('รายได้เงินสดสุทธิทางการเกษตรของครัวเรือนไทย (เฉลี่ย)', 'Average net agricultural cash income -- Thai farm households', 'benchmark_transfer', 84779, 84779, 'บาท/ครัวเรือน/ปี', 'ผลสำรวจภาวะเศรษฐกิจสังคมครัวเรือนเกษตร ปีเพาะปลูก 2567/68 -- สศก. (OAE), รายงานผ่าน Bangkokbiznews, 2568 -- ควรตรวจสอบกับรายงานต้นฉบับของ สศก. ก่อนใช้งานจริง', 'agriculture'),
    ('ต้นทุนการผลิตข้าวนาปีเฉลี่ยต่อไร่', 'Average wet-season rice production cost per rai', 'other', 4644.06, 4644.06, 'บาท/ไร่', 'ต้นทุนการผลิตข้าวนาปีเฉลี่ยต่อไร่ (รวมต้นทุนผันแปรและคงที่) จากการสำรวจเกษตรกร 37 จังหวัด ปีเพาะปลูก 2567/68 -- สศก. (OAE), รายงานผ่าน Bangkokbiznews, 2568', 'agriculture'),
    ('หนี้สินเฉลี่ยครัวเรือนเกษตรไทย (ทุกครัวเรือน)', 'Average Thai farm household debt -- all households', 'benchmark_transfer', 207606, 207606, 'บาท/ครัวเรือน', 'มูลค่าหนี้สินเฉลี่ยต่อครัวเรือนเกษตรทั่วราชอาณาจักร ปี 2564 (เพิ่มจาก 159,129 บาท ปี 2562) -- สำนักงานสถิติแห่งชาติ (NSO), หนี้สินของครัวเรือนเกษตร พ.ศ. 2564, ตาราง 8', 'agriculture'),
    ('หนี้สินเฉลี่ยเฉพาะครัวเรือนเกษตรที่มีหนี้', 'Average debt among indebted Thai farm households only', 'benchmark_transfer', 311098, 311098, 'บาท/ครัวเรือน (เฉพาะที่เป็นหนี้ ~66.7%)', 'มูลค่าหนี้สินเฉลี่ยเฉพาะครัวเรือนที่เป็นหนี้ ทั่วราชอาณาจักร ปี 2564 (เพิ่มจาก 168,119 บาท ปี 2556) -- สำนักงานสถิติแห่งชาติ (NSO), หนี้สินของครัวเรือนเกษตร พ.ศ. 2564, ตาราง 9', 'agriculture')
on conflict do nothing;
