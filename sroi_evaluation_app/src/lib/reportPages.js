/**
 * The step-6 report, in two forms made from the same blocks (so the content and its order are the
 * same): a single long web page for the screen (renderReportWeb), and A4 landscape pages for the
 * PDF download (renderReportPages -> exportPagesToPdf, which photographs those pages).
 *
 * Input is a plain report model assembled by appState.collectReportModel() (steps 1-5 plus the
 * SROI results); nothing here reads the form or the database.
 *
 *   summary  project card, impact pathway, SROI result cards, SDGs, what the site visit
 *            found, activity photos
 *   full     project information, SDGs with reasons, the whole impact pathway, indicators and
 *            theory of change, the result table, site visit and photos, then the SROI
 *            calculation rows and the year-by-year table
 *
 * Paper pages are filled by measuring real layout (paginate): blocks are placed on a page until the
 * next one does not fit; lists and tables that are too long are split across pages.
 *
 * All styling is in style.css under the `rp-` prefix.
 */

import { escapeHTML as esc, formatMoney, formatNumber } from './format.js';
import { SDG_COLORS, textLines } from './reportData.js';
import { rasteriseElement } from './domRaster.js';

export const PAGE_W = 1123; // A4 landscape at 96 dpi (297 mm)
export const PAGE_H = 794;  // (210 mm)

const money = value => formatMoney(value);
const percent = fraction => `${(Number(fraction) * 100).toFixed(1).replace(/\.0$/, '')}%`;
const hasText = value => String(value ?? '').trim() !== '';

// ---- small building blocks ----------------------------------------------------------------

const PIN_SVG = '<svg class="rp-pin" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="#9f2147" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';

const bullets = lines => lines.length
    ? `<ul class="rp-list">${lines.map(line => `<li>${line}</li>`).join('')}</ul>`
    : '<p class="rp-empty">ไม่ได้ระบุ</p>';

/** A pathway/line item { label?, text } as safe HTML, and as plain text. */
const lineHTML = item => `${item.label ? `<b>${esc(item.label)}</b> ` : ''}${esc(item.text)}`;
const linePlain = item => `${item.label ? `${item.label} ` : ''}${item.text}`;

function card(title, inner, extraClass = '') {
    return `<section class="rp-card ${extraClass}">${title ? `<h3 class="rp-card-title">${esc(title)}</h3>` : ''}${inner}</section>`;
}

function sectionHeading(number, title, continued = false) {
    return `<h2 class="rp-h2"><span class="rp-h2-num">${number}</span>${esc(title)}${continued ? '<span class="rp-h2-cont"> (ต่อ)</span>' : ''}</h2>`;
}

// ---- model -> display pieces --------------------------------------------------------------

/** The six boxes of the impact pathway, as lists of { label?, text }. */
function pathwayBoxes(model) {
    const p = model.pathway;
    const inputs = [];
    p.inputs.filter(row => hasText(row.name) || hasText(row.amount)).forEach(row => {
        const amount = Number.parseFloat(row.amount);
        inputs.push({
            text: [row.name.trim(), row.type ? `(${row.type})` : '', Number.isFinite(amount) ? `— ${money(amount)} บาท` : '']
                .filter(Boolean).join(' ')
        });
    });
    if (model.results.investment > 0) inputs.push({ label: 'รวมเงินลงทุน', text: `${money(model.results.investment)} บาท` });
    textLines(p.knowledge).forEach(text => inputs.push({ text }));

    const stakeholders = p.stakeholders.filter(row => hasText(row.name)).map(row => ({
        text: `${row.name.trim()}${hasText(row.count) ? ` · จำนวน ${formatNumber(Number.parseFloat(row.count) || 0)}` : ''}`
    }));

    const activities = textLines(p.activities).map(text => ({ text }));

    const outputs = textLines(p.output).map(text => ({ text }));
    if (hasText(p.outputSdg)) outputs.push({ label: 'SDGs ที่เชื่อมกับผลผลิต:', text: p.outputSdg.trim() });

    const outcomes = p.outcomes.filter(row => hasText(row.change)).map(row => ({
        label: hasText(row.stakeholders) ? `${row.stakeholders.trim()} →` : '',
        text: row.change.trim()
    }));

    const impacts = [['เศรษฐกิจ', p.impactEconomic], ['สังคม', p.impactSocial], ['สิ่งแวดล้อม', p.impactEnvironment]]
        .filter(([, value]) => hasText(value))
        .map(([label, value]) => ({ label: `${label}:`, text: textLines(value).join(' ') }))
        .filter(item => item.text);

    return [
        { key: 'input',        en: 'INPUT',        th: 'ปัจจัยนำเข้า',        lines: inputs },
        { key: 'stakeholders', en: 'STAKEHOLDERS', th: 'ผู้มีส่วนได้ส่วนเสีย', lines: stakeholders },
        { key: 'activities',   en: 'ACTIVITIES',   th: 'กิจกรรม',             lines: activities },
        { key: 'output',       en: 'OUTPUT',       th: 'ผลผลิต',              lines: outputs },
        { key: 'outcome',      en: 'OUTCOME',      th: 'ผลลัพธ์',             lines: outcomes },
        { key: 'impact',       en: 'IMPACT',       th: 'ผลกระทบ',             lines: impacts }
    ];
}

