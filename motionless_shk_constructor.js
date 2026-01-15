let rows = [];
let activeStatuses = new Set();
let expensiveOnly = false;
let currentModalItems = [];
let currentSort = { key: null, dir: 1 };


const STATUS_MAP = {
    SPS: 'Предсорт',
    SMC: 'Маркет',
    SMS: 'Последняя миля',
    WMI: 'Внутреннее перемещение'
};
const STATUS_DESCRIPTIONS = {
    SPS: 'Предсортировка в СЦ',
    SMC: 'Сортировка в контейнер',
    WMI: 'Внутреннее перемещение',
    SMS: 'Сортировка в СЦ'
};

const CATEGORY_ORDER = [
    'Предсорт',
    'Маркет',
    'Последняя миля',
    'Внутреннее перемещение',
    'Другое'
];
const STATUS_MODAL_INFO = {
    SPS: 'Товар зависший после прохождения предсортировки. Чаще всего сюда попадают вещи, которые бессистемно закинуты в коробку на КС, товар «Без ШК».',

    SMS: 'Товар зависший после прохождения сортировки. Чаще всего такие ШК — зависшие передачи на буфере последней мили.',

    SMC: 'Товар зависший после сортировки в контейнер на маркетплейсе. Самые частые ошибки — неверное вложение на отправляющей стороне или бессистемная сортировка на принимающей.',

    WMI: 'Товар зависший после сканирования на МХ, для которого не предназначен. Так называемые «Ошибки». Чаще всего сюда попадают потерянные леваки, скан товара без активного заказа или задвойки ШК.',

    Другое: 'В эту категорию попадает товар с нетипичными для СЦ статусами: TMM, SAS и другие.'
};


/* ================= INIT ================= */

document.getElementById('file-input').addEventListener('change', handleFile);
const expensiveBtn = document.getElementById('expensive-toggle');

expensiveBtn.onclick = () => {
    expensiveOnly = !expensiveOnly;

    expensiveBtn.classList.toggle('active', expensiveOnly);
    expensiveBtn.textContent = expensiveOnly ? '₽₽' : '₽';

    renderReport();
};


const statusBtn = document.getElementById('status-btn');
const statusDropdown = document.getElementById('status-dropdown');

statusBtn.onclick = e => {
    e.stopPropagation();
    statusDropdown.classList.toggle('hidden');
};

document.addEventListener('click', e => {
    if (!e.target.closest('.status-dropdown')) {
        statusDropdown.classList.add('hidden');
    }
});
document.getElementById('export-filtered').onclick = () => {
    if (!rows.length) {
        MiniUI?.toast?.('Нет данных для выгрузки', { type: 'error' });
        return;
    }

    const filtered = rows.filter(r =>
        activeStatuses.has(r['Статус ШК']) &&
        (!expensiveOnly || Number(r['Стоимость']) >= 1000)
    );

    if (!filtered.length) {
        MiniUI?.toast?.('По выбранным фильтрам нет данных', { type: 'error' });
        return;
    }

    exportToExcel(
        filtered,
        buildExportFilename()
    );
};


/* ================= FILE LOAD ================= */

function handleFile(e) {
    const files = Array.from(e.target.files || []);

    if (!files.length) return;

    if (files.length > 10) {
        MiniUI?.toast?.('Можно загрузить не более 10 файлов', { type: 'error' });
        e.target.value = '';
        return;
    }

    const excelFiles = files.filter(f =>
        /\.(xls|xlsx)$/i.test(f.name) &&
        (
            f.type.includes('spreadsheet') ||
            f.type.includes('excel') ||
            f.type === ''
        )
    );

    if (excelFiles.length !== files.length) {
        MiniUI?.toast?.('Разрешены только Excel файлы (.xls, .xlsx)', { type: 'error' });
        e.target.value = '';
        return;
    }

    rows = [];

    Promise.all(
        excelFiles.map(file =>
            file.arrayBuffer().then(buf => {
                const wb = XLSX.read(buf, { type: 'array' });
                const sheet = wb.Sheets[wb.SheetNames[0]];
                return XLSX.utils.sheet_to_json(sheet, { defval: '' });
            })
        )
    ).then(res => {
        rows = res.flat();
        buildStatusDropdown();
        renderReport();
    });
}

/* ================= STATUS DROPDOWN ================= */

