let rows = [];
let currentModalItems = [];
let currentSort = { key:null, dir:1 };
let valueMode = 'sum'; // 'sum' | 'qty'

const COL = {
    dtLost: 'Дата последнего списания',
    product: 'ШК',
    lossId: 'Лостризон последнего списания',
    comment: 'Комментарий последнего списания',
    sum: 'Сумма списания',
    counterpartyType: 'Тип контрагента',
    counterpartyId: 'Контрагент ID',
    postedDate: 'Дата оприходования',
    postedFlag: 'Флаг оприходования',
    status: 'Статус перед списанием'
};

const AUTO_IDS = new Set([11,21,26,31,32,35,42,47]);
const STATUS_PALETTE = [
    '#2563eb','#f59e0b','#10b981','#ef4444','#8b5cf6',
    '#06b6d4','#f97316','#84cc16','#ec4899','#64748b'
];
const DONUT_PALETTE = [
    '#355070','#6d597a','#b56576','#e56b6f','#eaac8b',
    '#5c7c8a','#8d6a9f','#c97f92','#d88c7a','#7a8f9f'
];
const NO_BARCODE_SECTION_TITLE = 'Товар "Без ШК" WMS+';
const NM_ID_COLUMN_CANDIDATES = [
    'ID номенклатуры',
    'ID Номенклатуры',
    'ID НМ',
    'НМ',
    'Номенклатура',
    'nm',
    'nm_id',
    'nmId'
];
const NO_BARCODE_KEYS = {
    lossDate: '__no_barcode_loss_date',
    nmId: '__no_barcode_nm_id',
    nearestNmRepDate: '__no_barcode_nearest_nm_rep_date',
    nmRepEmp: '__no_barcode_nm_rep_emp',
    nmRepMatches: '__no_barcode_nm_rep_matches',
    nmRepDates: '__no_barcode_nm_rep_dates'
};
const NO_BARCODE_DATE_SORT_KEYS = new Set([
    COL.dtLost,
    NO_BARCODE_KEYS.lossDate,
    NO_BARCODE_KEYS.nearestNmRepDate
]);
const NO_BARCODE_MODAL_COLUMNS = [
    { key:NO_BARCODE_KEYS.lossDate, title:'Дата списания' },
    { key:NO_BARCODE_KEYS.nmId, title:'ID номенклатуры' },
    { key:NO_BARCODE_KEYS.nearestNmRepDate, title:'Ближайшая дата в nm_rep' },
    { key:NO_BARCODE_KEYS.nmRepEmp, title:'ID сотрудника emp (nm_rep)' },
    { key:NO_BARCODE_KEYS.nmRepMatches, title:'Совпадений в nm_rep' },
    { key:NO_BARCODE_KEYS.nmRepDates, title:'Даты совпадений nm_rep' },
    { key:COL.product, title:'ШК' },
    { key:COL.sum, title:'Сумма' },
    { key:'Родительская категория товара', title:'Категория' },
    { key:'Подкатегория товара', title:'Подкатегория' },
    { key:'Бренд', title:'Бренд' }
];

const writeoffNameById = new Map();
let writeoffNamesLoaded = false;
let noBarcodeNmRepCache = { rowsRef:null, promise:null, result:null };
let noBarcodeRenderToken = 0;

/* ================= FILE ================= */

document.getElementById('file-input').addEventListener('change', handleFile);
document.getElementById('export-filtered').onclick = exportAll;
initValueToggle();
loadWriteoffNames();
initPdfExport();

function initValueToggle(){
    const btn = document.getElementById('unit-toggle-btn');
    if(!btn) return;

    const sync = ()=>{
        const qty = valueMode === 'qty';
        btn.classList.toggle('active', qty);
        btn.textContent = qty ? 'ШТ' : '₽';
        btn.title = qty
            ? 'Режим графиков: ШТ'
            : 'Режим графиков: ₽';
    };

    sync();
    btn.onclick = ()=>{
        valueMode = valueMode === 'sum' ? 'qty' : 'sum';
        sync();
        if(rows.length){
            renderReport();
        }
        if(currentModalState){
            renderModalState(currentModalState, { push:false });
        }
    };
}

function handleFile(e){
    const file = e.target.files[0];
    if(!file) return;

    file.arrayBuffer().then(buf=>{
        const wb = XLSX.read(buf,{type:'array'});
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet,{defval:''});
        resetNoBarcodeCache();

        if(!rows.length){
            MiniUI.toast('Файл пустой',{type:'error'});
            return;
        }
        renderReport();
    });
}

function resetNoBarcodeCache(){
    noBarcodeNmRepCache = { rowsRef:null, promise:null, result:null };
}