function resultFigures(model) {
    const r = model.results;
    return {
        irr: r.irr === null ? '-' : `${(r.irr * 100).toFixed(r.irr * 100 >= 100 ? 0 : 1).replace(/\.0$/, '')} %`,
        ratio: r.ratio.toFixed(2)
    };
}

// ---- shared cards -------------------------------------------------------------------------

function heroCard(model, eyebrow) {
    const shown = model.team.slice(0, 3);
    const team = shown.map(member => `<span class="rp-chip">${esc(member)} · <b>ผู้ร่วมวิจัย</b></span>`).join('')
        + (model.team.length > shown.length ? `<span class="rp-chip">+${model.team.length - shown.length} คน</span>` : '');
    const where = [
        hasText(model.supportYear) ? `ปี พ.ศ. ${model.supportYear.trim()}` : '',
        hasText(model.category) ? model.category : '',
        model.area,
        model.department
    ].filter(hasText).join(' · ');
    const f = resultFigures(model);

    return `
        <section class="rp-hero">
            <div class="rp-logo"><img src="/images/chula-logo.png" alt=""></div>
            <div class="rp-hero-main">
                <div class="rp-eyebrow">${eyebrow}</div>
                <h1 class="rp-title">${esc(model.name)}</h1>
                <p class="rp-resp">${esc(model.responsible || '-')} · <b>ผู้รับผิดชอบโครงการ</b></p>
                ${team ? `<div class="rp-chips"><span class="rp-chips-label">ผู้ร่วมวิจัย</span>${team}</div>` : ''}
                ${where ? `<p class="rp-meta">${PIN_SVG} ${esc(where)}</p>` : ''}
            </div>
            <div class="rp-ratio">
                <div class="rp-ratio-label">SROI Ratio</div>
                <div class="rp-ratio-value">${f.ratio}<span> : 1</span></div>
                <div class="rp-ratio-note">ทุก 1 บาทที่ลงทุน สร้างคุณค่าสังคม ${f.ratio} บาท</div>
            </div>
        </section>`;
}

/**
 * Equal-slice ring of the project's SDG colours with the count in the middle. The words
 * "ตอบสนอง N เป้าหมาย" sit under the ring: inside it they landed on the coloured slices.
 */
function sdgDonut(sdgs, size = 150) {
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const slice = circumference / Math.max(1, sdgs.length);
    const arcs = sdgs.map((sdg, index) => `
        <circle cx="75" cy="75" r="${radius}" fill="none" stroke="${SDG_COLORS[sdg.id] ?? '#9f2147'}" stroke-width="30"
                stroke-dasharray="${slice.toFixed(2)} ${(circumference - slice).toFixed(2)}"
                stroke-dashoffset="${(-index * slice).toFixed(2)}" transform="rotate(-90 75 75)"/>`).join('');
    return `
        <div class="rp-donut-wrap">
            <div class="rp-donut" style="width:${size}px;height:${size}px">
                <svg viewBox="0 0 150 150" width="${size}" height="${size}" aria-hidden="true">${arcs}</svg>
                <div class="rp-donut-centre"><strong>${sdgs.length}</strong></div>
            </div>
            <p class="rp-donut-label">ตอบสนอง ${sdgs.length} เป้าหมาย</p>
        </div>`;
}

const sdgBadge = sdg => `<span class="rp-sdg-badge" style="background:${SDG_COLORS[sdg.id] ?? '#9f2147'}">${sdg.id}</span>`;

/**
 * The activity photos, laid out symmetrically whatever their number: 1, 2 or 3 in one row; 4 as 2 x 2;
 * 5 as 3 + 2; 6 as 3 + 3. Rows are centred and every tile in a layout has the same size (3:2, cropped to
 * fill, never squeezed), so the gallery stays tidy with 1 photo or 6.
 */
function photoRowsFor(count) {
    if (count <= 3) return [count];
    if (count === 4) return [2, 2];
    return count === 5 ? [3, 2] : [3, 3];
}

/** The gallery's rows ({photos, width}); every tile in a layout has the same width. */
function galleryRows(photos) {
    // Fewer photos get larger tiles: 1-2 at 40% of the width each, 2 x 2 at 38%, otherwise a third.
    const width = photos.length <= 2 ? '40%' : (photos.length === 4 ? '38%' : 'calc((100% - 16px) / 3)');
    let next = 0;
    return photoRowsFor(photos.length).map(size => ({ photos: photos.slice(next, next += size), width }));
}