function buildStatusDropdown() {
    const list = statusDropdown.querySelector('.status-list');
    if (!list) return;

    list.innerHTML = '';
    activeStatuses.clear();

    const statuses = [...new Set(
        rows.map(r => r['Статус ШК']).filter(Boolean)
    )];

    statuses.forEach(s => {
        activeStatuses.add(s);

        const label = document.createElement('label');
        label.className = 'status-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;

        cb.onchange = () => {
            cb.checked
                ? activeStatuses.add(s)
                : activeStatuses.delete(s);
            renderReport();
        };

        const text = document.createElement('span');
        text.textContent = s;

        label.append(cb, text);
        list.appendChild(label);
    });
}


/* ================= REPORT ================= */
function openStatusInfoModal(code) {
    modalBody.style.width = '520px';

    modalBody.innerHTML = `
        <h2>${code}</h2>
        <p style="margin-top:16px; line-height:1.5;">
            ${STATUS_MODAL_INFO[code] || STATUS_MODAL_INFO['Другое']}
        </p>
    `;

    modal.classList.remove('hidden');
}


function renderReport() {
    const container = document.getElementById('report');
    container.innerHTML = '';

    const filtered = rows.filter(r =>
        activeStatuses.has(r['Статус ШК']) &&
        (!expensiveOnly || Number(r['Стоимость']) >= 1000)
    );

    const byCategory = {};
    filtered.forEach(r => {
        const cat = STATUS_MAP[r['Статус ШК']] || 'Другое';
        byCategory[cat] ??= [];
        byCategory[cat].push(r);
    });

    CATEGORY_ORDER.forEach(cat => {
        if (!byCategory[cat]) return;

        const code =
            Object.keys(STATUS_MAP).find(k => STATUS_MAP[k] === cat) || cat;

        const data = byCategory[cat];
        const stats = calcStatusStats(data);

        const wrapper = createCategoryWrapper(code, stats);
        wrapper.querySelectorAll('.metric.clickable, .status-side.clickable')
            .forEach(el => {
                el.onclick = () => {
                    const type = el.dataset.type;

                    let items = data;

                    if (type === 'expensive') {
                        items = data.filter(r => Number(r['Стоимость']) >= 3000);
                    }

                    // type === 'all' → просто все items
                    openModal(items, 'Статус ШК', `Детализация — Статус ${code}`);
                };
            });

        const statusTitle = wrapper.querySelector('.clickable-status');
        statusTitle.onclick = () => {
            openStatusInfoModal(code);
        };
        const content = wrapper.querySelector('.status-content');

        renderCategory(content, cat, data);

        container.appendChild(wrapper);
    });
}


/* ================= CATEGORY ================= */

function renderCategory(container, cat, data) {

    renderGroupBlock(container, 'Детализация по МХ', data, 'MX', false, cat);

    if (['Предсорт','Маркет'].includes(cat)) {
        renderGroupBlock(container, 'Детализация по тарам', data, 'Гофра', true);
        renderGroupBlock(container, 'Детализация по сотрудникам', data, 'ID Ответственного', true);
    }

    if (cat === 'Последняя миля') {
        renderGroupBlock(container, 'Детализация по тарам', data, 'Передача', true);
        renderGroupBlock(container, 'Детализация по сотрудникам', data, 'ID Ответственного', true);
    }

    if (cat === 'Внутреннее перемещение') {
        renderGroupBlock(container, 'Детализация по сотрудникам', data, 'ID Ответственного', true);
    }
}