function exportAll(){
    if(!rows.length){
        MiniUI.toast('Нет данных для выгрузки',{type:'info'});
        return;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Потери');
    XLSX.writeFile(wb, 'pure_losses_export.xlsx');
}

/* ================= PDF ================= */

function initPdfExport(){
    const btn = document.getElementById('export-pdf');
    if(!btn) return;

    btn.onclick = ()=>{
        if(!rows.length){
            MiniUI.toast('Нет данных для выгрузки',{type:'info'});
            return;
        }
        openPdfModal();
    };

    const modal = document.getElementById('pdf-modal');
    const cancelBtn = document.getElementById('pdf-cancel-btn');
    const genBtn = document.getElementById('pdf-generate-btn');
    const input = document.getElementById('pdf-title-input');

    if(modal){
        modal.onclick = (e)=>{
            if(e.target === modal || e.target.classList.contains('modal-backdrop')){
                closePdfModal();
            }
        };
    }
    if(cancelBtn){
        cancelBtn.onclick = closePdfModal;
    }
    if(genBtn){
        genBtn.onclick = async ()=>{
            const title = String(input?.value || '').trim() || 'Чистые списания';
            await generatePdf(title);
            closePdfModal();
        };
    }
    if(input){
        input.onkeydown = (e)=>{
            if(e.key === 'Enter'){
                e.preventDefault();
                genBtn?.click();
            }
        };
    }
}

function openPdfModal(){
    const modal = document.getElementById('pdf-modal');
    const input = document.getElementById('pdf-title-input');
    if(input){
        if(!input.value) input.value = 'Чистые списания';
        setTimeout(()=>input.focus(), 0);
        input.select();
    }
    modal?.classList.remove('hidden');
}

function closePdfModal(){
    document.getElementById('pdf-modal')?.classList.add('hidden');
}

async function generatePdf(title){
    if(!rows.length){
        MiniUI.toast('Нет данных для выгрузки',{type:'info'});
        return;
    }
    if(!window.jspdf?.jsPDF){
        MiniUI.toast('PDF библиотека не загрузилась',{type:'error'});
        return;
    }

    const { jsPDF } = window.jspdf;
    const pageW = 1280;
    const pageH = 720;
    const margin = 64;
    const doc = new jsPDF({
        orientation:'landscape',
        unit:'pt',
        format:[pageW, pageH]
    });

    const theme = getThemeColors();
    await ensurePdfAssetsLoaded();

    const slides = await buildPdfSlides({ title, pageW, pageH, margin, theme });

    slides.forEach((dataUrl, i)=>{
        if(i > 0) doc.addPage();
        doc.addImage(dataUrl, 'PNG', 0, 0, pageW, pageH);
    });

    const fileDate = (window.MiniUI?.todayIsoDatePlus3 ? window.MiniUI.todayIsoDatePlus3() : new Date().toISOString().slice(0,10));
    const filename = `pure_losses_${safeFilePart(title)}_${fileDate}.pdf`;
    doc.save(filename);
}

function getThemeColors(){
    return {
        accent:'#E15554',
        accentDark:'#E15554',
        success:'#33C481',
        text:'#000000',
        textSoft:'#1f2937',
        muted:'#374151',
        card:'#ffffff',
        border:'#d1d5db'
    };
}

const PDF_SCALE = 2.5;
const PDF_FONT_FAMILY = '"Inter","Arial","Helvetica",sans-serif';
const PDF_TITLE_SIZE = 64;
const PDF_SUBTITLE_SIZE = 32;
const PDF_BODY_SIZE = 24;
const PDF_FOOTER_HEIGHT = 96;
const PDF_FOOTER_SIDE_PADDING = 36;
const PDF_FOOTER_BOTTOM_PADDING = 18;
const PDF_FOOTER_LOGO_MAX_H = 46;
const PDF_FOOTER_LOGO_MAX_W = 240;
const PDF_RIGHT_LOGO_BADGE_RADIUS = 136;
const STATS_BG_GREEN = '#3BB273';
const MANUAL_KPI_YELLOW = '#EAB308';
const PDF_LOGO_RIGHT_URL = 'https://raw.githubusercontent.com/mevukolov/WMSplus/refs/heads/main/icons/WB_logo.png';
const PDF_LOGO_LEFT_URL = 'https://raw.githubusercontent.com/mevukolov/WMSplus/refs/heads/main/icons/50144199_logo.png';
const FIGMA_STATS_SCALE = 2 / 3;
const STATS_SLIDE_ASSETS = {
    vector22:'https://www.figma.com/api/mcp/asset/4e577bbe-c1aa-41ba-bbe6-4bb4c9aee1cb',
    vector24:'https://www.figma.com/api/mcp/asset/34c75d27-5c19-4574-8c7c-e6a9c5b1068b',
    vector23:'https://www.figma.com/api/mcp/asset/28b7460d-fd49-4397-a0ab-46c9a6bdd71c',
    vector25:'https://www.figma.com/api/mcp/asset/83f3358b-6550-4d44-951a-2786a48e0758',
    ellipse4:'https://www.figma.com/api/mcp/asset/9561e793-bd9e-4513-a2fa-c759ddcc7b3e',
    vector27:'https://www.figma.com/api/mcp/asset/639494b8-5f6f-4eb1-9c00-9dfe7d81b8a0',
    ellipse5:'https://www.figma.com/api/mcp/asset/22516f84-439c-4ff1-8376-874af8cc33f3',
    ellipse3:'https://www.figma.com/api/mcp/asset/fd87c59c-0942-4b56-89f8-ca2f387522cb'
};
const footerLogoCache = new Map();

function getFooterTopY(pageH){
    return pageH - PDF_FOOTER_HEIGHT;
}

function getContentBottomY(pageH){
    return getFooterTopY(pageH) - 16;
}

async function ensurePdfAssetsLoaded(){
    const tasks = [preloadFooterLogos(), preloadStatsSlideAssets()];
    if(document.fonts?.load){
        tasks.push(document.fonts.load(`700 ${PDF_TITLE_SIZE}px Inter`));
        tasks.push(document.fonts.load(`500 ${PDF_SUBTITLE_SIZE}px Inter`));
        tasks.push(document.fonts.load(`400 ${PDF_BODY_SIZE}px Inter`));
        tasks.push(document.fonts.ready);
    }
    await Promise.allSettled(tasks);
}

async function preloadFooterLogos(){
    await Promise.all([
        loadImageCached(PDF_LOGO_LEFT_URL),
        loadImageCached(PDF_LOGO_RIGHT_URL)
    ]);
}

async function preloadStatsSlideAssets(){
    await Promise.all(Object.values(STATS_SLIDE_ASSETS).map(loadImageCached));
}

function loadImageCached(url){
    if(footerLogoCache.has(url)){
        return footerLogoCache.get(url);
    }
    const promise = new Promise(resolve=>{
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = ()=>resolve(img);
        img.onerror = ()=>resolve(null);
        img.src = url;
    });
    footerLogoCache.set(url, promise);
    return promise;
}

async function buildPdfSlides(opts){
    const { title, pageW, pageH, margin, theme } = opts;
    const slides = [];

    slides.push(await renderTitleSlideCanvas({ title, pageW, pageH, theme }));
    slides.push(await renderStatsSlideCanvas({ pageW, pageH, margin, theme }));
    slides.push(...await renderInsightsSlideCanvases({ pageW, pageH, margin, theme }));

    const autoItems = rows.filter(r=>AUTO_IDS.has(Number(r[COL.lossId])));
    slides.push(await renderAutoSlideCanvas({ pageW, pageH, margin, theme }));

    const topAuto = getTopWriteoffsBySum(autoItems, 3);
    for(const row of topAuto){
        slides.push(await renderWriteoffDetailSlideCanvas({
            pageW, pageH, margin, theme,
            lrId: row.id,
            name: row.name,
            items: row.items
        }));
    }

    slides.push(await renderManualSlideCanvas({ pageW, pageH, margin, theme }));

    return slides;
}

async function renderTitleSlideCanvas(opts){
    const { title, pageW, pageH, theme } = opts;
    const { canvas, ctx } = createSlideCanvas(pageW, pageH);
    const dateRange = getReportDateRange(rows);

    drawSlideBackground(ctx, pageW, pageH);
    await drawSlideFooter(ctx, pageW, pageH, theme);

    drawText(ctx, title, pageW / 2, pageH / 2 - 18, {
        size:PDF_TITLE_SIZE,
        weight:700,
        color:theme.text,
        align:'center'
    });

    drawText(ctx, dateRange, pageW / 2, pageH / 2 + 48, {
        size:PDF_SUBTITLE_SIZE,
        weight:500,
        color:theme.textSoft,
        align:'center'
    });

    return canvas.toDataURL('image/png', 1.0);
}

async function renderStatsSlideCanvas(opts){
    const { pageW, pageH, theme } = opts;
    const { canvas, ctx } = createSlideCanvas(pageW, pageH);
    const fx = (n)=>n * FIGMA_STATS_SCALE;
    const splitX = pageW / 2;

    drawSlideBackground(ctx, pageW, pageH);
    ctx.fillStyle = STATS_BG_GREEN;
    ctx.fillRect(splitX, 0, pageW - splitX, pageH);

    drawText(ctx, '1', fx(26), fx(796), {
        size:Math.round(493 * FIGMA_STATS_SCALE * 0.95),
        weight:800,
        color:'#E0E0E0',
        align:'left',
        baseline:'top'
    });

    drawText(ctx, 'Статистика', fx(96), fx(150), {
        size:PDF_TITLE_SIZE,
        weight:700,
        color:theme.text,
        align:'left'
    });
    drawText(ctx, 'Общая', fx(96), fx(212), {
        size:PDF_SUBTITLE_SIZE,
        weight:500,
        color:theme.text,
        align:'left'
    });

    const totalCount = countProducts(rows);
    const autoItems = rows.filter(r=>AUTO_IDS.has(Number(r[COL.lossId])));
    const manualItems = rows.filter(r=>!AUTO_IDS.has(Number(r[COL.lossId])));
    const postedItems = rows.filter(isOprihodRow);
    const autoCount = countProducts(autoItems);
    const manualCount = countProducts(manualItems);
    const postedCount = countProducts(postedItems);
    const postedAuto = countProducts(autoItems.filter(isOprihodRow));
    const postedManual = countProducts(manualItems.filter(isOprihodRow));
    const postedAutoPct = autoCount ? (postedAuto / autoCount) * 100 : 0;

    const kpiCircleCx = fx(1568.5);
    const kpiCircleCy = fx(161.5);
    const kpiCircleRadius = fx(181 / 2);
    drawKpiPercentCircle(ctx, kpiCircleCx, kpiCircleCy, kpiCircleRadius, postedAutoPct, STATS_BG_GREEN);

    drawText(ctx, 'Процент оприхода', fx(1465), fx(163), {
        size:PDF_BODY_SIZE,
        weight:500,
        color:'#FFFFFF',
        align:'right'
    });
    drawText(ctx, 'после автосписания:', fx(1465), fx(196), {
        size:PDF_BODY_SIZE,
        weight:500,
        color:'#FFFFFF',
        align:'right'
    });
    drawText(ctx, `${postedAutoPct.toFixed(0)}%`, kpiCircleCx, kpiCircleCy, {
        size:32,
        weight:700,
        color:STATS_BG_GREEN,
        align:'center',
        baseline:'middle'
    });

    drawText(ctx, format(totalCount), fx(492), fx(448), {
        size:88,
        weight:700,
        color:theme.text,
        align:'center'
    });
    drawText(ctx, format(postedCount), fx(1431), fx(448), {
        size:88,
        weight:700,
        color:'#FFFFFF',
        align:'center'
    });
    drawText(ctx, 'Всего списано ШК', fx(492), fx(522), {
        size:PDF_BODY_SIZE,
        weight:400,
        color:theme.text,
        align:'center'
    });
    drawText(ctx, 'Всего оприходовано ШК', fx(1431), fx(522), {
        size:PDF_BODY_SIZE,
        weight:400,
        color:'#FFFFFF',
        align:'center'
    });

    await drawImageFromUrlCached(ctx, STATS_SLIDE_ASSETS.vector22, fx(219), fx(410), fx(111), fx(114));
    await drawImageFromUrlCached(ctx, STATS_SLIDE_ASSETS.vector23, fx(677), fx(410), fx(54), fx(114.5), {
        flipX:true
    });
    await drawImageFromUrlCached(ctx, STATS_SLIDE_ASSETS.vector24, fx(1178), fx(410), fx(111), fx(114));
    await drawImageFromUrlCached(ctx, STATS_SLIDE_ASSETS.vector25, fx(1614), fx(410), fx(69), fx(114.5), {
        flipX:true
    });

    drawText(ctx, format(autoCount), fx(218), fx(622), {
        size:58,
        weight:500,
        color:theme.accent,
        align:'center'
    });
    drawText(ctx, format(manualCount), fx(730), fx(622), {
        size:58,
        weight:500,
        color:MANUAL_KPI_YELLOW,
        align:'center'
    });
    drawText(ctx, format(postedAuto), fx(1177), fx(622), {
        size:58,
        weight:500,
        color:'#FFFFFF',
        align:'center'
    });
    drawText(ctx, format(postedManual), fx(1682.5), fx(622), {
        size:58,
        weight:500,
        color:'#FFFFFF',
        align:'center'
    });

    drawText(ctx, 'Автосписания', fx(218), fx(664), {
        size:PDF_BODY_SIZE,
        weight:400,
        color:theme.text,
        align:'center'
    });
    drawText(ctx, 'Ручные списания', fx(730), fx(664), {
        size:PDF_BODY_SIZE,
        weight:400,
        color:theme.text,
        align:'center'
    });
    drawText(ctx, 'После автосписания', fx(1177), fx(664), {
        size:PDF_BODY_SIZE,
        weight:400,
        color:'#FFFFFF',
        align:'center'
    });
    drawText(ctx, 'После ручного', fx(1682.5), fx(664), {
        size:PDF_BODY_SIZE,
        weight:400,
        color:'#FFFFFF',
        align:'center'
    });
    drawText(ctx, 'списания', fx(1682.5), fx(698), {
        size:PDF_BODY_SIZE,
        weight:400,
        color:'#FFFFFF',
        align:'center'
    });

    await drawSlideFooter(ctx, pageW, pageH, theme);

    return canvas.toDataURL('image/png', 1.0);
}

async function renderInsightsSlideCanvases(opts){
    const { pageW, pageH, margin, theme } = opts;
    const insights = buildInsights(rows);
    const slides = [];

    const cardH = 110;
    const gap = 14;
    const cardW = pageW - margin * 2;
    const startY = 212;
    const contentBottom = getContentBottomY(pageH);
    const cardsPerSlide = Math.max(1, Math.floor((contentBottom - startY + gap) / (cardH + gap)));

    for(let i=0; i<insights.length; i += cardsPerSlide){
        const chunk = insights.slice(i, i + cardsPerSlide);
        const { canvas, ctx } = createSlideCanvas(pageW, pageH);

        drawSlideBackground(ctx, pageW, pageH);
        drawSectionTitle(
            ctx,
            'Инсайты',
            i === 0 ? 'Быстрые наблюдения' : 'Продолжение',
            margin,
            92,
            theme
        );

        chunk.forEach((text, idx)=>{
            const y = startY + idx * (cardH + gap);
            drawInsightCard(ctx, margin, y, cardW, cardH, text, theme);
        });

        await drawSlideFooter(ctx, pageW, pageH, theme);
        slides.push(canvas.toDataURL('image/png', 1.0));
    }

    if(!slides.length){
        const { canvas, ctx } = createSlideCanvas(pageW, pageH);
        drawSlideBackground(ctx, pageW, pageH);
        drawSectionTitle(ctx, 'Инсайты', 'Быстрые наблюдения', margin, 92, theme);
        drawInsightCard(ctx, margin, 212, pageW - margin * 2, 110, 'Недостаточно данных для инсайтов', theme);
        await drawSlideFooter(ctx, pageW, pageH, theme);
        slides.push(canvas.toDataURL('image/png', 1.0));
    }

    return slides;
}

async function renderAutoSlideCanvas(opts){
    return renderWriteoffSlideCanvas({
        ...opts,
        title:'Автосписания',
        items: rows.filter(r=>AUTO_IDS.has(Number(r[COL.lossId]))),
        totalLabel:'Автосписания'
    });
}

async function renderManualSlideCanvas(opts){
    return renderWriteoffSlideCanvas({
        ...opts,
        title:'Ручные списания',
        items: rows.filter(r=>!AUTO_IDS.has(Number(r[COL.lossId]))),
        totalLabel:'Ручные списания'
    });
}

async function renderWriteoffSlideCanvas(opts){
    const { pageW, pageH, margin, theme, title, items, totalLabel } = opts;
    const { canvas, ctx } = createSlideCanvas(pageW, pageH);
    const contentBottom = getContentBottomY(pageH);

    drawSlideBackground(ctx, pageW, pageH);
    drawSectionTitle(ctx, 'Статистика', title, margin, 92, theme);

    const totalCount = countProducts(items);
    const totalSum = sumField(items, COL.sum);
    const postedItems = items.filter(isOprihodRow);
    const postedCount = countProducts(postedItems);
    const postedSum = sumField(postedItems, COL.sum);

    drawText(ctx, `${totalLabel} — Статистика за период`, margin, 184, {
        size:PDF_BODY_SIZE,
        weight:500,
        color:theme.accentDark,
        align:'left'
    });

    const rowsList = getTopWriteoffsBySum(items, 3);

    let y = 224;
    rowsList.forEach((row, idx)=>{
        const pct = totalCount ? (row.count / totalCount) * 100 : 0;
        drawWriteoffRow(ctx, {
            x: margin,
            y,
            w: pageW - margin * 2,
            h: 86,
            theme,
            idx,
            row,
            pct
        });
        y += 98;
    });

    drawText(ctx, `Всего: ${format(totalCount)} ШК — ₽ ${format(totalSum)}`, margin, contentBottom - 30, {
        size:22,
        weight:500,
        color:theme.accent,
        align:'left'
    });
    drawText(ctx, `Оприходовано: ${format(postedCount)} ШК — ₽ ${format(postedSum)}`, margin, contentBottom, {
        size:22,
        weight:400,
        color:theme.success,
        align:'left'
    });
    await drawSlideFooter(ctx, pageW, pageH, theme);

    return canvas.toDataURL('image/png', 1.0);
}

function buildTimelineData(){
    const byDate = {};
    const byPostedDate = {};

    rows.forEach(r=>{
        const d = normalizeDate(r[COL.dtLost]);
        if(d){
            byDate[d] ??= [];
            byDate[d].push(r);
        }
        const pd = getPostedDateKey(r);
        if(pd){
            byPostedDate[pd] ??= [];
            byPostedDate[pd].push(r);
        }
    });

    const labels = Array.from(new Set([
        ...Object.keys(byDate),
        ...Object.keys(byPostedDate)
    ])).sort(sortDates);

    const total = [];
    const auto = [];
    const manual = [];
    const posted = [];

    labels.forEach(d=>{
        const items = byDate[d] || [];
        const a = items.filter(r=>AUTO_IDS.has(Number(r[COL.lossId])));
        const m = items.filter(r=>!AUTO_IDS.has(Number(r[COL.lossId])));
        const p = byPostedDate[d] || [];

        total.push(sumField(items, COL.sum));
        auto.push(sumField(a, COL.sum));
        manual.push(sumField(m, COL.sum));
        posted.push(sumField(p, COL.sum));
    });

    return { labels, total, auto, manual, posted };
}

async function createChartImage(config, width, height){
    const canvas = document.createElement('canvas');
    const scale = PDF_SCALE;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const chart = new Chart(ctx, {
        ...config,
        options:{
            ...(config.options || {}),
            animation:false,
            responsive:false,
            maintainAspectRatio:false
        }
    });
    chart.update();
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    chart.destroy();
    return dataUrl;
}

function formatDateHuman(d){
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
}

function createSlideCanvas(w, h){
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * PDF_SCALE);
    canvas.height = Math.round(h * PDF_SCALE);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(PDF_SCALE, 0, 0, PDF_SCALE, 0, 0);
    return { canvas, ctx };
}

function drawSlideBackground(ctx, w, h){
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
}

async function drawSlideFooter(ctx, pageW, pageH){
    const [leftLogo, rightLogo] = await Promise.all([
        loadImageCached(PDF_LOGO_LEFT_URL),
        loadImageCached(PDF_LOGO_RIGHT_URL)
    ]);

    if(leftLogo){
        drawFooterLogo(ctx, leftLogo, {
            x: PDF_FOOTER_SIDE_PADDING,
            y: pageH - PDF_FOOTER_BOTTOM_PADDING,
            maxW: PDF_FOOTER_LOGO_MAX_W * 1.5,
            maxH: PDF_FOOTER_LOGO_MAX_H * 1.5,
            align:'left'
        });
    }

    if(rightLogo){
        const rightBadgeCx = pageW - PDF_RIGHT_LOGO_BADGE_RADIUS * 0.18;
        const rightBadgeCy = pageH - PDF_RIGHT_LOGO_BADGE_RADIUS * 0.18;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(rightBadgeCx, rightBadgeCy, PDF_RIGHT_LOGO_BADGE_RADIUS, 0, Math.PI * 2);
        ctx.fill();

        drawFooterLogo(ctx, rightLogo, {
            x: pageW - PDF_FOOTER_SIDE_PADDING,
            y: pageH - PDF_FOOTER_BOTTOM_PADDING,
            maxW: 180,
            maxH: 45,
            align:'right'
        });
    }
}

function drawText(ctx, text, x, y, opts){
    const {
        size=PDF_BODY_SIZE,
        weight=400,
        color='#000000',
        align='left',
        baseline='alphabetic'
    } = opts || {};
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.font = `${weight} ${size}px ${PDF_FONT_FAMILY}`;
    ctx.fillText(text, x, y);
}

function drawSectionTitle(ctx, title, subtitle, x, y, theme){
    drawText(ctx, title, x, y, { size:PDF_TITLE_SIZE, weight:700, color:theme.text, align:'left' });
    drawText(ctx, subtitle, x, y + 44, { size:PDF_SUBTITLE_SIZE, weight:500, color:theme.textSoft, align:'left' });
}

function drawStatCard(ctx, x, y, w, h, label, value, theme, isFound=false){
    ctx.fillStyle = theme.card;
    ctx.strokeStyle = theme.border;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isFound ? theme.success : theme.accent;
    ctx.fillRect(x + 12, y + 16, 4, h - 32);

    drawText(ctx, label, x + 24, y + 34, { size:16, weight:500, color:theme.textSoft, align:'left' });
    drawText(ctx, value, x + 24, y + 72, { size:30, weight:700, color:isFound ? theme.success : theme.accent, align:'left' });
}

function drawWriteoffRow(ctx, opts){
    const { x, y, w, h, theme, row, pct } = opts;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = theme.border;
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = theme.accent;
    ctx.fillRect(x + 14, y + 14, 5, h - 28);

    const title = `LR ${row.id}`;
    drawText(ctx, title, x + 28, y + 32, { size:20, weight:700, color:theme.text, align:'left' });
    drawText(ctx, row.name, x + 112, y + 32, { size:16, weight:400, color:theme.muted, align:'left' });

    const line1 = `${format(row.count)} ШК – ₽ ${format(row.sum)} = ${pct.toFixed(2)}%`;
    const line2 = `Оприходовано: ${format(row.postedCount)} ШК – ₽ ${format(row.postedSum)}`;
    drawText(ctx, line1, x + 28, y + 60, { size:16, weight:500, color:theme.accent, align:'left' });
    drawText(ctx, line2, x + 28, y + 80, { size:16, weight:400, color:theme.success, align:'left' });
}