function galleryHTML(rows) {
    return `<div class="rp-gallery" style="--tile-w:${rows[0].width}">${rows.map(row => `
        <div class="rp-gallery-row">${row.photos.map(photo => `
            <figure class="rp-photo"><img src="${esc(photo.src)}" alt="" style="object-position:${photo.cropX}% ${photo.cropY}%"></figure>`).join('')}</div>`).join('')}</div>`;
}

/**
 * The photo card as a block. It can give way in two ways to keep pages full: its tiles shrink a little
 * (down to 70%) to fit the space left on a page, and if that is not enough its rows continue on the next page.
 */
function photoBlock(model) {
    if (!model.photos.length) {
        return { html: () => card('ภาพกิจกรรม', '<p class="rp-empty">ยังไม่มีภาพกิจกรรม</p>') };
    }
    return {
        items: galleryRows(model.photos),
        minSplit: 1,
        shrinkVar: { name: '--tile-k', floor: 0.7 },
        html: (rows, continued) => card(continued ? 'ภาพกิจกรรม (ต่อ)' : 'ภาพกิจกรรม', galleryHTML(rows))
    };
}

function locationCard(model) {
    const loc = model.location;
    const b = loc.bounds;
    const caption = [model.area, loc.lat && loc.lng ? `พิกัด ${Number(loc.lat).toFixed(4)}, ${Number(loc.lng).toFixed(4)}` : '']
        .filter(hasText).join(' · ');
    // The real map of what the person chose in step 1 (see reportMap.js), when its tiles could be loaded.
    if (loc.mapImage) {
        return card('พื้นที่ดำเนินโครงการ', `
            <img class="rp-map rp-map-img" src="${esc(loc.mapImage)}" alt="">
            <p class="rp-caption">${PIN_SVG} ${esc(caption || 'ตำแหน่งที่เลือก')}</p>`, 'rp-card-map');
    }
    const grid = [60, 120, 180, 240, 300, 360, 420, 480].map(x => `<line x1="${x}" y1="0" x2="${x}" y2="180"/>`).join('')
        + [45, 90, 135].map(y => `<line x1="0" y1="${y}" x2="540" y2="${y}"/>`).join('');
    const area = loc.type !== 'pin' && b
        ? '<rect x="170" y="38" width="200" height="104" rx="4" fill="rgba(159,33,71,.10)" stroke="#9f2147" stroke-width="1.4" stroke-dasharray="6 4"/>'
        : '';
    return card('พื้นที่ดำเนินโครงการ', `
        <svg class="rp-map" viewBox="0 0 540 180" preserveAspectRatio="none" aria-hidden="true">
            <rect width="540" height="180" fill="#fbf1f4"/>
            <g stroke="#ecd3db" stroke-width="1">${grid}</g>
            <path d="M0 150 C 110 130, 200 160, 300 120 S 470 90, 540 60" fill="none" stroke="#9cc3e6" stroke-width="9" stroke-linecap="round"/>
            ${area}
            <g transform="translate(270 92)"><circle r="22" fill="rgba(159,33,71,.16)"/>
                <path d="M0 -20 a11 11 0 0 1 11 11 c0 9 -11 24 -11 24 s-11 -15 -11 -24 a11 11 0 0 1 11 -11z" fill="#9f2147"/>
                <circle cy="-9" r="4" fill="#fff"/></g>
        </svg>
        <p class="rp-caption">${PIN_SVG} ${esc(caption || 'ยังไม่ได้ระบุพิกัด')}</p>`, 'rp-card-map');
}

function sdgListItems(sdgs) {
    return sdgs.map(sdg => `
        <li class="rp-sdg-item">
            ${sdgBadge(sdg)}
            <div>
                <strong>${esc(sdg.title)}</strong>
                ${hasText(sdg.reason) ? `<p>${esc(sdg.reason.trim())}</p>` : ''}
                ${sdg.targets.length ? `<p class="rp-sdg-targets">หัวข้อย่อย: ${esc(sdg.targets.join(', '))}</p>` : ''}
            </div>
        </li>`).join('');
}

// ---- summary page -------------------------------------------------------------------------

/**
 * The summary as blocks for the same paginator as the full report. At the larger text size it
 * usually runs to two pages: nothing is cut or shortened to make it fit on one.
 */
