let rows = [];
let currentModalItems = [];
let currentSort = { key:null, dir:1 };
let valueMode = 'sum'; // 'sum' | 'qty'

const AUTO_IDS = new Set([11,21,26,31,32,35,42,47]);
const STATUS_PALETTE = [
    '#2563eb','#f59e0b','#10b981','#ef4444','#8b5cf6',
    '#06b6d4','#f97316','#84cc16','#ec4899','#64748b'
];
const DONUT_PALETTE = [
    '#355070','#6d597a','#b56576','#e56b6f','#eaac8b',
    '#5c7c8a','#8d6a9f','#c97f92','#d88c7a','#7a8f9f'
];

/* ================= FILE ================= */

document.getElementById('file-input').addEventListener('change', handleFile);
document.getElementById('export-filtered').onclick = exportAll;
initValueToggle();

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

        if(!rows.length){
            MiniUI.toast('Файл пустой',{type:'error'});
            return;
        }
        renderReport();
    });
}

function exportAll(){
    if(!rows.length){
        MiniUI.toast('Нет данных для выгрузки',{type:'info'});
        return;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Потери');
    XLSX.writeFile(wb, 'nm_losses_export.xlsx');
}

/* ================= REPORT ================= */

function renderReport(){
    const container = document.getElementById('report');
    container.innerHTML = '';

    renderTotalBlock(container);

    const groups = {};
    rows.forEach(r=>{
        const id = Number(r['ID списания']);
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
}

function renderSection(container,title,blocks,groupKey){
    if(!blocks.length) return;

    const h = document.createElement('h2');
    h.textContent = title;
    container.appendChild(h);

    blocks.sort((a,b)=>b.items.length-a.items.length);
    renderGroupOverview(container, title, blocks, groupKey);
}

function renderGroupOverview(container, title, blocks, groupKey){
    const items = blocks.flatMap(b=>b.items);
    const totalProducts = countProducts(items);
    const totalSum = sumField(items,'Сумма списания');
    const postedItems = items.filter(isOprihodRow);
    const postedProducts = countProducts(postedItems);
    const postedSum = sumField(postedItems,'Сумма списания');
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
            <div class="metric-label">${escapeHtml(b.items[0]?.['Тип списания'] || '—')}</div>
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
    const auto = rows.filter(r=>AUTO_IDS.has(Number(r['ID списания'])));
    const manual = rows.filter(r=>!AUTO_IDS.has(Number(r['ID списания'])));
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
                <div class="status-big">₽ ${format(sumField(rows,'Сумма списания'))}</div>
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
                <div class="status-big">₽ ${format(sumField(posted,'Сумма списания'))}</div>
                <div class="status-label">Оприходовано Сумма</div>
            </div>
        </div>
    </div>
</div>

<div class="status-metrics">
    <div class="metric clickable" data-type="auto">
        <div class="metric-value">₽ ${format(sumField(auto,'Сумма списания'))}</div>
        <div class="metric-label">Автосписания сумма</div>
    </div>

    <div class="metric clickable" data-type="auto">
        <div class="metric-value">${countProducts(auto)}</div>
        <div class="metric-label">Автосписания кол-во</div>
    </div>

    <div class="metric clickable" data-type="manual">
        <div class="metric-value">₽ ${format(sumField(manual,'Сумма списания'))}</div>
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
        const d = normalizeDate(r['dt_lost']);
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
        const a = items.filter(r=>AUTO_IDS.has(Number(r['ID списания'])));
        const m = items.filter(r=>!AUTO_IDS.has(Number(r['ID списания'])));
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
    const sums = blocks.map(b=>sumField(b.items,'Сумма списания'));
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
    const expensiveItems = filteredItems.filter(r=>Number(r['Сумма списания']||0) >= 3000);
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
        <div class="status-big">₽ ${format(sumField(filteredItems,'Сумма списания'))}</div>
        <div class="status-label">Сумма всего</div>
    </div>
</div>

<div class="status-metrics">
    <div class="metric clickable" data-action="expensive"><div class="metric-value">${stats.expensiveCount}</div><div class="metric-label">Дорогостой</div></div>
    <div class="metric clickable" data-action="expensive-sum"><div class="metric-value">₽ ${format(stats.expensiveSum)}</div><div class="metric-label">Сумма дорогостоя</div></div>
    <div class="metric"><div class="metric-value">₽ ${format(stats.median)}</div><div class="metric-label">Медиана</div></div>
    <div class="metric clickable" data-action="posted-qty"><div class="metric-value">${countProducts(postedItems)}</div><div class="metric-label">Оприходовано ШТ</div></div>
    <div class="metric clickable" data-action="posted-sum"><div class="metric-value">₽ ${format(sumField(postedItems,'Сумма списания'))}</div><div class="metric-label">Оприходовано Сумма</div></div>
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
        const d = normalizeDate(r['dt_lost']);
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
            const s = r['Статус до списания'] || '—';
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
                    const byDay = (allItems || items).filter(r=>normalizeDate(r['dt_lost'])===day);
                    openModal(byDay, `Дата ${day} — все статусы`, { lrId: currentModalState?.lrId || null });
                    return;
                }

                const status = ds.label;
                const filtered = (allItems || items).filter(r=>
                    normalizeDate(r['dt_lost'])===day &&
                    (r['Статус до списания'] || '—')===status
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
        if(r['Код контрагента']!=='EMP') return;
        const id = String(r['ID контрагента'] || '').trim();
        if(!id) return;
        const qty = Math.max(1, qtyFromRow(r));
        const status = r['Статус до списания'] || '—';
        byEmp[id] ??= { id, qty:0, sum:0, rows:0, statusQty:{} };
        byEmp[id].qty += qty;
        byEmp[id].sum += Number(r['Сумма списания']||0);
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
                    r['Код контрагента']==='EMP' &&
                    String(r['ID контрагента'] || '').trim()===String(empId)
                );
                openModal(filtered, `Контрагент EMP: ${empId}`, { lrId });
            },
            plugins:{
                legend:{display:false},
                tooltip:{
                    callbacks:{
                        title:(ctx)=>`ID контрагента: ${ctx[0]?.raw?.empId || '—'}`,
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
        const status = r['Статус до списания'] || '—';
        byOffice[officeId] ??= { officeId, officeName, qty:0, sum:0, rows:0, statusQty:{} };
        byOffice[officeId].qty += qty;
        byOffice[officeId].sum += Number(r['Сумма списания']||0);
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
        const cat = classifyComment46(r['Комментарий при списании']);
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
                const filtered = items.filter(r=>classifyComment46(r['Комментарий при списании'])===category);
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
        const status = r['Статус до списания'] || '—';
        byStatus[status] = (byStatus[status] || 0) + Number(r['Сумма списания'] || 0);
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
    const sums = items.map(r=>Number(r['Сумма списания']||0)).sort((a,b)=>a-b);
    const expensive = items.filter(r=>Number(r['Сумма списания']||0) >= 3000);
    const byNm = groupBy(items,'Номенклатура');
    const staff = items.filter(r=>r['Код контрагента']==='EMP');
    const byStaff = groupBy(staff,'ID контрагента');

    return {
        totalCount: countProducts(items),
        totalSum: sumField(items,'Сумма списания'),
        expensiveCount: countProducts(expensive),
        expensiveSum: sumField(expensive,'Сумма списания'),
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
        <div class="status-desc">${items[0]?.['Тип списания'] || '—'}</div>
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
        lrId: options.lrId || null
    });
}

function renderTableModal(state){
    const title = withLrTitle(state.title, state.lrId);
    currentModalItems = [...state.items];
    currentSort = { key:null, dir:1 };
    const columns = getDetailTableColumns(state.lrId);

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
            const suffix = state.lrId ? `lr_${state.lrId}_table` : 'table';
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
                if(key === 'dt_lost'){
                    const da = parseDateValue(a[key] || a['dt_lost']);
                    const db = parseDateValue(b[key] || b['dt_lost']);
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
            { key:'dt_lost', title:'Дата' },
            { key:'Товар', title:'Товар' },
            { key:'Сумма списания', title:'Сумма' },
            { key:'Подкатегория товара', title:'Подкатегория' },
            { key:'Комментарий при списании', title:'Комментарий при списании' }
        ];
    }
    return [
        { key:'dt_lost', title:'Дата' },
        { key:'Товар', title:'Товар' },
        { key:'Сумма списания', title:'Сумма' },
        { key:'Родительская категория товара', title:'Категория' },
        { key:'Подкатегория товара', title:'Подкатегория' },
        { key:'Бренд', title:'Бренд' }
    ];
}
function getCellValue(row, key){
    if(key==='dt_lost') return normalizeDate(row[key] || row['dt_lost']);
    if(key==='Сумма списания') return format(row[key]);
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

function countProducts(arr){
    return arr.reduce((s,r)=>s+(r['Товар']?1:0),0);
}
function sumField(arr,f){ return arr.reduce((s,r)=>s+Number(r[f]||0),0); }
function groupBy(arr,k){
    return arr.reduce((a,r)=>{ (a[r[k]]??=[]).push(r); return a; },{});
}
function getStatuses(items){
    const uniq = new Set(items.map(r=>r['Статус до списания'] || '—'));
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
    return items.filter(r=>selectedSet.has(r['Статус до списания'] || '—'));
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
    XLSX.writeFile(wb, `nm_losses_${safeFilePart(suffix || 'details')}.xlsx`);
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
    return Number(row['Сумма списания'] || 0);
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
    return row?.['Товар'] ? 1 : 0;
}
function isOprihodRow(row){
    return toNumberSafe(row?.['Оприходован'], 0) === 1;
}
function getPostedDateKey(row){
    if(!isOprihodRow(row)) return '';
    const raw = row?.['Дата оприходования'];
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