function renderGroupBlock(container, title, data, field, withRest = false, cat = null) {
    const groups = groupBy(data, field);
    let entries = Object.entries(groups);

    if (!entries.length) return;

    let restItems = [];

    if (withRest) {
        entries = entries.filter(([_, items]) => {
            if (items.length < 5) {
                restItems.push(...items);
                return false;
            }
            return true;
        });
    }
    const grid = document.createElement('div');
    const sums = entries.map(e => sum(e[1]));
    entries.sort((a,b) => b[1].length - a[1].length);
    entries.forEach(([key, items]) => {
        const total = sum(items);

        const uniqueTransfers = cat === 'Последняя миля'
            ? new Set(items.map(i => i['Передача']).filter(Boolean)).size
            : null;

        const block = document.createElement('div');
        block.className = 'buffer-block';
        block.style.background = blockColorByPercentile(total, sums);

        block.innerHTML = `
      <div style="font-weight:700;text-align:center;">${key}</div>
      ${uniqueTransfers !== null ? `<div>Передачи: ${uniqueTransfers}</div>` : ''}
      <div>ШК: ${items.length}</div>
      <div>₽ ${format(total)}</div>
    `;

        block.onclick = () => openModal(
            items,
            field,
            `Детализация — ${field} ${key}`,
            cat === 'Последняя миля'
        );

        grid.appendChild(block);
    });


    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `<span>${title}</span><span class="chevron">▸</span>`;

    const body = document.createElement('div');
    body.className = 'group-body hidden';

    header.onclick = () => {
        body.classList.toggle('hidden');
        const opened = body.classList.toggle('open');
        header.querySelector('.chevron').textContent =
            body.classList.contains('hidden') ? '▸' : '▾';
    };

    container.appendChild(header);
    container.appendChild(body);


    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
    grid.style.gap = '10px';
    grid.style.marginBottom = '16px';


    const min = sums[0], max = sums[sums.length-1], mid = sums[Math.floor(sums.length/2)];

    if (restItems.length) {
        const rest = document.createElement('div');
        rest.className = 'buffer-block';
        rest.style.background = '#ddd';
        rest.innerHTML = `
          <div style="font-weight:700;text-align:center;">Остальное</div>
          <div>ШК: ${restItems.length}</div>
        `;
        rest.onclick = () => openModal(restItems, field);
        grid.appendChild(rest);
    }

    body.appendChild(grid);
}

/* ================= MODAL ================= */

const modal = document.getElementById('modal');
const modalBody = document.getElementById('modal-body');

function openModal(items, field, title = '', isSMS = false) {
    const sorted = [...items].sort(
        (a,b) => Number(b['Стоимость']||0) - Number(a['Стоимость']||0)
    );
    currentModalItems = [...items];
    modalBody.style.width = '700px';
    modalBody.style.maxWidth = '700px';

    modalBody.innerHTML = `
    <h2 class="modal-title">${title}</h2>
    <div class="modal-actions">
      <button class="btn btn-rect" id="exportExcelBtn" style="margin-bottom:10px;">
          Выгрузить в Excel
      </button>
  </div>

      <table class="modal-table">
        <thead>
          <tr>
            <th data-sort="ШК">ШК <span class="sort-indicator"></span></th>
            <th data-sort="${field}">${field} <span class="sort-indicator"></span></th>
            ${isSMS ? '<th data-sort="Передача">Передача <span class="sort-indicator"></span></th>' : ''}
            <th data-sort="Наименование">Наименование <span class="sort-indicator"></span></th>
            <th data-sort="Стоимость">Цена <span class="sort-indicator"></span></th>

          </tr>
        </thead>


        <tbody>
          ${sorted.map(r => `
            <tr>
              <td>${r['ШК']}</td>
              <td>${r[field] || '—'}</td>
              ${isSMS ? `<td>${r['Передача'] || '—'}</td>` : ''}
              <td class="modal-name">${r['Наименование']}</td>
              <td>${format(r['Стоимость'])}</td>
            </tr>
          `).join('')}
        </tbody>

      </table>
    `;
    let sortDir = 1;

    modalBody.querySelectorAll('th[data-sort]').forEach(th => {
        th.onclick = () => {
            const key = th.dataset.sort;

            if (currentSort.key === key) {
                currentSort.dir *= -1;
            } else {
                currentSort.key = key;
                currentSort.dir = 1;
            }

            currentModalItems.sort((a, b) => {
                const va = a[key] ?? '';
                const vb = b[key] ?? '';

                if (typeof va === 'number' && typeof vb === 'number') {
                    return (va - vb) * currentSort.dir;
                }

                return va.toString().localeCompare(vb.toString(), 'ru') * currentSort.dir;
            });

            // 🔹 перерисовываем tbody
            modalBody.querySelector('tbody').innerHTML =
                renderModalTableBody(currentModalItems, field, isSMS);

            // 🔹 обновляем стрелки
            modalBody.querySelectorAll('.sort-indicator').forEach(el => el.textContent = '');

            const indicator = th.querySelector('.sort-indicator');
            indicator.textContent = currentSort.dir === 1 ? '▲' : '▼';
        };
    });



    document.getElementById('exportExcelBtn').onclick = () => {
        exportToExcel(items, title || 'Детализация');
    };
    modal.classList.remove('hidden');
}