function summaryBlocks(model) {
    const boxes = pathwayBoxes(model).map(box => `
        <div class="rp-mini rp-tone-${box.key}">
            <div class="rp-mini-head"><span class="rp-mini-en">${box.en}</span> <span class="rp-mini-th">${esc(box.th)}</span></div>
            ${bullets(box.lines.map(lineHTML))}
        </div>`).join('');

    const r = model.results;
    const f = resultFigures(model);
    const figure = (label, value, tone) => `
        <div class="rp-fig rp-fig-${tone}"><div class="rp-fig-label">${label}</div><div class="rp-fig-value">${value}</div></div>`;

    const sdgLegend = model.sdgs.length
        ? model.sdgs.map(sdg => `<li>${sdgBadge(sdg)}<span>${esc(sdg.title)}</span></li>`).join('')
        : '<li class="rp-empty">ไม่ได้ระบุ</li>';

    const story = String(model.site.takeaway || model.site.quote || '').trim();

    const blocks = [
        { html: () => heroCard(model, 'SROI SUMMARY') },
        { html: () => card('ห่วงโซ่ผลกระทบ (Impact Pathway)', `<div class="rp-minis">${boxes}</div>`) },
        { html: () => card('ผลการคำนวณ SROI (หน่วย: บาท)', `<div class="rp-figs">
            ${figure('มูลค่าการลงทุน', money(r.investment), 'blue')}
            ${figure('ผลประโยชน์รวมปัจจุบัน', money(r.grossPV), 'green')}
            ${figure('หักกรณีฐาน', `– ${money(r.baseCase)}`, 'amber')}
            ${figure('ผลประโยชน์สุทธิ', money(r.netBenefit), 'rose')}
            ${figure('IRR (ผลตอบแทนภายใน)', f.irr, 'violet')}
        </div>`) },
        { maxSqueeze: 0.25, html: () => `<div class="rp-row rp-row-summary">
            ${card('ความสอดคล้องกับ SDGs', `<div class="rp-sdg-summary">${sdgDonut(model.sdgs, 64)}<ul class="rp-sdg-legend">${sdgLegend}</ul></div>`)}
            ${card('คุณค่าต่อชุมชนและท้องถิ่น', story
                ? `<p class="rp-quote">“${esc(story)}”</p><p class="rp-quote-by">— สรุปจากการลงพื้นที่</p>`
                : '<p class="rp-empty">ยังไม่มีข้อมูลจากการลงพื้นที่</p>')}
        </div>` }
    ];
    if (model.photos.length) blocks.push(photoBlock(model));
    return blocks;
}

// ---- full report --------------------------------------------------------------------------

function infoBlocks(model) {
    const blocks = [];

    // 1 ข้อมูลโครงการ
    blocks.push({ html: () => sectionHeading(1, 'ข้อมูลโครงการ') + heroCard(model, 'SROI FULL REPORT') });

    const targetGroup = model.pathway.stakeholders.filter(row => hasText(row.name)).map(row =>
        `${esc(row.name.trim())}${hasText(row.count) ? ` (n = ${formatNumber(Number.parseFloat(row.count) || 0)})` : ''}`);
    // Objectives (then the target group) are split item by item: with many objectives the first ones
    // stay beside the map on this page and the rest continue on the next, instead of leaving this page empty.
    const objectiveItems = [
        ...(model.objectives.length ? model.objectives : ['ไม่ได้ระบุ']).map((text, index) => ({ text, number: index + 1 })),
        ...(targetGroup.length ? [{ targetGroup: true }] : [])
    ];
    blocks.push({
        items: objectiveItems,
        minSplit: 1,
        html: (items, continued) => {
            const objectives = items.filter(item => item.text !== undefined);
            const list = objectives.length
                ? `<ol class="rp-list rp-ol" start="${objectives[0].number}">${objectives.map(item => `<li>${esc(item.text)}</li>`).join('')}</ol>`
                : '';
            const group = items.some(item => item.targetGroup)
                ? `<h4 class="rp-sub">กลุ่มเป้าหมาย</h4><ol class="rp-list rp-ol">${targetGroup.map(item => `<li>${item}</li>`).join('')}</ol>`
                : '';
            const text = card(continued ? 'วัตถุประสงค์โครงการ (ต่อ)' : 'วัตถุประสงค์โครงการ', list + group);
            return continued ? text : `<div class="rp-row">${text}${locationCard(model)}</div>`;
        }
    });

    // SDGs (split by SDG)
    blocks.push({
        items: model.sdgs,
        minSplit: 1,
        maxSqueeze: 0.2, // this card may shrink a little more, to stay on page 1 under the project details
        html: (items, continued) => items.length
            ? card('ความสอดคล้องกับ SDGs', `<div class="rp-sdg-full">${continued ? '' : sdgDonut(model.sdgs, 100)}<ul class="rp-sdg-list">${sdgListItems(items)}</ul></div>`)
            : card('ความสอดคล้องกับ SDGs', '<p class="rp-empty">ไม่ได้เลือกเป้าหมาย SDGs</p>')
    });

    // 2 Impact pathway (split by pair of boxes)
    const boxes = pathwayBoxes(model);
    const pairs = [[0, 2], [1, 3], [4, 5]].map(([a, b]) => [boxes[a], boxes[b]]);
    const boxHTML = box => `
        <div class="rp-pbox rp-tone-${box.key}">
            <div class="rp-pbox-head"><b>${esc(box.th)}</b><span>${box.en}</span></div>
            <div class="rp-pbox-body">${bullets(box.lines.map(lineHTML))}</div>
        </div>`;
    blocks.push({
        items: pairs,
        minSplit: 1,
        html: (items, continued) => (continued ? sectionHeading(2, 'Impact Pathway', true) : sectionHeading(2, 'Impact Pathway'))
            + card('ห่วงโซ่ผลกระทบ (Impact Pathway)', items.map(([left, right]) =>
                `<div class="rp-pair">${boxHTML(left)}${boxHTML(right)}</div>`).join(''))
    });

    // I3 indicators + theory of change
    const p = model.pathway;
    blocks.push({
        html: () => sectionHeading(2, 'Indicator และ Theory of Change')
            + card('Theory of Change', hasText(p.toc) ? `<p class="rp-text">${esc(p.toc.trim())}</p>` : '<p class="rp-empty">ไม่ได้ระบุ</p>')
    });
    blocks.push({
        html: () => card('ตัวชี้วัด (Indicators)', `<div class="rp-triple">
            ${[['Output', p.indicatorOutput], ['Outcome', p.indicatorOutcome], ['Impact', p.indicatorImpact]].map(([label, value]) => `
                <div><h4 class="rp-sub">Indicator ของ ${label}</h4>${bullets(textLines(value).map(esc))}</div>`).join('')}
        </div>`)
    });

    return blocks;
}