function roundRect(ctx, x, y, w, h, r){
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function drawFooterLogo(ctx, img, opts){
    const { x, y, maxW, maxH, align='left' } = opts || {};
    if(!img) return;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if(!iw || !ih) return;

    const ratio = Math.min(maxW / iw, maxH / ih, 1);
    const w = iw * ratio;
    const h = ih * ratio;
    const drawX = align === 'right' ? x - w : x;
    const drawY = y - h;
    ctx.drawImage(img, drawX, drawY, w, h);
}

function drawKpiPercentCircle(ctx, cx, cy, radius, pct, greenColor){
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (clamped / 100) * Math.PI * 2;
    const ringThickness = Math.max(10, radius * 0.27);
    const ringRadius = radius - ringThickness / 2;
    const innerGap = Math.max(2, radius * 0.02);
    const innerRadius = Math.max(0, radius - ringThickness - innerGap);

    ctx.save();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = ringThickness;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    if(clamped > 0){
        ctx.strokeStyle = greenColor;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, startAngle, endAngle, false);
        ctx.stroke();
    }

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

async function drawImageFromUrlCached(ctx, url, x, y, w, h, transform=0){
    const img = await loadImageCached(url);
    if(!img) return;
    const t = typeof transform === 'number'
        ? { rotateDeg:transform, flipX:false, flipY:false }
        : {
            rotateDeg:Number(transform?.rotateDeg || 0),
            flipX:Boolean(transform?.flipX),
            flipY:Boolean(transform?.flipY)
        };

    if(!t.rotateDeg && !t.flipX && !t.flipY){
        ctx.drawImage(img, x, y, w, h);
        return;
    }

    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if(t.flipX || t.flipY){
        ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
    }
    if(t.rotateDeg){
        ctx.rotate((t.rotateDeg * Math.PI) / 180);
    }
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
}

function wrapTextLines(ctx, text, maxWidth, size=20, maxLines=2){
    const source = String(text || '').trim();
    if(!source) return [''];
    const words = source.split(/\s+/);
    const lines = [];
    let line = '';
    let truncated = false;

    ctx.save();
    ctx.font = `400 ${size}px ${PDF_FONT_FAMILY}`;

    for(const word of words){
        const candidate = line ? `${line} ${word}` : word;
        if(ctx.measureText(candidate).width <= maxWidth){
            line = candidate;
            continue;
        }
        if(line){
            lines.push(line);
            if(lines.length >= maxLines - 1){
                line = word;
                truncated = true;
                break;
            }
            line = word;
        }else{
            lines.push(word);
            line = '';
        }
    }

    if(line){
        lines.push(line);
    }

    if(lines.length > maxLines){
        lines.length = maxLines;
        truncated = true;
    }
    if(lines.length === maxLines && truncated){
        let last = lines[maxLines - 1];
        while(last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth){
            last = last.slice(0, -1).trimEnd();
        }
        lines[maxLines - 1] = `${last}…`;
    }
    ctx.restore();
    return lines;
}

function drawImageFromDataUrl(ctx, dataUrl, x, y, w, h){
    return new Promise((resolve, reject)=>{
        const img = new Image();
        img.onload = ()=>{
            ctx.drawImage(img, x, y, w, h);
            resolve();
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

function getTopWriteoffsBySum(items, limit){
    const blocks = groupBy(items, COL.lossId);
    return Object.entries(blocks)
        .map(([id, group])=>{
            return {
                id,
                items: group,
                name: getWriteoffName(id, group) || '—',
                count: countProducts(group),
                sum: sumField(group, COL.sum),
                postedCount: countProducts(group.filter(isOprihodRow)),
                postedSum: sumField(group.filter(isOprihodRow), COL.sum)
            };
        })
        .sort((a,b)=>b.sum - a.sum)
        .slice(0, limit);
}

async function renderWriteoffDetailSlideCanvas(opts){
    const { pageW, pageH, margin, theme, lrId, name, items } = opts;
    const { canvas, ctx } = createSlideCanvas(pageW, pageH);
    const contentBottom = getContentBottomY(pageH);

    drawSlideBackground(ctx, pageW, pageH);
    drawSectionTitle(ctx, 'Статистика', `LR ${lrId}`, margin, 92, theme);

    const totalCount = countProducts(items);
    const totalSum = sumField(items, COL.sum);
    const postedItems = items.filter(isOprihodRow);
    const postedCount = countProducts(postedItems);
    const postedSum = sumField(postedItems, COL.sum);
    const postedPct = totalCount ? (postedCount / totalCount) * 100 : 0;

    drawText(ctx, name || '—', margin, 184, { size:22, weight:400, color:theme.muted, align:'left' });
    drawText(ctx, `Списано: ${format(totalCount)} ШК — ₽ ${format(totalSum)}`, margin, 216, {
        size:24, weight:500, color:theme.accent, align:'left'
    });
    drawText(ctx, `Оприходовано: ${format(postedCount)} ШК — ₽ ${format(postedSum)} (${postedPct.toFixed(1)}%)`, margin, 246, {
        size:24, weight:400, color:theme.success, align:'left'
    });

    const statusAgg = aggregateByStatus(items);
    const empAgg = aggregateByEmployees(items);

    const colGap = 28;
    const colW = (pageW - margin * 2 - colGap) / 2;
    const leftX = margin;
    const rightX = margin + colW + colGap;
    const blockY = 276;

    drawText(ctx, 'Топ 3 статуса по сумме', leftX, blockY, { size:20, weight:500, color:theme.text, align:'left' });
    statusAgg.slice(0,3).forEach((row, idx)=>{
        drawStatusRow(ctx, leftX, blockY + 20 + idx * 72, colW, 62, row, theme);
    });

    drawText(ctx, 'Топ 3 сотрудника (EMP)', rightX, blockY, { size:20, weight:500, color:theme.text, align:'left' });
    empAgg.slice(0,3).forEach((row, idx)=>{
        drawEmployeeRow(ctx, rightX, blockY + 20 + idx * 64, colW, 56, row, theme);
    });

    const bubbleTop = blockY + 20 + 3 * 64 + 22;
    const bubbleH = Math.max(84, contentBottom - bubbleTop - 8);
    const bubbleW = colW;
    const statuses = getStatuses(items);
    const statusColors = buildStatusColorMap(statuses);
    const bubble = await createEmployeeBubbleImage(items, statusColors, bubbleW, bubbleH);
    if(bubble){
        drawText(ctx, 'Распределение EMP', rightX, bubbleTop - 10, { size:14, weight:500, color:theme.muted, align:'left' });
        await drawImageFromDataUrl(ctx, bubble, rightX, bubbleTop, bubbleW, bubbleH);
    }
    await drawSlideFooter(ctx, pageW, pageH, theme);

    return canvas.toDataURL('image/png', 1.0);
}

function aggregateByStatus(items){
    const map = {};
    items.forEach(r=>{
        const status = r[COL.status] || '—';
        if(!map[status]){
            map[status] = { status, count:0, sum:0, postedCount:0, postedSum:0 };
        }
        map[status].count += qtyFromRow(r);
        map[status].sum += Number(r[COL.sum] || 0);
        if(isOprihodRow(r)){
            map[status].postedCount += qtyFromRow(r);
            map[status].postedSum += Number(r[COL.sum] || 0);
        }
    });
    return Object.values(map).sort((a,b)=>b.sum - a.sum);
}

function aggregateByEmployees(items){
    const map = {};
    items.forEach(r=>{
        const c = getCounterpartyFromRow(r);
        if(c.type !== 'EMP') return;
        const id = String(c.id || '').trim();
        if(!id) return;
        if(!map[id]){
            map[id] = { id, count:0, sum:0 };
        }
        map[id].count += qtyFromRow(r);
        map[id].sum += Number(r[COL.sum] || 0);
    });
    return Object.values(map).sort((a,b)=>b.sum - a.sum);
}

function drawStatusRow(ctx, x, y, w, h, row, theme){
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = theme.border;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = theme.accent;
    ctx.fillRect(x + 12, y + 12, 4, h - 24);

    drawText(ctx, row.status, x + 24, y + 24, { size:14, weight:500, color:theme.text, align:'left' });
    drawText(ctx, `Списано: ${format(row.count)} ШК — ₽ ${format(row.sum)}`, x + 24, y + 40, {
        size:13, weight:500, color:theme.accent, align:'left'
    });
    drawText(ctx, `Оприходовано: ${format(row.postedCount)} ШК — ₽ ${format(row.postedSum)}`, x + 24, y + 58, {
        size:13, weight:400, color:theme.success, align:'left'
    });
}

function drawEmployeeRow(ctx, x, y, w, h, row, theme){
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = theme.border;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = theme.accent;
    ctx.fillRect(x + 12, y + 12, 4, h - 24);

    drawText(ctx, `EMP ${row.id}`, x + 24, y + 24, { size:14, weight:500, color:theme.text, align:'left' });
    drawText(ctx, `Списано: ${format(row.count)} ШК — ₽ ${format(row.sum)}`, x + 24, y + 44, {
        size:13, weight:500, color:theme.accent, align:'left'
    });
}

function drawInsightCard(ctx, x, y, w, h, text, theme){
    ctx.fillStyle = theme.card;
    ctx.strokeStyle = theme.border;
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = theme.accent;
    ctx.fillRect(x + 14, y + 18, 5, h - 36);

    const lines = wrapTextLines(ctx, text, w - 56, 20, 2);
    lines.forEach((line, i)=>{
        drawText(ctx, line, x + 32, y + 50 + i * 28, { size:20, weight:400, color:theme.text, align:'left' });
    });
}

function getReportDateRange(items){
    const dates = (items || [])
        .map(r=>parseDateValue(r?.[COL.dtLost]))
        .filter(Boolean)
        .sort((a,b)=>a-b);
    if(!dates.length){
        return formatDateHuman(new Date());
    }
    return `${formatDateHuman(dates[0])} - ${formatDateHuman(dates[dates.length - 1])}`;
}

function buildInsights(allItems){
    if(!allItems?.length){
        return ['Недостаточно данных для инсайтов'];
    }

    const insights = [];
    const totalSum = sumField(allItems, COL.sum);
    const totalCount = countProducts(allItems);

    const byLr = getTopWriteoffsBySum(allItems, 20);
    if(byLr.length){
        const top = byLr[0];
        const pct = totalSum ? (top.sum / totalSum) * 100 : 0;
        insights.push(`LR ${top.id} лидирует по сумме: ₽ ${format(top.sum)} (${pct.toFixed(1)}% от общей суммы)`);
    }

    const lowPost = byLr
        .filter(x=>x.count >= 10)
        .map(x=>{
            const pct = x.count ? (x.postedCount / x.count) * 100 : 0;
            return { ...x, pct };
        })
        .sort((a,b)=>a.pct - b.pct)[0];
    if(lowPost){
        insights.push(`Самый низкий процент оприхода среди LR: LR ${lowPost.id} — ${lowPost.pct.toFixed(1)}%`);
    }

    const statusAgg = aggregateByStatus(allItems);
    if(statusAgg.length){
        const s = statusAgg[0];
        insights.push(`Статус с наибольшей суммой: ${s.status} — ₽ ${format(s.sum)}`);
    }

    const byDay = {};
    allItems.forEach(r=>{
        const d = normalizeDate(r[COL.dtLost]);
        if(!d) return;
        byDay[d] ??= [];
        byDay[d].push(r);
    });
    const bestDay = Object.entries(byDay)
        .map(([d, items])=>({ d, sum: sumField(items, COL.sum) }))
        .sort((a,b)=>b.sum - a.sum)[0];
    if(bestDay){
        insights.push(`Пик суммы списаний: ${bestDay.d} — ₽ ${format(bestDay.sum)}`);
    }

    const empAgg = aggregateByEmployees(allItems);
    if(empAgg.length){
        const e = empAgg[0];
        insights.push(`EMP с максимальной суммой: ${e.id} — ₽ ${format(e.sum)} (${format(e.count)} ШК)`);
    }

    if(totalCount){
        const avg = totalSum / totalCount;
        insights.push(`Средняя сумма на ШК: ₽ ${format(Math.round(avg))}`);
    }

    return insights;
}

async function createEmployeeBubbleImage(items, statusColors, width, height){
    const byEmp = {};
    items.forEach(r=>{
        const c = getCounterpartyFromRow(r);
        if(c.type !== 'EMP') return;
        const id = String(c.id || '').trim();
        if(!id) return;
        const qty = Math.max(1, qtyFromRow(r));
        const status = r[COL.status] || '—';
        byEmp[id] ??= { id, qty:0, sum:0, rows:0, statusQty:{} };
        byEmp[id].qty += qty;
        byEmp[id].sum += Number(r[COL.sum]||0);
        byEmp[id].rows += 1;
        byEmp[id].statusQty[status] = (byEmp[id].statusQty[status] || 0) + qty;
    });

    const top = Object.values(byEmp)
        .sort((a,b)=>b.sum - a.sum)
        .slice(0,12);

    if(!top.length) return '';

    const points = buildEmpBubbleCloud(top, statusColors).map(p=>({
        x:p.x, y:p.y, r:p.r,
        backgroundColor:p.bgColor,
        borderColor:p.borderColor,
        empId:p.empId
    }));

    return await createChartImage({
        type:'bubble',
        data:{
            datasets:[{
                data: points,
                backgroundColor: points.map(p=>p.backgroundColor),
                borderColor: points.map(p=>p.borderColor),
                borderWidth:1.2
            }]
        },
        options:{
            responsive:false,
            plugins:{ legend:{ display:false } },
            scales:{
                x:{ display:false },
                y:{ display:false }
            }
        }
    }, width, height);
}

/* ================= REPORT ================= */

function renderReport(){
    const container = document.getElementById('report');
    container.innerHTML = '';

    renderTotalBlock(container);

    const groups = {};
    rows.forEach(r=>{
        const id = Number(r[COL.lossId]);
        if(!id) return;
        groups[id] ??= [];
        groups[id].push(r);
    });

    const auto = [];
    const manual = [];

    Object.entries(groups).forEach(([id,items])=>{
        (AUTO_IDS.has(Number(id)) ? auto : manual).push({id,items});
    });

    renderSection(container,'Автосписания',auto,'auto');
    renderSection(container,'Ручные списания',manual,'manual');
    renderNoBarcodeSection(container);
}

function renderNoBarcodeSection(container){
    const box = document.createElement('section');
    box.className = 'status-box';
    container.appendChild(box);

    const renderToken = ++noBarcodeRenderToken;
    setNoBarcodeSectionState(box, {
        count:null,
        desc:'Загрузка данных из nm_rep...'
    });

    getNoBarcodeNmRepMatches(rows).then(result=>{
        if(renderToken !== noBarcodeRenderToken) return;

        const errorText = String(result?.error || '').trim();
        if(errorText){
            setNoBarcodeSectionState(box, {
                count:0,
                desc:errorText
            });
            return;
        }

        const detailItems = Array.isArray(result?.items) ? result.items : [];
        setNoBarcodeSectionState(box, {
            count:detailItems.length,
            sum:sumField(detailItems, COL.sum),
            desc:`Проверено строк: ${format(result?.comparedRows || 0)} | Номенклатур: ${format(result?.nmCount || 0)}`,
            items:detailItems
        });
    }).catch(()=>{
        if(renderToken !== noBarcodeRenderToken) return;
        setNoBarcodeSectionState(box, {
            count:0,
            desc:'Не удалось загрузить данные nm_rep'
        });
    });
}

function setNoBarcodeSectionState(box, state){
    const count = state?.count;
    const hasCount = Number.isFinite(count);
    const sum = state?.sum;
    const hasSum = Number.isFinite(sum);
    const isClickable = hasCount && count > 0 && Array.isArray(state?.items) && state.items.length > 0;
    const valueText = hasCount ? format(count) : '...';
    const sumText = hasSum ? `₽ ${format(sum)}` : '...';
    const descText = state?.desc || '—';

    box.innerHTML = `
<div class="status-header">
    <div class="status-center" style="grid-column:2;margin:0 auto;text-align:center;">
        <div class="status-code">${NO_BARCODE_SECTION_TITLE}</div>
        <div class="status-desc">${escapeHtml(descText)}</div>
    </div>
</div>

<div class="status-metrics">
    <div class="metric ${isClickable ? 'clickable' : ''}" data-open-no-barcode="${isClickable ? '1' : '0'}">
        <div class="metric-value">${valueText}</div>
        <div class="metric-label">Совпавшие строки</div>
    </div>
    <div class="metric ${isClickable ? 'clickable' : ''}" data-open-no-barcode="${isClickable ? '1' : '0'}">
        <div class="metric-value">${sumText}</div>
        <div class="metric-label">Сумма из файла</div>
    </div>
</div>
`;

    box.querySelectorAll('[data-open-no-barcode="1"]').forEach(detailBtn=>{
        detailBtn.onclick = ()=>{
            openModal(state.items, NO_BARCODE_SECTION_TITLE, {
                columns: NO_BARCODE_MODAL_COLUMNS,
                exportSuffix: 'no_barcode_wms_plus'
            });
        };
    });
}

function renderSection(container,title,blocks,groupKey){
    if(!blocks.length) return;

    blocks.sort((a,b)=>b.items.length-a.items.length);
    renderGroupOverview(container, title, blocks, groupKey);
}

function renderGroupOverview(container, title, blocks, groupKey){
    const items = blocks.flatMap(b=>b.items);
    const totalProducts = countProducts(items);
    const totalSum = sumField(items, COL.sum);
    const postedItems = items.filter(isOprihodRow);
    const postedProducts = countProducts(postedItems);
    const postedSum = sumField(postedItems, COL.sum);
    const chartId = `group-chart-${groupKey}`;

    const box = document.createElement('section');
    box.className = 'status-box';
    box.innerHTML = `
<div class="status-header">
    <div class="status-side status-side-inline clickable" data-open="all">
        <div class="status-inline-row">
            <div class="status-inline-item">
                <div class="status-big">${totalProducts}</div>
                <div class="status-label">Товаров</div>
            </div>
            <div class="status-inline-item">
                <div class="status-big">₽ ${format(totalSum)}</div>
                <div class="status-label">Сумма</div>
            </div>
        </div>
    </div>

    <div class="status-center">
        <div class="status-code">${title}</div>
        <div class="status-desc">${blocks.length} LR в группе</div>
    </div>

    <div class="status-side status-side-inline clickable" data-open="posted">
        <div class="status-inline-row">
            <div class="status-inline-item">
                <div class="status-big">${postedProducts}</div>
                <div class="status-label">Оприходовано ШТ</div>
            </div>
            <div class="status-inline-item">
                <div class="status-big">₽ ${format(postedSum)}</div>
                <div class="status-label">Оприходовано Сумма</div>
            </div>
        </div>
    </div>
</div>

<div class="group-donut-wrap">
    <canvas id="${chartId}" class="chart-appear"></canvas>
</div>

<div class="group-lr-grid">
    ${blocks.map(b=>`
        <button class="metric group-lr-chip" data-lr="${escapeAttr(b.id)}">
            <div class="metric-value">LR ${b.id}</div>
            <div class="metric-label">${escapeHtml(getWriteoffName(b.id, b.items) || '—')}</div>
        </button>
    `).join('')}
</div>
`;

    container.appendChild(box);

    box.querySelectorAll('[data-open="all"]').forEach(el=>{
        el.onclick = ()=>openModal(items, title);
    });
    box.querySelectorAll('[data-open="posted"]').forEach(el=>{
        el.onclick = ()=>openModal(postedItems, `${title} — Оприходовано`);
    });

    box.querySelectorAll('.group-lr-chip').forEach(btn=>{
        btn.onclick = ()=>{
            const lrId = btn.dataset.lr;
            const block = blocks.find(b=>String(b.id)===String(lrId));
            if(!block) return;
            openLRDetails(block.id, block.items);
        };
    });

    renderGroupDonutChart(chartId, blocks, title);
}

/* ================= TOTAL BLOCK ================= */

function renderTotalBlock(container){
    const auto = rows.filter(r=>AUTO_IDS.has(Number(r[COL.lossId])));
    const manual = rows.filter(r=>!AUTO_IDS.has(Number(r[COL.lossId])));
    const posted = rows.filter(isOprihodRow);

    const box = document.createElement('section');
    box.className='status-box';

    box.innerHTML=`
<div class="status-header">
    <div class="status-side status-side-inline clickable">
        <div class="status-inline-row">
            <div class="status-inline-item">
                <div class="status-big">${countProducts(rows)}</div>
                <div class="status-label">Товаров</div>
            </div>
            <div class="status-inline-item">
                <div class="status-big">₽ ${format(sumField(rows, COL.sum))}</div>
                <div class="status-label">Сумма</div>
            </div>
        </div>
    </div>

    <div class="status-center">
        <div class="status-code">Всего списаний</div>
        <div class="status-desc">Все типы</div>
    </div>

    <div class="status-side status-side-inline clickable" data-type="posted">
        <div class="status-inline-row">
            <div class="status-inline-item">
                <div class="status-big">${countProducts(posted)}</div>
                <div class="status-label">Оприходовано ШТ</div>
            </div>
            <div class="status-inline-item">
                <div class="status-big">₽ ${format(sumField(posted, COL.sum))}</div>
                <div class="status-label">Оприходовано Сумма</div>
            </div>
        </div>
    </div>
</div>

<div class="status-metrics">
    <div class="metric clickable" data-type="auto">
        <div class="metric-value">₽ ${format(sumField(auto, COL.sum))}</div>
        <div class="metric-label">Автосписания сумма</div>
    </div>

    <div class="metric clickable" data-type="auto">
        <div class="metric-value">${countProducts(auto)}</div>
        <div class="metric-label">Автосписания кол-во</div>
    </div>

    <div class="metric clickable" data-type="manual">
        <div class="metric-value">₽ ${format(sumField(manual, COL.sum))}</div>
        <div class="metric-label">Ручные сумма</div>
    </div>

    <div class="metric clickable" data-type="manual">
        <div class="metric-value">${countProducts(manual)}</div>
        <div class="metric-label">Ручные кол-во</div>
    </div>
</div>

<canvas id="totalChart" height="90" class="chart-appear"></canvas>
`;

    container.appendChild(box);

    box.querySelectorAll('.metric.clickable,.status-side.clickable').forEach(el=>{
        el.onclick=()=>{
            if(el.dataset.type==='auto') openModal(auto,'Автосписания');
            else if(el.dataset.type==='manual') openModal(manual,'Ручные списания');
            else if(el.dataset.type==='posted') openModal(posted,'Оприходовано');
            else openModal(rows,'Все списания');
        };
    });

    renderTotalChart();
}

/* ================= CHART TOTAL ================= */

function normalizeDate(v){
    const d = parseDateValue(v);
    if(!d) return '';
    return formatDate(d);
}

function renderTotalChart(){
    const byDate = {};
    const byPostedDate = {};

    rows.forEach(r=>{
        const d = normalizeDate(r[COL.dtLost]);
        if(d){
            byDate[d] ??= [];
            byDate[d].push(r);
        }

        const pd = getPostedDateKey(r);
        if(pd){
            byPostedDate[pd] ??= [];
            byPostedDate[pd].push(r);
        }
    });

    const labels = Array.from(new Set([
        ...Object.keys(byDate),
        ...Object.keys(byPostedDate)
    ])).sort(sortDates);

    const total = [];
    const auto = [];
    const manual = [];
    const posted = [];

    labels.forEach(d=>{
        const items = byDate[d] || [];
        const a = items.filter(r=>AUTO_IDS.has(Number(r[COL.lossId])));
        const m = items.filter(r=>!AUTO_IDS.has(Number(r[COL.lossId])));
        const p = byPostedDate[d] || [];

        total.push(sumMetric(items));
        auto.push(sumMetric(a));
        manual.push(sumMetric(m));
        posted.push(sumMetric(p));
    });

    const yTitle = valueMode === 'qty' ? 'Шт списаний' : 'Сумма списаний, ₽';
    const totalLabel = valueMode === 'qty' ? 'Общее кол-во списаний (ШТ)' : 'Общая сумма списаний';
    const manualLabel = valueMode === 'qty' ? 'Ручные списания (ШТ)' : 'Ручные списания';
    const autoLabel = valueMode === 'qty' ? 'Автосписания (ШТ)' : 'Автосписания';
    const postedLabel = valueMode === 'qty' ? 'Оприходовано (ШТ)' : 'Оприходовано (₽)';

    new Chart(document.getElementById('totalChart'),{
        type:'line',
        data:{
            labels,
            datasets:[
                { label: totalLabel, data: total, tension:0.4, borderWidth:2 },
                { label: manualLabel, data: manual, borderColor:'#eab308', backgroundColor:'#eab308', tension:0.4, borderWidth:2 },
                { label: autoLabel, data: auto, borderColor:'red', backgroundColor:'red', tension:0.4, borderWidth:2 },
                { label: postedLabel, data: posted, borderColor:'#16a34a', backgroundColor:'#16a34a', borderDash:[8,6], tension:0.35, borderWidth:2, pointRadius:1 }
            ]
        },
        options:{
            animation:{duration:550,easing:'easeOutCubic'},
            animations:{
                y:{from:(ctx)=>ctx.chart.scales?.y?.getPixelForValue(0)}
            },
            interaction:{mode:'index',intersect:false},
            plugins:{
                tooltip:{
                    callbacks:{
                        label:(ctx)=>{
                            const v = Number(ctx.parsed.y || 0);
                            return valueMode === 'qty'
                                ? `${ctx.dataset.label}: ${format(v)} шт`
                                : `${ctx.dataset.label}: ₽ ${format(v)}`;
                        },
                        afterBody:(ctx)=>{
                            const i = ctx[0].dataIndex;
                            return `Товаров: ${countProducts(byDate[labels[i]] || [])}`;
                        }
                    }
                }
            },
            scales:{
                y:{
                    title:{display:true,text:yTitle}
                }
            },
            onClick:(e,els)=>{
                if(!els.length) return;
                openModal(byDate[labels[els[0].index]],`Дата ${labels[els[0].index]}`);
            }
        }
    });
}

function renderGroupDonutChart(canvasId, blocks, title){
    const canvas = document.getElementById(canvasId);
    if(!canvas) return;

    const labels = blocks.map(b=>`LR ${b.id}`);
    const sums = blocks.map(b=>sumField(b.items, COL.sum));
    const products = blocks.map(b=>countProducts(b.items));
    const types = blocks.map(b=>b.items[0]?.['Тип списания'] || '—');
    const totalProducts = products.reduce((s,v)=>s+v,0) || 1;
    const donutColorOffset = 1;
    const colors = blocks.map((_,i)=>DONUT_PALETTE[(i + donutColorOffset) % DONUT_PALETTE.length]);

    new Chart(canvas,{
        type:'doughnut',
        data:{
            labels,
            datasets:[{
                data:sums,
                backgroundColor:colors,
                borderWidth:1,
                hoverOffset:8
            }]
        },
        options:{
            responsive:true,
            maintainAspectRatio:false,
            cutout:'55%',
            animation:{duration:500,easing:'easeOutCubic'},
            plugins:{
                legend:{display:false},
                tooltip:{
                    displayColors:false,
                    bodyFont:{size:11},
                    titleFont:{size:12},
                    callbacks:{
                        title:(ctx)=>ctx[0]?.label || '',
                        label:(ctx)=>{
                            const i = ctx.dataIndex;
                            const typeLines = wrapTooltipLine(`Тип: ${types[i]}`, 28);
                            const pct = (products[i] / totalProducts) * 100;
                            return [
                                ...typeLines,
                                `Доля от кол-ва: ${pct.toFixed(1)}%`,
                                `Сумма: ₽ ${format(sums[i])}`,
                                `Товаров: ${format(products[i])}`
                            ];
                        }
                    }
                }
            },
            onClick:(event,els)=>{
                if(!els.length) return;
                const i = els[0].index;
                const b = blocks[i];
                if(!b) return;
                openLRDetails(b.id, b.items);
            }
        }
    });
}

/* ================= LR DETAILS ================= */

function openLRDetails(lrId, items){
    const statuses = getStatuses(items);
    const selectedStatuses = statuses.slice();
    openState({
        type:'lr',
        lrId,
        items,
        selectedStatuses,
        statusColors: buildStatusColorMap(statuses)
    });
}

let lrChartInstance = null;
let lrEmpBubbleInstance = null;
let lrPvzBubbleInstance = null;
let lrCommentBarInstance = null;
let lrStatusPieInstance = null;
const empBubbleLabelPlugin = {
    id:'empBubbleLabelPlugin',
    afterDatasetsDraw(chart){
        const ctx = chart.ctx;
        const meta = chart.getDatasetMeta(0);
        if(!meta?.data?.length) return;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        meta.data.forEach((el, i)=>{
            const raw = chart.data.datasets[0]?.data?.[i];
            if(!raw?.empId) return;

            const radius = Number(el.options?.radius || raw.r || 0);
            if(radius < 12) return;

            const pos = el.getProps(['x','y'], true);
            const label = String(raw.empId);
            let fontSize = Math.max(10, Math.min(14, Math.floor(radius * 0.42)));
            ctx.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
            ctx.fillStyle = raw.textColor || '#ffffff';

            let text = label;
            while(text.length > 2 && ctx.measureText(text).width > radius * 1.75){
                text = text.slice(0, -1);
            }
            if(text !== label && text.length > 3){
                text = `${text.slice(0, -1)}…`;
            }

            ctx.fillText(text, pos.x, pos.y);
        });

        ctx.restore();
    }
};
const pvzHousePlugin = {
    id:'pvzHousePlugin',
    afterDatasetsDraw(chart){
        const ctx = chart.ctx;
        const meta = chart.getDatasetMeta(0);
        if(!meta?.data?.length) return;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        meta.data.forEach((el, i)=>{
            const raw = chart.data.datasets[0]?.data?.[i];
            if(!raw?.officeId) return;

            const radius = Number(el.options?.radius || raw.r || 0);
            if(radius < 11) return;

            const pos = el.getProps(['x','y'], true);
            const iconSize = Math.max(12, Math.min(20, Math.floor(radius * 0.62)));
            ctx.font = `700 ${iconSize}px Inter, Arial, sans-serif`;
            ctx.fillStyle = '#ffffff';
            ctx.fillText('⌂', pos.x, pos.y + 1);
        });

        ctx.restore();
    }
};

function renderLRDetails(state){
    const lrId = state.lrId;
    const items = state.items || [];
    const statuses = getStatuses(items);
    const selectedStatuses = Array.isArray(state.selectedStatuses)
        ? state.selectedStatuses.filter(s=>statuses.includes(s))
        : statuses.slice();
    const selectedSet = new Set(selectedStatuses);
    const filteredItems = filterByStatuses(items, selectedSet);

    const stats = calcIdStats(filteredItems);
    const expensiveItems = filteredItems.filter(r=>Number(r[COL.sum]||0) >= 3000);
    const postedItems = filteredItems.filter(isOprihodRow);
    const colors = state.statusColors || buildStatusColorMap(statuses);

    modalBody.innerHTML = `
<h2>LR ${lrId}</h2>

<div class="lr-modal-toolbar">
    <button class="btn btn-rect" data-export="lr">Выгрузить в Excel</button>
</div>

<div class="lr-summary-grid">
    <div class="lr-summary-item clickable" data-summary="qty">
        <div class="status-big">${countProducts(filteredItems)}</div>
        <div class="status-label">Товаров всего</div>
    </div>
    <div class="lr-summary-item clickable" data-summary="sum">
        <div class="status-big">₽ ${format(sumField(filteredItems, COL.sum))}</div>
        <div class="status-label">Сумма всего</div>
    </div>
</div>

<div class="status-metrics">
    <div class="metric clickable" data-action="expensive"><div class="metric-value">${stats.expensiveCount}</div><div class="metric-label">Дорогостой</div></div>
    <div class="metric clickable" data-action="expensive-sum"><div class="metric-value">₽ ${format(stats.expensiveSum)}</div><div class="metric-label">Сумма дорогостоя</div></div>
    <div class="metric"><div class="metric-value">₽ ${format(stats.median)}</div><div class="metric-label">Медиана</div></div>
    <div class="metric clickable" data-action="posted-qty"><div class="metric-value">${countProducts(postedItems)}</div><div class="metric-label">Оприходовано ШТ</div></div>
    <div class="metric clickable" data-action="posted-sum"><div class="metric-value">₽ ${format(sumField(postedItems, COL.sum))}</div><div class="metric-label">Оприходовано Сумма</div></div>
</div>

<canvas id="lrChart" height="90" class="chart-appear"></canvas>

<div class="status-filter-wrap">
    <button class="status-filter-btn status-filter-all" data-status-all="1">Все</button>
    ${statuses.map(s=>{
        const isActive = selectedSet.has(s);
        const color = colors[s] || '#64748b';
        return `<button class="status-filter-btn ${isActive ? 'active' : ''}" data-status="${escapeAttr(s)}" style="--status-color:${color}">${s}</button>`;
    }).join('')}
</div>

${Number(lrId)===32 ? `
<h3 class="lr-subtitle">Распределение статусов внутри LR 32</h3>
<div class="group-donut-wrap">
    <canvas id="lr32StatusPieChart" width="240" height="240" class="chart-appear"></canvas>
</div>
` : ''}

<h3 class="lr-subtitle">Топ 15 сотрудников (EMP) по ${valueMode === 'qty' ? 'ШТ списаний' : 'сумме списаний'}</h3>
<canvas id="lrEmpBubbleChart" height="140" class="chart-appear"></canvas>

${Number(lrId)===11 ? `
<h3 class="lr-subtitle">Топ 10 ПВЗ по ${valueMode === 'qty' ? 'ШТ списаний' : 'сумме списаний'}</h3>
<canvas id="lrPvzBubbleChart" height="96" class="chart-appear"></canvas>
` : ''}

${Number(lrId)===46 ? `
<h3 class="lr-subtitle">Классификация комментариев при списании</h3>
<canvas id="lrCommentChart" height="120" class="chart-appear"></canvas>
` : ''}
`;

    const exportBtn = modalBody.querySelector('[data-export="lr"]');
    if(exportBtn){
        exportBtn.onclick = ()=>exportItems(filteredItems, `lr_${lrId}_details`);
    }

    modalBody.querySelectorAll('.lr-summary-item.clickable').forEach(el=>{
        el.onclick = ()=>{
            if(el.dataset.summary === 'qty'){
                openModal(filteredItems, 'Всего списано (ШТ)', { lrId });
            } else {
                openModal(filteredItems, 'Всего списано (₽)', { lrId });
            }
        };
    });

    modalBody.querySelectorAll('.metric.clickable').forEach(el=>{
        el.onclick = ()=>{
            const action = el.dataset.action;
            if(action==='expensive'){
                openModal(expensiveItems, 'Дорогостой', { lrId });
            } else if(action==='expensive-sum'){
                openModal(expensiveItems, 'Сумма дорогостоя', { lrId });
            } else if(action==='posted-qty'){
                openModal(postedItems, 'Оприходовано ШТ', { lrId });
            } else if(action==='posted-sum'){
                openModal(postedItems, 'Оприходовано Сумма', { lrId });
            }
        };
    });

    modalBody.querySelectorAll('button[data-status]').forEach(btn=>{
        btn.onclick = ()=>{
            const scroller = modal.querySelector('.modal-content');
            const keepScrollTop = scroller ? scroller.scrollTop : 0;
            const status = btn.dataset.status;
            const current = new Set(selectedStatuses);
            if(current.has(status)){
                current.delete(status);
            } else {
                current.add(status);
            }
            renderModalState({
                ...state,
                selectedStatuses: Array.from(current)
            }, { push:false, keepScrollTop });
        };
    });
    const allBtn = modalBody.querySelector('button[data-status-all]');
    if(allBtn){
        allBtn.onclick = ()=>{
            const scroller = modal.querySelector('.modal-content');
            const keepScrollTop = scroller ? scroller.scrollTop : 0;
            const isAllActive = selectedStatuses.length === statuses.length;
            renderModalState({
                ...state,
                selectedStatuses: isAllActive ? [] : statuses.slice()
            }, { push:false, keepScrollTop });
        };
    }

    renderLRChart(filteredItems, selectedStatuses, colors, items);
    if(Number(lrId)===32){
        renderLr32StatusPieChart(items, colors);
    } else if(lrStatusPieInstance){
        lrStatusPieInstance.destroy();
        lrStatusPieInstance = null;
    }
    renderLrEmpBubbleChart(filteredItems, lrId, colors);
    if(Number(lrId)===11){
        renderLrPvzBubbleChart(filteredItems, lrId, colors);
    } else if(lrPvzBubbleInstance){
        lrPvzBubbleInstance.destroy();
        lrPvzBubbleInstance = null;
    }
    if(Number(lrId)===46){
        renderLrCommentBarChart(filteredItems);
    } else if(lrCommentBarInstance){
        lrCommentBarInstance.destroy();
        lrCommentBarInstance = null;
    }
}

function renderLRChart(items, selectedStatuses, statusColors, allItems){
    if(lrChartInstance){
        lrChartInstance.destroy();
        lrChartInstance = null;
    }

    const baseItems = Array.isArray(allItems) && allItems.length ? allItems : items;
    const byDate = {};
    baseItems.forEach(r=>{
        const d = normalizeDate(r[COL.dtLost]);
        if(!d) return;
        byDate[d] ??= [];
        byDate[d].push(r);
    });

    const labels = Object.keys(byDate).sort(sortDates);
    const statuses = {};
    selectedStatuses.forEach(s=>{
        statuses[s] = Array(labels.length).fill(0);
    });

    labels.forEach((d,i)=>{
        const dayItems = byDate[d] || [];
        dayItems.forEach(r=>{
            const s = r[COL.status] || '—';
            if(!selectedStatuses.includes(s)) return;
            statuses[s] ??= Array(labels.length).fill(0);
            statuses[s][i] += metricValue(r);
        });
    });

    const totalByDayAll = labels.map(d=>
        (byDate[d] || []).reduce((s,r)=>s + metricValue(r),0)
    );

    const chartData = Object.entries(statuses).map(([label,data])=>({
        label,
        data,
        tension:0.4,
        borderWidth:2,
        borderColor: statusColors[label] || '#64748b',
        backgroundColor: statusColors[label] || '#64748b',
        pointRadius:2,
        pointHoverRadius:5,
        pointHitRadius:18
    }));
    chartData.push({
        label: valueMode === 'qty'
            ? 'Итог за день (все статусы, ШТ)'
            : 'Итог за день (все статусы, ₽)',
        data: totalByDayAll,
        tension:0.3,
        borderWidth:2,
        borderColor:'#111827',
        backgroundColor:'#111827',
        borderDash:[8,6],
        pointRadius:0,
        pointHoverRadius:0,
        pointHitRadius:12
    });

    lrChartInstance = new Chart(document.getElementById('lrChart'),{
        type:'line',
        data:{
            labels,
            datasets: chartData
        },
        options:{
            animation:{duration:550,easing:'easeOutCubic'},
            animations:{
                y:{from:(ctx)=>ctx.chart.scales?.y?.getPixelForValue(0)}
            },
            interaction:{mode:'index',intersect:false,axis:'x'},
            plugins:{
                legend:{display:false},
                tooltip:{
                    enabled:true,
                    callbacks:{
                        label:(ctx)=>{
                            const v = Number(ctx.parsed.y || 0);
                            return valueMode === 'qty'
                                ? `${ctx.dataset.label}: ${format(v)} шт`
                                : `${ctx.dataset.label}: ₽ ${format(v)}`;
                        }
                    }
                }
            },
            scales:{
                y:{
                    title:{
                        display:true,
                        text:valueMode === 'qty' ? 'Шт списаний' : 'Сумма списаний, ₽'
                    }
                }
            },
            onClick:(event, els, chart)=>{
                let points = els;
                if(!points || !points.length){
                    points = chart.getElementsAtEventForMode(event,'nearest',{intersect:false},true);
                }
                if(!points?.length) return;

                const hit = points[0];
                const day = labels[hit.index];
                const ds = chartData[hit.datasetIndex];
                if(!day || !ds) return;

                const isSummary = String(ds.label || '').startsWith('Итог за день');
                if(isSummary){
                    const byDay = (allItems || items).filter(r=>normalizeDate(r[COL.dtLost])===day);
                    openModal(byDay, `Дата ${day} — все статусы`, { lrId: currentModalState?.lrId || null });
                    return;
                }

                const status = ds.label;
                const filtered = (allItems || items).filter(r=>
                    normalizeDate(r[COL.dtLost])===day &&
                    (r[COL.status] || '—')===status
                );
                openModal(filtered, `${status} — ${day}`, { lrId: currentModalState?.lrId || null });
            }
        }
    });
}

function renderLrEmpBubbleChart(items, lrId, statusColors){
    if(lrEmpBubbleInstance){
        lrEmpBubbleInstance.destroy();
        lrEmpBubbleInstance = null;
    }

    const canvas = document.getElementById('lrEmpBubbleChart');
    if(!canvas) return;

    const byEmp = {};
    items.forEach(r=>{
        const counterparty = getCounterpartyFromRow(r);
        if(counterparty.type !== 'EMP') return;
        const id = String(counterparty.id || '').trim();
        if(!id) return;
        const qty = Math.max(1, qtyFromRow(r));
        const status = r[COL.status] || '—';
        byEmp[id] ??= { id, qty:0, sum:0, rows:0, statusQty:{} };
        byEmp[id].qty += qty;
        byEmp[id].sum += Number(r[COL.sum]||0);
        byEmp[id].rows += 1;
        byEmp[id].statusQty[status] = (byEmp[id].statusQty[status] || 0) + qty;
    });

    const top = Object.values(byEmp)
        .sort((a,b)=>bubbleMetric(b)-bubbleMetric(a))
        .slice(0,15);

    const points = buildEmpBubbleCloud(top, statusColors);
    const xs = points.map(p=>p.x);
    const ys = points.map(p=>p.y);
    const maxR = points.length ? Math.max(...points.map(p=>p.r)) : 10;
    const minX = points.length ? Math.min(...xs) - maxR - 8 : -40;
    const maxX = points.length ? Math.max(...xs) + maxR + 8 : 40;
    const minY = points.length ? Math.min(...ys) - maxR - 8 : -40;
    const maxY = points.length ? Math.max(...ys) + maxR + 8 : 40;

    lrEmpBubbleInstance = new Chart(canvas,{
        type:'bubble',
        plugins:[empBubbleLabelPlugin],
        data:{
            datasets:[{
                label:'EMP',
                data: points,
                backgroundColor: points.map(p=>p.bgColor),
                borderColor: points.map(p=>p.borderColor),
                borderWidth:1.5,
                radius:(ctx)=>{
                    const base = Number(ctx.raw?.r || 10);
                    return ctx.active ? Math.round(base * 1.14) : base;
                },
                hitRadius:20
            }]
        },
        options:{
            animation:{duration:650,easing:'easeOutCubic'},
            animations:{
                numbers:{
                    type:'number',
                    properties:['x','y','r'],
                    duration:650,
                    easing:'easeOutCubic'
                },
                radius:{
                    type:'number',
                    properties:['radius'],
                    duration:460,
                    easing:'easeOutQuart'
                }
            },
            transitions:{
                active:{
                    animation:{duration:460,easing:'easeOutQuart'}
                }
            },
            onClick:(event,els,chart)=>{
                let pointsAtEvent = els;
                if(!pointsAtEvent || !pointsAtEvent.length){
                    pointsAtEvent = chart.getElementsAtEventForMode(event,'nearest',{intersect:false},true);
                }
                if(!pointsAtEvent?.length) return;

                const hit = pointsAtEvent[0];
                const raw = chart.data.datasets[hit.datasetIndex]?.data?.[hit.index];
                const empId = raw?.empId;
                if(!empId) return;

                const filtered = items.filter(r=>
                    getCounterpartyFromRow(r).type === 'EMP' &&
                    String(getCounterpartyFromRow(r).id || '').trim()===String(empId)
                );
                openModal(filtered, `Контрагент EMP: ${empId}`, { lrId });
            },
            plugins:{
                legend:{display:false},
                tooltip:{
                    callbacks:{
                        title:(ctx)=>`Контрагент ID: ${ctx[0]?.raw?.empId || '—'}`,
                        label:(ctx)=>{
                            const p = ctx.raw || {};
                            const metricLine = valueMode === 'qty'
                                ? `Шт списаний: ${format(p.qty || 0)}`
                                : `Сумма: ₽ ${format(p.sum || 0)}`;
                            const extraLine = valueMode === 'qty'
                                ? `Сумма: ₽ ${format(p.sum || 0)}`
                                : `Шт списаний: ${format(p.qty || 0)}`;
                            return [
                                metricLine,
                                extraLine,
                                `Строк: ${format(p.rows || 0)}`,
                                `Доминирующий статус: ${p.dominantStatus || '—'}`
                            ];
                        }
                    }
                }
            },
            scales:{
                x:{
                    min:minX,
                    max:maxX,
                    grid:{display:false},
                    border:{display:false},
                    ticks:{display:false}
                },
                y:{
                    min:minY,
                    max:maxY,
                    grid:{display:false},
                    border:{display:false},
                    ticks:{display:false}
                }
            }
        }
    });
}

function renderLrPvzBubbleChart(items, lrId, statusColors){
    if(lrPvzBubbleInstance){
        lrPvzBubbleInstance.destroy();
        lrPvzBubbleInstance = null;
    }

    const canvas = document.getElementById('lrPvzBubbleChart');
    if(!canvas) return;

    const byOffice = {};
    items.forEach(r=>{
        const officeId = String(r['dst_office_id'] || '').trim();
        if(!officeId) return;
        const officeName = String(r['dst_office_name'] || '—').trim() || '—';
        const qty = Math.max(1, qtyFromRow(r));
        const status = r[COL.status] || '—';
        byOffice[officeId] ??= { officeId, officeName, qty:0, sum:0, rows:0, statusQty:{} };
        byOffice[officeId].qty += qty;
        byOffice[officeId].sum += Number(r[COL.sum]||0);
        byOffice[officeId].rows += 1;
        byOffice[officeId].statusQty[status] = (byOffice[officeId].statusQty[status] || 0) + qty;
    });

    const top = Object.values(byOffice)
        .sort((a,b)=>bubbleMetric(b)-bubbleMetric(a))
        .slice(0,10);
    const points = buildPvzRowSquares(top, statusColors);

    lrPvzBubbleInstance = new Chart(canvas,{
        type:'scatter',
        data:{
            datasets:[{
                label:'PVZ',
                data: points,
                backgroundColor: points.map(p=>p.bgColor),
                borderColor: points.map(p=>p.borderColor),
                borderWidth:1.5,
                pointStyle:'rectRounded',
                pointRadius:(ctx)=>{
                    const base = Number(ctx.raw?.r || 10);
                    return ctx.active ? Math.round(base * 1.14) : base;
                },
                pointHoverRadius:(ctx)=>{
                    const base = Number(ctx.raw?.r || 10);
                    return Math.round(base * 1.14);
                },
                hitRadius:24,
                showLine:false
            }]
        },
        options:{
            animation:{duration:650,easing:'easeOutCubic'},
            animations:{
                numbers:{
                    type:'number',
                    properties:['x','y','radius'],
                    duration:650,
                    easing:'easeOutCubic'
                },
                radius:{
                    type:'number',
                    properties:['radius'],
                    duration:460,
                    easing:'easeOutQuart'
                }
            },
            transitions:{
                active:{
                    animation:{duration:460,easing:'easeOutQuart'}
                }
            },
            onClick:(event,els,chart)=>{
                let pointsAtEvent = els;
                if(!pointsAtEvent || !pointsAtEvent.length){
                    pointsAtEvent = chart.getElementsAtEventForMode(event,'nearest',{intersect:false},true);
                }
                if(!pointsAtEvent?.length) return;
                const hit = pointsAtEvent[0];
                const raw = chart.data.datasets[hit.datasetIndex]?.data?.[hit.index];
                const officeId = raw?.officeId;
                if(!officeId) return;

                const filtered = items.filter(r=>String(r['dst_office_id'] || '').trim()===String(officeId));
                openModal(filtered, `ПВЗ: ${officeId} — ${raw.officeName || '—'}`, { lrId });
            },
            plugins:{
                legend:{display:false},
                tooltip:{
                    callbacks:{
                        title:(ctx)=>`dst_office_name: ${ctx[0]?.raw?.officeName || '—'}`,
                        label:(ctx)=>{
                            const p = ctx.raw || {};
                            return [
                                `dst_office_id: ${p.officeId || '—'}`,
                                `Шт списаний: ${format(p.qty || 0)}`,
                                `Сумма: ₽ ${format(p.sum || 0)}`,
                                `Строк: ${format(p.rows || 0)}`
                            ];
                        }
                    }
                }
            },
            scales:{
                x:{
                    min:0,
                    max:points.length + 1,
                    grid:{display:false},
                    border:{display:false},
                    ticks:{display:false}
                },
                y:{
                    min:0,
                    max:2,
                    grid:{display:false},
                    border:{display:false},
                    ticks:{display:false}
                }
            }
        }
    });
}

function renderLrCommentBarChart(items){
    if(lrCommentBarInstance){
        lrCommentBarInstance.destroy();
        lrCommentBarInstance = null;
    }
    const canvas = document.getElementById('lrCommentChart');
    if(!canvas) return;

    const labels = ['2 ШК','Пустая упаковка','Подмена','Другое'];
    const sums = { '2 ШК':0, 'Пустая упаковка':0, 'Подмена':0, 'Другое':0 };

    items.forEach(r=>{
        const cat = classifyComment46(r[COL.comment]);
        sums[cat] += qtyFromRow(r);
    });

    const data = labels.map(l=>sums[l] || 0);
    const colors = ['#ef4444','#f59e0b','#8b5cf6','#64748b'];

    lrCommentBarInstance = new Chart(canvas,{
        type:'bar',
        data:{
            labels,
            datasets:[{
                data,
                backgroundColor: colors,
                borderColor: colors,
                borderWidth:1,
                borderRadius:8
            }]
        },
        options:{
            animation:{duration:520,easing:'easeOutCubic'},
            plugins:{
                legend:{display:false},
                tooltip:{
                    callbacks:{
                        label:(ctx)=>{
                            const v = Number(ctx.parsed.y || 0);
                            return `Шт списаний: ${format(v)}`;
                        }
                    }
                }
            },
            scales:{
                y:{
                    beginAtZero:true,
                    ticks:{precision:0},
                    title:{display:true,text:'Шт списаний'}
                }
            },
            onClick:(event, els, chart)=>{
                let points = els;
                if(!points || !points.length){
                    points = chart.getElementsAtEventForMode(event,'nearest',{intersect:true},true);
                }
                if(!points?.length) return;
                const hit = points[0];
                const category = labels[hit.index];
                if(!category) return;
                const filtered = items.filter(r=>classifyComment46(r[COL.comment])===category);
                openModal(filtered, `LR 46 — ${category}`, { lrId: 46 });
            }
        }
    });
}
function renderLr32StatusPieChart(items, statusColors){
    if(lrStatusPieInstance){
        lrStatusPieInstance.destroy();
        lrStatusPieInstance = null;
    }
    const canvas = document.getElementById('lr32StatusPieChart');
    if(!canvas) return;

    const byStatus = {};
    const byStatusQty = {};
    items.forEach(r=>{
        const status = r[COL.status] || '—';
        byStatus[status] = (byStatus[status] || 0) + Number(r[COL.sum] || 0);
        byStatusQty[status] = (byStatusQty[status] || 0) + qtyFromRow(r);
    });

    const labels = Object.keys(byStatus);
    const values = labels.map(l=>byStatus[l]);
    const total = values.reduce((s,v)=>s+v,0) || 1;
    const colors = labels.map(l=>statusColors?.[l] || '#64748b');

    lrStatusPieInstance = new Chart(canvas,{
        type:'doughnut',
        data:{
            labels,
            datasets:[{
                data: values,
                backgroundColor: colors,
                borderColor: colors,
                borderWidth:1.2,
                hoverOffset:6
            }]
        },
        options:{
            responsive:false,
            maintainAspectRatio:true,
            cutout:'48%',
            animation:{duration:220,easing:'easeOutCubic'},
            plugins:{
                legend:{display:false},
                tooltip:{
                    callbacks:{
                        title:(ctx)=>ctx[0]?.label || '—',
                        label:(ctx)=>{
                            const v = Number(ctx.parsed || 0);
                            const pct = (v / total) * 100;
                            const status = labels[ctx.dataIndex];
                            return [
                                `Сумма: ₽ ${format(v)}`,
                                `Шт списаний: ${format(byStatusQty[status] || 0)}`,
                                `Доля: ${pct.toFixed(1)}%`
                            ];
                        }
                    }
                }
            }
        }
    });
}

/* ================= STATS ================= */

function calcIdStats(items){
    const sums = items.map(r=>Number(r[COL.sum]||0)).sort((a,b)=>a-b);
    const expensive = items.filter(r=>Number(r[COL.sum]||0) >= 3000);
    const byNm = groupBy(items, COL.product);
    const staff = items
        .map(r=>{
            const c = getCounterpartyFromRow(r);
            if(c.type !== 'EMP') return null;
            const id = String(c.id || '').trim();
            if(!id) return null;
            return { ...r, __emp_id: id };
        })
        .filter(Boolean);
    const byStaff = groupBy(staff,'__emp_id');

    return {
        totalCount: countProducts(items),
        totalSum: sumField(items, COL.sum),
        expensiveCount: countProducts(expensive),
        expensiveSum: sumField(expensive, COL.sum),
        massNm: Object.values(byNm).filter(v=>v.length>=5).length,
        massStaff: Object.values(byStaff).filter(v=>v.length>=5).length,
        median: sums.length ? sums[Math.floor(sums.length/2)] : 0
    };
}

/* ================= UI ================= */

function createIdWrapper(id, stats, items, isAuto){
    const box = document.createElement('section');
    box.className='status-box';

    box.innerHTML=`
<div class="status-header">
    <div class="status-side clickable">
        <div class="status-big">${stats.totalCount}</div>
        <div class="status-label">Товаров</div>
    </div>

    <div class="status-center">
        <div class="status-code clickable lr-title">LR ${id}</div>
        <div class="status-desc">${getWriteoffName(id, items) || '—'}</div>
    </div>

    <div class="status-side">
        <div class="status-big">₽ ${format(stats.totalSum)}</div>
        <div class="status-label">Сумма</div>
    </div>
</div>
`;
    return box;
}

/* ================= MODAL ================= */

const modal=document.getElementById('modal');
const modalBody=document.getElementById('modal-body');
let modalStack = [];
let currentModalState = null;

modal.onclick=e=>{
    if(e.target===modal) closeModal();
};

function openModal(items,title){
    let options = {};
    if(typeof arguments[2] === 'object' && arguments[2] !== null){
        options = arguments[2];
    }

    if(!items.length){
        MiniUI.toast('Ничего не найдено',{type:'info'});
        return;
    }

    openState({
        type:'table',
        items,
        title,
        lrId: options.lrId || null,
        columns: Array.isArray(options.columns) ? options.columns : null,
        exportSuffix: options.exportSuffix || ''
    });
}

function renderTableModal(state){
    const title = withLrTitle(state.title, state.lrId);
    currentModalItems = [...state.items];
    currentSort = { key:null, dir:1 };
    const columns = Array.isArray(state.columns) && state.columns.length
        ? state.columns
        : getDetailTableColumns(state.lrId);

    modalBody.innerHTML=`
<h2>${title}</h2>
<div style="display:flex;justify-content:flex-end;margin:0 0 10px 0;">
    <button class="btn btn-rect" data-export="table">Выгрузить в Excel</button>
</div>
<table class="modal-table">
<thead>
<tr>
${columns.map(c=>`<th data-sort="${escapeAttr(c.key)}">${c.title} <span class="sort-indicator"></span></th>`).join('')}
</tr>
</thead>
<tbody>${renderModalBody(currentModalItems, columns)}</tbody>
</table>
`;

    const exportBtn = modalBody.querySelector('[data-export="table"]');
    if(exportBtn){
        exportBtn.onclick = ()=>{
            const suffix = state.exportSuffix || (state.lrId ? `lr_${state.lrId}_table` : 'table');
            exportItems(state.items, suffix);
        };
    }

    attachModalTableSortHandlers(columns);
}

function renderModalBody(items, columns){
    return items.map(r=>`
<tr>
${columns.map(c=>`<td>${getCellValue(r, c.key)}</td>`).join('')}
</tr>`).join('');
}
function attachModalTableSortHandlers(columns){
    modalBody.querySelectorAll('th[data-sort]').forEach(th=>{
        th.onclick = ()=>{
            const key = th.dataset.sort;
            if(!key) return;

            if(currentSort.key === key){
                currentSort.dir *= -1;
            } else {
                currentSort.key = key;
                currentSort.dir = 1;
            }

            currentModalItems.sort((a,b)=>{
                if(NO_BARCODE_DATE_SORT_KEYS.has(key)){
                    const da = parseDateValue(a[key] || a[COL.dtLost]);
                    const db = parseDateValue(b[key] || b[COL.dtLost]);
                    if(da && db) return (da - db) * currentSort.dir;
                    if(da) return -1 * currentSort.dir;
                    if(db) return 1 * currentSort.dir;
                }

                const vaRaw = a[key] ?? '';
                const vbRaw = b[key] ?? '';
                const vaNum = toNumberSafe(vaRaw, NaN);
                const vbNum = toNumberSafe(vbRaw, NaN);
                if(Number.isFinite(vaNum) && Number.isFinite(vbNum)){
                    return (vaNum - vbNum) * currentSort.dir;
                }
                return String(vaRaw).localeCompare(String(vbRaw), 'ru') * currentSort.dir;
            });

            const tbody = modalBody.querySelector('tbody');
            if(tbody){
                tbody.innerHTML = renderModalBody(currentModalItems, columns);
            }

            modalBody.querySelectorAll('.sort-indicator').forEach(el=>{ el.textContent=''; });
            const indicator = th.querySelector('.sort-indicator');
            if(indicator){
                indicator.textContent = currentSort.dir === 1 ? '▲' : '▼';
            }
        };
    });
}
function getDetailTableColumns(lrId){
    if(Number(lrId)===46){
        return [
            { key:COL.dtLost, title:'Дата' },
            { key:COL.product, title:'ШК' },
            { key:COL.sum, title:'Сумма' },
            { key:'Подкатегория товара', title:'Подкатегория' },
            { key:COL.comment, title:'Комментарий последнего списания' }
        ];
    }
    return [
        { key:COL.dtLost, title:'Дата' },
        { key:COL.product, title:'ШК' },
        { key:COL.sum, title:'Сумма' },
        { key:'Родительская категория товара', title:'Категория' },
        { key:'Подкатегория товара', title:'Подкатегория' },
        { key:'Бренд', title:'Бренд' }
    ];
}
function getCellValue(row, key){
    if(NO_BARCODE_DATE_SORT_KEYS.has(key)){
        return normalizeDate(row[key] || row[COL.dtLost]) || '—';
    }
    if(key===COL.sum) return format(row[key]);
    if(key===NO_BARCODE_KEYS.nmRepMatches) return format(row[key]);
    const v = row[key];
    return (v===undefined || v===null || v==='') ? '—' : escapeHtml(v);
}

function closeModal(){
    if(modalStack.length){
        const prev = modalStack.pop();
        renderModalState(prev, { push:false });
        return;
    }
    modal.classList.add('hidden');
    currentModalState = null;
    modalStack = [];
    if(lrChartInstance){
        lrChartInstance.destroy();
        lrChartInstance = null;
    }
    if(lrEmpBubbleInstance){
        lrEmpBubbleInstance.destroy();
        lrEmpBubbleInstance = null;
    }
    if(lrPvzBubbleInstance){
        lrPvzBubbleInstance.destroy();
        lrPvzBubbleInstance = null;
    }
    if(lrCommentBarInstance){
        lrCommentBarInstance.destroy();
        lrCommentBarInstance = null;
    }
    if(lrStatusPieInstance){
        lrStatusPieInstance.destroy();
        lrStatusPieInstance = null;
    }
}

function openState(state){
    renderModalState(state, { push:true });
}

function renderModalState(state, opts){
    const push = opts?.push ?? true;
    const keepScrollTop = Number.isFinite(opts?.keepScrollTop) ? opts.keepScrollTop : null;
    if(push && currentModalState){
        modalStack.push(currentModalState);
    }

    currentModalState = state;
    if(state.type==='lr'){
        renderLRDetails(state);
    } else {
        if(lrChartInstance){
            lrChartInstance.destroy();
            lrChartInstance = null;
        }
        if(lrEmpBubbleInstance){
            lrEmpBubbleInstance.destroy();
            lrEmpBubbleInstance = null;
        }
        if(lrPvzBubbleInstance){
            lrPvzBubbleInstance.destroy();
            lrPvzBubbleInstance = null;
        }
        if(lrCommentBarInstance){
            lrCommentBarInstance.destroy();
            lrCommentBarInstance = null;
        }
        if(lrStatusPieInstance){
            lrStatusPieInstance.destroy();
            lrStatusPieInstance = null;
        }
        renderTableModal(state);
    }

    modal.classList.remove('hidden');
    if(keepScrollTop !== null){
        const scroller = modal.querySelector('.modal-content');
        if(scroller){
            scroller.scrollTop = keepScrollTop;
        }
    }
}

/* ================= HELPERS ================= */

async function getNoBarcodeNmRepMatches(sourceRows){
    if(noBarcodeNmRepCache.rowsRef === sourceRows){
        if(noBarcodeNmRepCache.result){
            return noBarcodeNmRepCache.result;
        }
        if(noBarcodeNmRepCache.promise){
            return noBarcodeNmRepCache.promise;
        }
    }

    const promise = computeNoBarcodeNmRepMatches(sourceRows).then(result=>{
        noBarcodeNmRepCache = {
            rowsRef: sourceRows,
            promise: null,
            result
        };
        return result;
    }).catch(err=>{
        const message = String(err?.message || err || 'Не удалось загрузить данные nm_rep');
        const fallback = {
            items: [],
            comparedRows: 0,
            nmCount: 0,
            error: message
        };
        noBarcodeNmRepCache = {
            rowsRef: sourceRows,
            promise: null,
            result: fallback
        };
        return fallback;
    });

    noBarcodeNmRepCache = {
        rowsRef: sourceRows,
        promise,
        result: null
    };

    return promise;
}

async function computeNoBarcodeNmRepMatches(sourceRows){
    const inputRows = Array.isArray(sourceRows) ? sourceRows : [];
    if(!inputRows.length){
        return {
            items: [],
            comparedRows: 0,
            nmCount: 0,
            error: ''
        };
    }
    if(typeof supabaseClient === 'undefined' || !supabaseClient){
        return {
            items: [],
            comparedRows: 0,
            nmCount: 0,
            error: 'Supabase не инициализирован'
        };
    }

    const nmIdColumn = resolveNmIdColumn(inputRows);
    if(!nmIdColumn){
        return {
            items: [],
            comparedRows: 0,
            nmCount: 0,
            error: 'В файле не найдена колонка ID номенклатуры'
        };
    }

    const prepared = [];
    inputRows.forEach(row=>{
        const nmId = getRowNmId(row, nmIdColumn);
        const lossDate = parseDateValue(row?.[COL.dtLost]);
        if(!nmId || !lossDate) return;
        prepared.push({ row, nmId, lossDate });
    });

    if(!prepared.length){
        return {
            items: [],
            comparedRows: 0,
            nmCount: 0,
            error: ''
        };
    }

    const uniqueNmIds = Array.from(new Set(prepared.map(x=>x.nmId)));
    const lossDates = prepared.map(x=>x.lossDate);
    const minLossDate = new Date(Math.min(...lossDates.map(d=>d.getTime())));
    const maxLossDate = new Date(Math.max(...lossDates.map(d=>d.getTime())));
    const fromDate = shiftDateByMonths(minLossDate, -2);
    const toDate = shiftDateByMonths(maxLossDate, 2);

    const fetchResult = await fetchNmRepRowsForMatch(uniqueNmIds, fromDate, toDate);
    if(fetchResult.error){
        return {
            items: [],
            comparedRows: prepared.length,
            nmCount: uniqueNmIds.length,
            error: fetchResult.error
        };
    }

    const nmEntryMap = buildNmRepEntryMap(fetchResult.rows || []);
    const matchedItems = [];

    prepared.forEach(item=>{
        const sourceEntries = nmEntryMap.get(item.nmId);
        if(!sourceEntries?.length) return;

        const dateFrom = shiftDateByMonths(item.lossDate, -2);
        const dateTo = shiftDateByMonths(item.lossDate, 2);
        const matchedEntries = getNmRepEntriesInRange(sourceEntries, dateFrom, dateTo);
        if(!matchedEntries.length) return;

        const nearestEntry = getClosestNmRepEntry(item.lossDate, matchedEntries);
        const matchedDates = matchedEntries.map(x=>x.date);
        matchedItems.push({
            ...item.row,
            [NO_BARCODE_KEYS.lossDate]: formatDate(item.lossDate),
            [NO_BARCODE_KEYS.nmId]: item.nmId,
            [NO_BARCODE_KEYS.nearestNmRepDate]: nearestEntry?.date ? formatDate(nearestEntry.date) : '',
            [NO_BARCODE_KEYS.nmRepEmp]: nearestEntry?.emp || '',
            [NO_BARCODE_KEYS.nmRepMatches]: matchedEntries.length,
            [NO_BARCODE_KEYS.nmRepDates]: summarizeDateList(matchedDates, 5)
        });
    });

    return {
        items: matchedItems,
        comparedRows: prepared.length,
        nmCount: uniqueNmIds.length,
        error: ''
    };
}

async function fetchNmRepRowsForMatch(nmIds, fromDate, toDate){
    const ids = Array.isArray(nmIds) ? nmIds.filter(Boolean) : [];
    if(!ids.length){
        return { rows: [], error: null };
    }

    const chunkSize = 400;
    const dateFromIso = formatIsoDate(shiftDateByDays(fromDate, -1));
    const dateToIso = formatIsoDate(shiftDateByDays(toDate, 1));
    const allRows = [];

    for(let i=0; i<ids.length; i+=chunkSize){
        const chunk = ids.slice(i, i + chunkSize);

        const { data, error } = await supabaseClient
            .from('nm_rep')
            .select('nm, date, emp')
            .in('nm', chunk)
            .gte('date', dateFromIso)
            .lte('date', dateToIso);

        if(error){
            console.warn('nm_rep load failed', error);
            return {
                rows: [],
                error: 'Ошибка загрузки данных nm_rep'
            };
        }

        allRows.push(...(Array.isArray(data) ? data : []));
    }

    return { rows: allRows, error: null };
}

function resolveNmIdColumn(inputRows){
    const sample = inputRows.find(r=>r && typeof r === 'object');
    if(!sample) return '';

    const keys = Object.keys(sample);
    for(const key of NM_ID_COLUMN_CANDIDATES){
        if(keys.includes(key)) return key;
    }

    const dynamic = keys.find(rawKey=>{
        const key = String(rawKey || '').trim().toLowerCase();
        if(!key) return false;
        if(key === 'nm' || key === 'nm_id' || key === 'nmid') return true;
        return key.includes('номенклатур') && key.includes('id');
    });
    return dynamic || '';
}

function getRowNmId(row, nmIdColumn){
    if(row && nmIdColumn && Object.prototype.hasOwnProperty.call(row, nmIdColumn)){
        return normalizeNmId(row[nmIdColumn]);
    }
    for(const key of NM_ID_COLUMN_CANDIDATES){
        if(row && Object.prototype.hasOwnProperty.call(row, key)){
            const normalized = normalizeNmId(row[key]);
            if(normalized) return normalized;
        }
    }
    return '';
}

function normalizeNmId(value){
    if(value === null || value === undefined) return '';

    if(typeof value === 'number' && Number.isFinite(value)){
        if(Number.isInteger(value)) return String(value);
        return String(value).replace(/\.0+$/,'');
    }

    const raw = String(value).trim();
    if(!raw) return '';
    const compact = raw.replace(/\s+/g,'');
    if(!compact) return '';
    if(/^\d+\.0+$/.test(compact)){
        return compact.replace(/\.0+$/,'');
    }
    return compact;
}

function shiftDateByMonths(date, delta){
    const source = date instanceof Date ? date : parseDateValue(date);
    if(!source) return null;

    const day = source.getDate();
    const first = new Date(source.getFullYear(), source.getMonth() + delta, 1);
    const maxDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    first.setDate(Math.min(day, maxDay));
    return first;
}

function shiftDateByDays(date, delta){
    const source = date instanceof Date ? date : parseDateValue(date);
    if(!source) return null;
    const d = new Date(source.getFullYear(), source.getMonth(), source.getDate());
    d.setDate(d.getDate() + delta);
    return d;
}

function formatIsoDate(date){
    const d = date instanceof Date ? date : parseDateValue(date);
    if(!d) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd}`;
}

function buildNmRepEntryMap(nmRepRows){
    const map = new Map();
    (nmRepRows || []).forEach(row=>{
        const nmId = normalizeNmId(row?.nm);
        const date = parseDateValue(row?.date);
        if(!nmId || !date) return;
        if(!map.has(nmId)){
            map.set(nmId, []);
        }
        map.get(nmId).push({
            date,
            emp: String(row?.emp || '').trim()
        });
    });

    map.forEach((entries, key)=>{
        entries.sort((a,b)=>a.date - b.date);
        map.set(key, entries);
    });

    return map;
}

function getNmRepEntriesInRange(sortedEntries, fromDate, toDate){
    if(!Array.isArray(sortedEntries) || !sortedEntries.length || !fromDate || !toDate){
        return [];
    }
    const from = fromDate.getTime();
    const to = toDate.getTime();
    const left = lowerBoundNmRepEntry(sortedEntries, from);
    const right = upperBoundNmRepEntry(sortedEntries, to) - 1;
    if(left > right || left >= sortedEntries.length || right < 0){
        return [];
    }
    return sortedEntries.slice(left, right + 1);
}

function lowerBoundNmRepEntry(sortedEntries, targetTime){
    let left = 0;
    let right = sortedEntries.length;
    while(left < right){
        const mid = (left + right) >> 1;
        if(sortedEntries[mid].date.getTime() < targetTime){
            left = mid + 1;
        } else {
            right = mid;
        }
    }
    return left;
}

function upperBoundNmRepEntry(sortedEntries, targetTime){
    let left = 0;
    let right = sortedEntries.length;
    while(left < right){
        const mid = (left + right) >> 1;
        if(sortedEntries[mid].date.getTime() <= targetTime){
            left = mid + 1;
        } else {
            right = mid;
        }
    }
    return left;
}

function getClosestNmRepEntry(targetDate, entries){
    if(!entries?.length) return null;
    let best = entries[0];
    let bestDiff = Math.abs(best.date.getTime() - targetDate.getTime());
    for(let i=1; i<entries.length; i++){
        const diff = Math.abs(entries[i].date.getTime() - targetDate.getTime());
        if(diff < bestDiff || (diff === bestDiff && entries[i].date > best.date)){
            best = entries[i];
            bestDiff = diff;
        }
    }
    return best;
}

function summarizeDateList(dates, limit){
    const arr = (dates || []).map(formatDate);
    if(arr.length <= limit){
        return arr.join(', ');
    }
    return `${arr.slice(0, limit).join(', ')} +${arr.length - limit}`;
}

function countProducts(arr){
    return arr.reduce((s,r)=>s+(r[COL.product]?1:0),0);
}
function sumField(arr,f){ return arr.reduce((s,r)=>s+Number(r[f]||0),0); }
function groupBy(arr,k){
    return arr.reduce((a,r)=>{ (a[r[k]]??=[]).push(r); return a; },{});
}
function getStatuses(items){
    const uniq = new Set(items.map(r=>r[COL.status] || '—'));
    return Array.from(uniq).sort((a,b)=>String(a).localeCompare(String(b),'ru'));
}
function buildStatusColorMap(statuses){
    const map = {};
    statuses.forEach((s,i)=>{
        map[s] = STATUS_PALETTE[i % STATUS_PALETTE.length];
    });
    return map;
}
function filterByStatuses(items, selectedSet){
    if(!selectedSet?.size) return [];
    return items.filter(r=>selectedSet.has(r[COL.status] || '—'));
}
function withLrTitle(title, lrId){
    const text = String(title || '').trim();
    if(!lrId || /LR\s*\d+/i.test(text)) return text;
    return `LR ${lrId} — ${text}`;
}
function exportItems(items, suffix){
    if(!items?.length){
        MiniUI.toast('Нет данных для выгрузки',{type:'info'});
        return;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(items);
    XLSX.utils.book_append_sheet(wb, ws, 'Детализация');
    XLSX.writeFile(wb, `pure_losses_${safeFilePart(suffix || 'details')}.xlsx`);
}
function safeFilePart(v){
    return String(v).toLowerCase().replace(/[^a-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'') || 'details';
}
function toNumberSafe(v, fallback){
    const n = Number(v);
    if(Number.isFinite(n)) return n;
    const parsed = Number(String(v).replace(',','.').replace(/[^\d.-]/g,''));
    return Number.isFinite(parsed) ? parsed : fallback;
}
function metricValue(row){
    if(valueMode === 'qty'){
        return qtyFromRow(row);
    }
    return Number(row[COL.sum] || 0);
}
function sumMetric(arr){
    return arr.reduce((s,r)=>s+metricValue(r),0);
}
function bubbleMetric(empAgg){
    return valueMode === 'qty'
        ? Number(empAgg?.qty || 0)
        : Number(empAgg?.sum || 0);
}
function getDominantStatus(statusQty){
    let best = '—';
    let bestQty = -Infinity;
    Object.entries(statusQty || {}).forEach(([status,qty])=>{
        const v = Number(qty || 0);
        if(v > bestQty){
            bestQty = v;
            best = status;
        }
    });
    return best;
}
function hexToRgba(hex, alpha){
    const raw = String(hex || '').trim();
    const m = raw.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if(!m) return `rgba(100,116,139,${alpha})`;
    const r = parseInt(m[1], 16);
    const g = parseInt(m[2], 16);
    const b = parseInt(m[3], 16);
    return `rgba(${r},${g},${b},${alpha})`;
}
function qtyFromRow(row){
    const keys = [
        'Шт списаний',
        'Шт. списаний',
        'Шт списания',
        'Количество',
        'Кол-во',
        'Qty',
        'qty'
    ];
    for(const key of keys){
        if(row && Object.prototype.hasOwnProperty.call(row,key)){
            const n = toNumberSafe(row[key], NaN);
            if(Number.isFinite(n) && n !== 0) return n;
        }
    }
    return row?.[COL.product] ? 1 : 0;
}
function isOprihodRow(row){
    return isTrueLike(row?.[COL.postedFlag]);
}
function getPostedDateKey(row){
    if(!isOprihodRow(row)) return '';
    const raw = row?.[COL.postedDate];
    if(raw===null || raw===undefined || raw==='') return '';
    const text = String(raw).trim();
    if(text.startsWith('1970-01-01')) return '';
    const d = parseDateValue(raw);
    if(!d) return '';
    if(d.getFullYear()===1970 && d.getMonth()===0 && d.getDate()===1) return '';
    return formatDate(d);
}
function classifyComment46(comment){
    const text = String(comment || '').toLowerCase().trim();
    if(!text) return 'Другое';

    const has2Shk = hasAnyToken(text, [
        '2 шк','задвойка','задвойку','2шк','два шк','двашк','двумя шк','задвоенный'
    ]);
    if(has2Shk) return '2 ШК';

    const hasEmptyPack = hasAnyToken(text, [
        'пустая','пустую'
    ]);
    if(hasEmptyPack) return 'Пустая упаковка';

    const hasSubstitute = hasAnyToken(text, [
        'нв','подмена','браке','брак','деффект','деффектом','сломан',
        'испорчен','испортил','подмене','подмену','брака','подмены',
        'несоответствии','несоответствие','неверное вложение','по факту'
    ]);
    if(hasSubstitute) return 'Подмена';

    return 'Другое';
}
function hasAnyToken(text, tokens){
    return tokens.some(t=>text.includes(String(t).toLowerCase()));
}
function buildEmpBubbleCloud(top, statusColors){
    if(!top.length) return [];

    const maxMetric = Math.max(...top.map(x=>bubbleMetric(x)));
    const points = [];

    const makePoint = (item, x, y)=>{
        const dominantStatus = getDominantStatus(item.statusQty);
        const baseColor = statusColors?.[dominantStatus] || '#64748b';
        const metric = bubbleMetric(item);
        return {
            x,
            y,
            r:Math.max(24, Math.round((metric / maxMetric) * 69)),
            empId:item.id,
            qty:item.qty,
            rows:item.rows,
            sum:item.sum,
            dominantStatus,
            bgColor:hexToRgba(baseColor, 0.58),
            borderColor:hexToRgba(baseColor, 0.95),
            textColor:'#ffffff'
        };
    };

    const first = makePoint(top[0], 0, 0);
    points.push(first);
    let spiral = first.r + 24;

    for(let idx=1; idx<top.length; idx++){
        const item = top[idx];
        const candidate = makePoint(item, 0, 0);
        const placed = placeNonOverlappingPoint(candidate, points, spiral);
        points.push(placed);
        spiral = Math.max(spiral, Math.hypot(placed.x, placed.y) + placed.r + 12);
    }

    return points;
}
function buildPvzRowSquares(top, statusColors){
    if(!top.length) return [];
    const maxMetric = Math.max(...top.map(x=>bubbleMetric(x)));
    return top.map((item, i)=>{
        const dominantStatus = getDominantStatus(item.statusQty);
        const baseColor = statusColors?.[dominantStatus] || '#64748b';
        const metric = bubbleMetric(item);
        return {
            x:i + 1,
            y:1,
            r:Math.max(16, Math.round((metric / maxMetric) * 30)),
            officeId:item.officeId,
            officeName:item.officeName,
            qty:item.qty,
            rows:item.rows,
            sum:item.sum,
            bgColor:hexToRgba(baseColor, 0.58),
            borderColor:hexToRgba(baseColor, 0.95)
        };
    });
}
function placeNonOverlappingPoint(candidate, existing, startRadius){
    let dist = Math.max(20, startRadius);
    for(let ring=0; ring<24; ring++){
        const slots = Math.max(12, Math.round((dist / 10) * 2.4));
        for(let i=0; i<slots; i++){
            const angle = (Math.PI * 2 * i / slots) + (ring % 2 ? Math.PI / slots : 0);
            const x = Math.cos(angle) * dist;
            const y = Math.sin(angle) * dist;
            if(isFreeSpot(x, y, candidate.r, existing)){
                return { ...candidate, x, y };
            }
        }
        dist += Math.max(16, candidate.r * 0.55);
    }
    return { ...candidate, x:dist, y:0 };
}
function isFreeSpot(x, y, r, existing){
    for(const p of existing){
        const minDist = r + p.r + 8;
        if(Math.hypot(x - p.x, y - p.y) < minDist){
            return false;
        }
    }
    return true;
}
function escapeAttr(v){
    return String(v)
        .replace(/&/g,'&amp;')
        .replace(/"/g,'&quot;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;');
}
function escapeHtml(v){
    return String(v)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;');
}
function wrapTooltipLine(text, maxLen){
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if(!words.length) return [''];
    const lines = [];
    let current = words[0];
    for(let i=1; i<words.length; i++){
        const next = `${current} ${words[i]}`;
        if(next.length <= maxLen){
            current = next;
        } else {
            lines.push(current);
            current = words[i];
        }
    }
    lines.push(current);
    return lines;
}
function format(n){
    return Math.trunc(n||0).toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.');
}
function sortDates(a,b){
    const da = parseDateValue(a);
    const db = parseDateValue(b);
    if(da && db) return da - db;
    if(da) return -1;
    if(db) return 1;
    return String(a).localeCompare(String(b),'ru');
}

function parseDateValue(v){
    if(v===null || v===undefined || v==='') return null;

    if(v instanceof Date && !isNaN(v)){
        return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    }

    if(typeof v === 'number' && Number.isFinite(v)){
        const excelEpochOffset = 25569;
        const dayMs = 86400 * 1000;
        const ts = (Math.floor(v) - excelEpochOffset) * dayMs;
        const d = new Date(ts);
        if(!isNaN(d)) return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }

    const raw = String(v).trim();
    if(!raw) return null;
    const s = raw.replace('T',' ').split(' ')[0];

    let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if(m){
        let year = Number(m[3]);
        if(year < 100) year += 2000;
        const d = new Date(year, Number(m[2])-1, Number(m[1]));
        if(!isNaN(d)) return d;
    }

    m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if(m){
        const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
        if(!isNaN(d)) return d;
    }

    const parsed = new Date(raw);
    if(!isNaN(parsed)){
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }

    return null;
}

function formatDate(d){
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
}

function getWriteoffName(id, items){
    const key = String(id ?? '').trim();
    if(key && writeoffNameById.has(key)){
        return writeoffNameById.get(key);
    }
    return items?.[0]?.['Тип списания'] || '';
}

async function loadWriteoffNames(){
    if(writeoffNamesLoaded) return;
    if(typeof supabaseClient === 'undefined' || !supabaseClient) return;

    const { data, error } = await supabaseClient
        .from('losses_rep')
        .select('writeoff_id, writeoff_name');

    if(error){
        console.warn('losses_rep load failed', error);
        return;
    }

    (data || []).forEach(row=>{
        if(row?.writeoff_id === null || row?.writeoff_id === undefined) return;
        writeoffNameById.set(String(row.writeoff_id), row?.writeoff_name || '');
    });
    writeoffNamesLoaded = true;

    if(rows.length){
        renderReport();
    }
}

function parseArrayValue(v){
    if(v===null || v===undefined) return [];
    if(Array.isArray(v)) return v;
    const raw = String(v).trim();
    if(!raw) return [];
    try{
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return [raw];
    }
}

function getCounterpartyFromRow(row){
    const types = parseArrayValue(row?.[COL.counterpartyType]);
    const ids = parseArrayValue(row?.[COL.counterpartyId]);

    const idx = types.findIndex(t=>String(t).trim().toUpperCase()==='EMP');
    if(idx !== -1){
        return {
            type: 'EMP',
            id: ids[idx] ?? ids[0] ?? ''
        };
    }

    return {
        type: types[0] ?? '',
        id: ids[0] ?? ''
    };
}

function isTrueLike(v){
    if(v === true) return true;
    if(v === false || v === 0) return false;
    const text = String(v).trim().toLowerCase();
    return text === 'true' || text === '1' || text === 'yes';
}