function closeModal() {
    modal.classList.add('hidden');
}

modal.addEventListener('click', e => {
    if (e.target === modal || e.target.classList.contains('modal-backdrop')) {
        closeModal();
    }
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
});

/* ================= HELPERS ================= */

function groupBy(arr, key) {
    return arr.reduce((a, r) => {
        const k = r[key] || '—';
        a[k] ??= [];
        a[k].push(r);
        return a;
    }, {});
}

function sum(arr) {
    return arr.reduce((s, r) => s + Number(r['Стоимость'] || 0), 0);
}

function format(n) {
    return Math.trunc(n)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function blockColorByPercentile(value, allValues) {
    const sorted = [...allValues].sort((a,b) => a-b);
    const idx = sorted.findIndex(v => v >= value);
    const p = idx / sorted.length;

    if (p >= 0.9) return '#E15554';     // топ 10%
    if (p <= 0.5) return '#3BB273';     // нижние 50%
    return '#FFCC00';                   // середина
}

function exportToExcel(items, filename) {
    const worksheet = XLSX.utils.json_to_sheet(items);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Данные');
    XLSX.writeFile(workbook, `${filename}.xlsx`);
}

function buildExportFilename() {
    const statuses = [...activeStatuses].join('_') || 'Все_статусы';
    const expensive = expensiveOnly ? '_дорогостой' : '';
    const date = new Date().toISOString().slice(0,10);

    return `ШК_${statuses}${expensive}_${date}`;
}


function calcStatusStats(data) {
    const costs = data.map(r => Number(r['Стоимость'] || 0)).sort((a,b)=>a-b);

    const expensive = data.filter(r => Number(r['Стоимость']) >= 3000);

    const grids = groupBy(data, 'Гофра');
    const staff = groupBy(data, 'ID Ответственного');

    return {
        totalCount: data.length,
        totalSum: sum(data),
        expensiveCount: expensive.length,
        expensiveSum: sum(expensive),
        massGrids: Object.values(grids).filter(v => v.length >= 5).length,
        massStaff: Object.values(staff).filter(v => v.length >= 5).length,
        median: costs.length
            ? costs[Math.floor(costs.length / 2)]
            : 0
    };
}


function createCategoryWrapper(code, stats) {
    const box = document.createElement('section');
    box.className = 'status-box';

    box.innerHTML = `
        <div class="status-header">
            <div class="status-side clickable" data-type="all">
                <div class="status-big">${stats.totalCount}</div>
                <div class="status-label">ШК</div>
            </div>


            <div class="status-center">
                <div class="status-code clickable-status" data-status="${code}">
                    ${code}
                </div>

                <div class="status-desc">${STATUS_DESCRIPTIONS[code] || '—'}</div>
            </div>

            <div class="status-side">
                <div class="status-big">₽ ${format(stats.totalSum)}</div>
                <div class="status-label">Сумма</div>
            </div>
        </div>

        <div class="status-metrics">

    <div class="metric clickable" data-type="expensive">
        <div class="metric-value">${stats.expensiveCount}</div>
        <div class="metric-label">Дорогостой ШК</div>
    </div>

    <div class="metric">
        <div class="metric-value">₽ ${format(stats.expensiveSum)}</div>
        <div class="metric-label">Сумма дорогостоя</div>
    </div>

    <div class="metric">
        <div class="metric-value">${stats.massGrids}</div>
        <div class="metric-label">Массовые сетки</div>
    </div>

    <div class="metric">
        <div class="metric-value">${stats.massStaff}</div>
        <div class="metric-label">Массовые сотрудники</div>
    </div>

    <div class="metric">
        <div class="metric-value">₽ ${format(stats.median)}</div>
        <div class="metric-label">Медиана</div>
    </div>
</div>


        <div class="status-content"></div>
    `;

    return box;
}

function renderModalTableBody(items, field, isSMS) {
    return items.map(r => `
        <tr>
          <td>${r['ШК']}</td>
          <td>${r[field] || '—'}</td>
          ${isSMS ? `<td>${r['Передача'] || '—'}</td>` : ''}
          <td class="modal-name">${r['Наименование']}</td>
          <td>${format(r['Стоимость'])}</td>
        </tr>
    `).join('');
}