function resultBlocks(model) {
    const r = model.results;
    const f = resultFigures(model);
    const blocks = [];

    const interpretation = [
        r.ratio > 1
            ? `<b>SROI ${f.ratio} : 1</b> — ทุกการลงทุน 1 บาท สร้างคุณค่าทางสังคมเทียบเท่า ${f.ratio} บาท (ค่า > 1 หมายถึงคุ้มค่าต่อการลงทุน)`
            : `<b>SROI ${f.ratio} : 1</b> — ทุกการลงทุน 1 บาท สร้างคุณค่าทางสังคมเทียบเท่า ${f.ratio} บาท (ค่า ≤ 1 หมายถึงคุณค่าที่เกิดขึ้นยังไม่เกินเงินลงทุน)`,
        `ผลประโยชน์รวม ${money(r.grossPV)} บาท หักกรณีฐาน ${money(r.baseCase)} บาท${r.grossPV > 0 ? ` (${percent(r.baseCase / r.grossPV)})` : ''} เพื่อตัดส่วนที่จะเกิดขึ้นเองอยู่แล้ว`,
        `ผลประโยชน์สุทธิหลังหักกรณีฐาน ${money(r.netBenefit)} บาท เมื่อเทียบกับเงินลงทุน ${money(r.investment)} บาท${r.irr === null ? '' : ` · IRR ${f.irr}`}`
    ];
    const table = `
        <table class="rp-table rp-table-kv"><tbody>
            <tr><td>Total Cost</td><td>${money(r.investment)} บาท</td></tr>
            <tr><td>ผลกระทบกรณีฐาน มูลค่ารวมปัจจุบัน</td><td>${money(r.baseCase)} บาท</td></tr>
            <tr><td>รวมผลประโยชน์ปัจจุบัน (ก่อนหักกรณีฐาน)</td><td>${money(r.grossPV)} บาท</td></tr>
            <tr><td>ผลประโยชน์ปัจจุบันสุทธิ หลังหักกรณีฐาน</td><td>${money(r.netBenefit)} บาท</td></tr>
            <tr class="rp-hi"><td>ผลตอบแทนทางสังคมจากการลงทุน (SROI)</td><td>${f.ratio} : 1</td></tr>
            <tr class="rp-hi"><td>อัตราผลตอบแทนภายใน (IRR)</td><td>${f.irr}</td></tr>
        </tbody></table>`;

    blocks.push({
        html: () => sectionHeading(3, 'ผลลัพธ์และหลักฐาน') + `<div class="rp-row rp-row-results">
            ${card('ผลตอบแทนการลงทุน', table)}
            ${card('การแปลผลตัวเลข SROI', `<ul class="rp-list">${interpretation.map(line => `<li>${line}</li>`).join('')}</ul>`)}
        </div>`
    });
    blocks.push(photoBlock(model));

    // site visit text (split by paragraph), then the focus-group quote
    const paragraphs = String(model.site.takeaway ?? '').split(/\r?\n+/).map(item => item.trim()).filter(Boolean);
    const quote = String(model.site.quote ?? '').trim();
    if (paragraphs.length) {
        blocks.push({
            items: paragraphs,
            html: items => card('คุณค่าต่อชุมชนและท้องถิ่น (Site Visit)',
                items.map(text => `<p class="rp-text rp-italic">${esc(text)}</p>`).join(''))
        });
    }
    if (quote) {
        blocks.push({ html: () => card('Quote จาก Focus Group Interview', `<p class="rp-quote">“${esc(quote)}”</p>`) });
    }
    if (!paragraphs.length && !quote) {
        blocks.push({ html: () => card('คุณค่าต่อชุมชนและท้องถิ่น (Site Visit)', '<p class="rp-empty">ยังไม่มีข้อมูลจากการลงพื้นที่</p>') });
    }
    return blocks;
}

function calculationBlocks(model) {
    const rows = model.rows;
    if (!rows.length) return [];
    const blocks = [];

    const rowCells = (row, index) => `
        <tr>
            <td class="rp-c">${index + 1}</td>
            <td>${esc(row.stakeholders || '-')}</td>
            <td>${esc(row.outcome || '-')}</td>
            <td class="rp-n">${formatNumber(row.quantity)} ${esc(row.unit)}</td>
            <td class="rp-n">${money(row.monetaryValue)}</td>
            <td class="rp-n">${percent(row.deadweight)}</td>
            <td class="rp-n">${percent(row.displacement)}</td>
            <td class="rp-n">${percent(row.attribution)}</td>
            <td class="rp-n">${percent(row.dropoff)}</td>
            <td class="rp-n">${row.duration}</td>
            <td class="rp-n">${row.startYear}</td>
            <td class="rp-n">${(row.discountRate * 100).toFixed(2)}%</td>
            <td class="rp-n"><b>${money(row.totalPV)}</b></td>
        </tr>`;

    blocks.push({
        items: rows.map((row, index) => ({ row, index })),
        html: (items, continued) => sectionHeading(4, 'รายละเอียดการคำนวณ SROI', continued)
            + card('สมมติฐานและผลการคำนวณรายแถว (Outcome rows)', `
                <table class="rp-table rp-table-rows">
                    <thead><tr>
                        <th>#</th><th>ผู้มีส่วนได้ส่วนเสีย</th><th>Outcome / Impact</th><th>จำนวนผู้ได้รับ</th><th>มูลค่า / หน่วย / ปี (บาท)</th>
                        <th>Deadweight</th><th>Displacement</th><th>Attribution</th><th>Drop-off</th><th>ระยะเวลา (ปี)</th><th>เริ่มปีที่</th><th>Discount</th><th>PV (บาท)</th>
                    </tr></thead>
                    <tbody>${items.map(({ row, index }) => rowCells(row, index)).join('')}</tbody>
                </table>`)
    });

    const basis = rows.map((row, index) => ({ row, index })).filter(({ row }) => hasText(row.valuation) || hasText(row.indicator) || hasText(row.depth));
    if (basis.length) {
        blocks.push({
            items: basis,
            html: items => card('ที่มาของมูลค่าและตัวชี้วัดของแต่ละแถว', `<ol class="rp-basis">${items.map(({ row, index }) => `
                <li value="${index + 1}"><strong>${esc(row.outcome || row.stakeholders || `แถวที่ ${index + 1}`)}</strong>
                    ${hasText(row.depth) ? `<p><b>การเปลี่ยนแปลงต่อหน่วย:</b> ${esc(row.depth.trim())}</p>` : ''}
                    ${hasText(row.valuation) ? `<p><b>วิธีกำหนดมูลค่า / ตัวแทนทางการเงิน:</b> ${esc(row.valuation.trim())}</p>` : ''}
                    ${hasText(row.indicator) ? `<p><b>ตัวชี้วัดและแหล่งข้อมูล:</b> ${esc(row.indicator.trim())}</p>` : ''}
                </li>`).join('')}</ol>`)
        });
    }

    // year-by-year (split by table row)
    const years = [0, 1, 2, 3, 4, 5];
    const cell = value => `<td class="rp-n">${value ? money(value) : '<span class="rp-dash">-</span>'}</td>`;
    const rate = rows.every(row => row.discountRate === rows[0].discountRate) ? rows[0].discountRate : null;
    const yearly = [];
    yearly.push({ kind: 'section', title: 'ต้นทุนโครงการ (Cost)' });
    yearly.push({ kind: 'row', title: 'เงินลงทุนรวม', values: years.map(year => (year === 0 ? model.results.investment : 0)), total: model.results.investment });
    yearly.push({ kind: 'section', title: 'ผลประโยชน์หลังปรับ (ก่อนคิดลด)' });
    rows.forEach(row => yearly.push({ kind: 'row', title: row.outcome || row.stakeholders || 'Outcome', sub: row.stakeholders, values: row.benefitYearly, total: row.benefitYearly.reduce((a, b) => a + b, 0) }));
    yearly.push({ kind: 'section', title: 'มูลค่าปัจจุบัน (Present value)' });
    rows.forEach(row => yearly.push({ kind: 'row', title: row.outcome || row.stakeholders || 'Outcome', sub: row.stakeholders, values: row.yearlyValues, total: row.totalPV }));
    yearly.push({ kind: 'total', title: 'รวมมูลค่าปัจจุบัน (Total PV)', values: model.calcYearly, total: model.results.totalPV });
    yearly.push({
        kind: 'factor',
        title: rate === null ? 'Present value factor (ต่างกันในแต่ละแถว)' : `Present value factor (discount rate ${(rate * 100).toFixed(2)}%)`,
        values: rate === null ? null : years.map(year => 1 / Math.pow(1 + rate, year))
    });

    blocks.push({
        items: yearly,
        minSplit: 5,
        html: (items, continued) => card(continued ? 'ตารางผลการคำนวณรายปี (ต่อ)' : 'ตารางผลการคำนวณรายปี', `
            <table class="rp-table rp-table-years">
                <thead><tr><th>รายการ (บาท)</th>${years.map(year => `<th>ปีที่ ${year}</th>`).join('')}<th>รวม</th></tr></thead>
                <tbody>${items.map(item => {
                    if (item.kind === 'section') return `<tr class="rp-sec"><td colspan="8">${esc(item.title)}</td></tr>`;
                    const label = `${esc(item.title)}${item.sub ? `<span class="rp-sub-line">${esc(item.sub)}</span>` : ''}`;
                    if (item.kind === 'factor') {
                        return `<tr><td>${label}</td>${item.values ? item.values.map(v => `<td class="rp-n">${v.toFixed(4)}</td>`).join('') : '<td colspan="6"></td>'}<td></td></tr>`;
                    }
                    const total = `<td class="rp-n"><b>${item.total ? money(item.total) : '-'}</b></td>`;
                    return `<tr class="${item.kind === 'total' ? 'rp-hi' : ''}"><td>${label}</td>${item.values.map(cell).join('')}${total}</tr>`;
                }).join('')}</tbody>
            </table>`)
    });

    return blocks;
}

// ---- page frame and pagination ------------------------------------------------------------

function pageFrame(model, number) {
    const page = document.createElement('div');
    page.className = 'rp-page';
    page.innerHTML = `
        <header class="rp-head"><span>ระบบประเมินผลตอบแทนทางสังคม · Chula Triple S Platform</span><span class="rp-head-title">${esc(model.name)}</span></header>
        <div class="rp-body"></div>
        <footer class="rp-foot"><span>รายงานสร้างวันที่ ${esc(model.generatedOn)}</span><span class="rp-pageno">หน้า ${number}</span></footer>`;
    return page;
}

const overflows = body => body.scrollHeight > body.clientHeight + 1;

/**
 * Make a block (already in the page's body) a little smaller by lowering its text-size scale
 * (--rp-fs), step by step, until the page no longer overflows; `floor` is the smallest fraction of
 * the normal size allowed. Returns whether it now fits. A CSS variable rather than a transform:
 * Safari places transformed elements wrongly inside the SVG the PDF is drawn through.
 */
function fitByTextScale(el, body, floor) {
    const base = Number.parseFloat(getComputedStyle(el).getPropertyValue('--rp-fs')) || 1;
    for (let factor = 0.95; factor >= floor - 1e-9; factor -= 0.05) {
        el.style.setProperty('--rp-fs', String(base * factor));
        if (!overflows(body)) return true;
    }
    el.style.removeProperty('--rp-fs');
    return false;
}

/** Lower a CSS variable (1 -> floor, in 5% steps) on the block until the page stops overflowing. */
function fitByVariable(el, body, name, floor) {
    for (let value = 0.95; value >= floor - 1e-9; value -= 0.05) {
        el.style.setProperty(name, value.toFixed(2));
        if (!overflows(body)) return true;
    }
    el.style.removeProperty(name);
    return false;
}

/** Too tall for even an empty page: shrink its text (rare -- keeps every word rather than clipping). */
function shrinkToFit(el, body) {
    if (overflows(body) && !fitByTextScale(el, body, 0.55)) {
        const base = Number.parseFloat(getComputedStyle(el).getPropertyValue('--rp-fs')) || 1;
        el.style.setProperty('--rp-fs', String(base * 0.55));
    }
}

/** A block that misses the page by a little is shrunk to fit instead of leaving the rest of the page empty. */
const MAX_SQUEEZE = 0.12;
function squeezeIn(el, body, block) {
    body.append(el);
    if (!overflows(body)) return true;
    if (fitByTextScale(el, body, 1 - (block.maxSqueeze ?? MAX_SQUEEZE))) return true;
    if (block.shrinkVar && fitByVariable(el, body, block.shrinkVar.name, block.shrinkVar.floor)) return true;
    el.remove();
    return false;
}

function paginate(stage, model, blocks) {
    const pages = [];
    let body = null;

    const newPage = () => {
        const page = pageFrame(model, pages.length + 1);
        stage.append(page);
        pages.push(page);
        body = page.querySelector('.rp-body');
    };
    const wrap = html => {
        const holder = document.createElement('div');
        holder.className = 'rp-block';
        holder.innerHTML = html;
        return holder;
    };
    const tryAppend = el => {
        body.append(el);
        if (!overflows(body)) return true;
        el.remove();
        return false;
    };

    newPage();
    blocks.forEach(block => {
        let items = block.items ?? null;
        let continued = false;
        const make = (list, isContinued) => wrap(block.html(list, isContinued));

        const minSplit = block.minSplit ?? 2; // fewest items worth leaving behind on a page that already has content

        for (;;) {
            const el = make(items, continued);
            if (tryAppend(el)) break;                                   // fits here

            if (body.children.length && squeezeIn(el, body, block)) break;     // misses by a little: shrink it in
            if (items && items.length > minSplit && body.children.length) { // long list/table: fill what is left of this page first
                let count = items.length - 1;
                while (count >= minSplit && !tryAppend(make(items.slice(0, count), continued))) count -= 1;
                if (count >= minSplit) { items = items.slice(count); continued = true; newPage(); continue; }
            }
            if (body.children.length) { newPage(); continue; }          // try again on a fresh page

            if (items && items.length > 1) {                            // list/table too long for a page: split it
                let count = items.length - 1;
                while (count >= 1) {
                    if (tryAppend(make(items.slice(0, count), continued))) break;
                    count -= 1;
                }
                if (count >= 1) { items = items.slice(count); continued = true; newPage(); continue; }
            }
            body.append(el);                                            // one block taller than a page
            shrinkToFit(el, body);
            break;
        }
    });

    pages.forEach((page, index) => {
        page.querySelector('.rp-pageno').textContent = `หน้า ${index + 1} / ${pages.length}`;
    });
    return pages;
}

/** The report's blocks, in reading order, for either surface. */
function reportBlocks(model, mode) {
    return mode === 'summary'
        ? summaryBlocks(model)
        : [...infoBlocks(model), ...resultBlocks(model), ...calculationBlocks(model)];
}

/**
 * On screen: the report as ONE long, ordinary web page (no sheets, no page breaks). It is the same
 * blocks the paper pages are made from, just flowed in a single column that wraps to the window.
 * @param {'summary'|'full'} mode
 */
export function renderReportWeb(stage, model, mode) {
    const blocks = reportBlocks(model, mode).map(block =>
        `<div class="rp-block">${block.html(block.items ?? null, false)}</div>`).join('');
    const web = document.createElement('div');
    web.className = 'rp-web';
    web.innerHTML = `${blocks}<p class="rp-web-foot">รายงานสร้างวันที่ ${esc(model.generatedOn)}</p>`;
    stage.replaceChildren(web);
    return web;
}

/**
 * For download: the report as A4 landscape pages, in the same order as the web view. Blocks are
 * placed one after another by measuring real layout; a long list or table continues on the next
 * page, and a block that only just misses a page is shrunk slightly to keep pages full.
 * `stage` must be rendered (it may be off-screen, not display:none).
 * @param {'summary'|'full'} mode
 */
export async function renderReportPages(stage, model, mode) {
    try { await document.fonts?.ready; } catch { /* no font API: measure with what is loaded */ }
    stage.replaceChildren();
    return paginate(stage, model, reportBlocks(model, mode));
}

// ---- PDF ----------------------------------------------------------------------------------

const imagesReady = root => Promise.all(Array.from(root.querySelectorAll('img')).map(img =>
    (img.complete && img.naturalWidth) ? null : new Promise(resolve => { img.onload = img.onerror = resolve; })));

/** True if the canvas is (almost) all white: a failed drawing, not a page. */
function looksBlank(canvas) {
    const context = canvas.getContext('2d');
    for (let index = 0; index < 400; index += 1) {
        const x = Math.floor(Math.random() * canvas.width);
        const y = Math.floor(Math.random() * canvas.height);
        const [r, g, b] = context.getImageData(x, y, 1, 1).data;
        if (r < 250 || g < 250 || b < 250) return false;
    }
    return true;
}

/**
 * A page as a canvas. The browser's own renderer first (exact text and picture placement, see
 * domRaster.js); html2canvas only if that is not available or draws nothing.
 */
async function pageToCanvas(clone) {
    try {
        const canvas = await rasteriseElement(clone, { width: PAGE_W, height: PAGE_H, pixelRatio: 2 });
        if (!looksBlank(canvas)) return canvas;
    } catch (error) {
        console.warn('Falling back to html2canvas for the PDF', error);
    }
    const { default: html2canvas } = await import('html2canvas');
    return html2canvas(clone, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: PAGE_W,
        height: PAGE_H,
        windowWidth: PAGE_W,
        logging: false
    });
}

/**
 * One A4 landscape PDF page per report page. Each page is cloned off-screen at its real size and
 * photographed at 2x, so text stays crisp when printed. `onProgress(done, total)` is called after
 * each page.
 */
export async function exportPagesToPdf(pages, fileName, onProgress = () => {}) {
    const { jsPDF } = await import('jspdf');

    const holder = document.createElement('div');
    holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_W}px;pointer-events:none;`;
    document.body.append(holder);

    try {
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
        for (let index = 0; index < pages.length; index += 1) {
            const clone = pages[index].cloneNode(true);
            clone.style.transform = 'none';
            clone.style.width = `${PAGE_W}px`;
            clone.style.height = `${PAGE_H}px`;
            holder.replaceChildren(clone);
            await imagesReady(clone);

            const canvas = await pageToCanvas(clone);
            if (index > 0) pdf.addPage('a4', 'landscape');
            pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
            onProgress(index + 1, pages.length);
        }
        pdf.save(fileName);
    } finally {
        holder.remove();
    }
}
