// constructor.js
// Подразумевается, что styles.css и ui.js уже подключены на странице.
// Также подключён SheetJS (xlsx.full.min.js).

(function(){
  // --- Защита: если нет авторизации, редиректим (как в ui.js) ---
  const logged = localStorage.getItem('user');
  if(!logged){
    window.location.href = 'login.html';
    return;
  }

  // Элементы
  const fileInput = document.getElementById('file-input');
  const dropArea = document.getElementById('drop-area');
  const reportGrid = document.getElementById('report-grid');
  const resultText = document.getElementById('result-text');
  const copyBtn = document.getElementById('copy-btn');
  const downloadBtn = document.getElementById('download-btn');
  const dropHint = document.getElementById('drop-hint');

  let allData = [];        // [{mx, transfers:[], shk_count, total_cost}]
  let selectedMx = new Set();
  let resultReady = false;

  // Helpers
  function setButtonsEnabled(enabled){
    copyBtn.toggleAttribute('disabled', !enabled);
    downloadBtn.toggleAttribute('disabled', !enabled);
    copyBtn.setAttribute('aria-disabled', String(!enabled));
    downloadBtn.setAttribute('aria-disabled', String(!enabled));
    if(enabled){
      copyBtn.classList.remove('btn-rect--inactive');
      downloadBtn.classList.remove('btn-rect--inactive');
    } else {
      // keep visual but we use default style
    }
  }

  // визуальный hover (css-in-js)
  function applyHoverEffect(el){
    el.addEventListener('mouseenter', () => {
      el.style.transform = 'translateY(-3px)';
      el.style.boxShadow = '0 8px 20px rgba(0,0,0,0.08)';
    });
    el.addEventListener('mouseleave', () => {
      el.style.transform = '';
      el.style.boxShadow = '';
    });
  }

  // parse files -> array of rows (objects)
  async function parseFiles(fileList){
    const files = Array.from(fileList);
    const rows = [];
    for(const f of files){
      try {
        const data = await f.arrayBuffer();
        const workbook = XLSX.read(data, {type:"array"});
        const sheetNames = workbook.SheetNames;
        sheetNames.forEach(name => {
          const ws = workbook.Sheets[name];
          const json = XLSX.utils.sheet_to_json(ws, {defval: ""});
          if(Array.isArray(json) && json.length) rows.push(...json);
        });
      } catch(err){
        console.error('Ошибка чтения файла', f.name, err);
      }
    }
    return rows;
  }

  function processRows(rows){
    // фильтруем по условиям: Статус ШК === 'SMS' и MX содержит 'Нижний Новгород_Буфер'
    const filtered = rows.filter(r => {
      const status = (r['Статус ШК'] || r['СтатусШК'] || r['status'] || '').toString();
      const mx = (r['MX'] || r['Mx'] || r['mx'] || '').toString();
      return status === 'SMS' && mx.includes('Нижний Новгород_Буфер');
    });

    if(filtered.length === 0){
      allData = [];
      selectedMx.clear();
      renderGrid();
      resultReady = false;
      setButtonsEnabled(false);
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Нет строк, соответствующих фильтру.', {type:'info'});
      return;
    }

    // Группировка по MX
    const groups = {};
    filtered.forEach(row => {
      const mx = String(row['MX'] || row['Mx'] || row['mx'] || '').trim();
      if(!groups[mx]) groups[mx] = [];
      groups[mx].push(row);
    });

    const arr = Object.entries(groups).map(([mx, items]) => {
      const transfersCol = items.map(it => it['Передача'] || it['Передача'] === 0 ? it['Передача'] : (it['per'] || '')).filter(Boolean).map(String);
      const transfers = Array.from(new Set(transfersCol)).sort();
      const shk_count = items.length;
      const total_cost = items.reduce((s, it) => {
        const v = it['Стоимость'] ?? it['Cost'] ?? it['cost'] ?? 0;
        const num = (v === "" || v === null) ? 0 : Number(v);
        return s + (isNaN(num) ? 0 : num);
      }, 0);
      return { mx, transfers, shk_count, total_cost };
    });

    // сортируем по длине transfers (как в оригинале)
    arr.sort((a,b) => b.transfers.length - a.transfers.length);

    allData = arr;
    selectedMx.clear(); // по умолчанию ничего не выбрано
    resultReady = true;
    setButtonsEnabled(true);
    renderGrid();
    updateResultText();
  }

  function renderGrid(){
    reportGrid.innerHTML = '';

    // Общий блок сверху
    const total_shk = allData.reduce((s,d) => s + d.shk_count, 0);
    const total_sum = allData.reduce((s,d) => s + d.total_cost, 0);

    const totalBlock = document.createElement('div');
    totalBlock.className = 'buffer-block';
    totalBlock.innerHTML = `<div style="font-weight:700">Все парковки</div><div>ШК: ${total_shk}</div><div>Сумма: ${formatMoney(total_sum)} ₽</div>`;
    totalBlock.style.background = '#D0D0D0';
    totalBlock.style.border = '2px solid #000';
    totalBlock.style.cursor = 'pointer';
    totalBlock.addEventListener('click', () => {
      const allSet = new Set(allData.map(d => d.mx));
      const same = setsEqual(allSet, selectedMx);
      if(same) selectedMx.clear(); else selectedMx = allSet;
      renderGrid();
      updateResultText();
    });
    applyHoverEffect(totalBlock);
    reportGrid.appendChild(totalBlock);

    // Индивидуальные блоки
    const maxCost = Math.max(...allData.map(d => d.total_cost), 1);
    allData.forEach(d => {
      const block = document.createElement('div');
      const isSelected = selectedMx.has(d.mx);
      const intensity = Math.min(1, d.total_cost / (maxCost || 1));
      const r = Math.round(51 + (224 - 51) * intensity);
      const g = Math.round(196 + (111 - 196) * intensity);
      const b = Math.round(129 + (150 - 129) * intensity);
      const bg = `rgb(${r},${g},${b})`;

      block.className = 'buffer-block';
      block.style.background = bg;
      block.style.border = isSelected ? '2px solid #000' : '2px solid transparent';
      block.style.borderRadius = '10px';
      block.style.padding = '10px';
      block.style.cursor = 'pointer';
      block.innerHTML = `<div style="font-weight:700">${escapeHtml(d.mx)}</div>
                         <div>Передач: ${d.transfers.length}</div>
                         <div>ШК: ${d.shk_count}</div>
                         <div>Сумма: ${formatMoney(d.total_cost)} ₽</div>`;
      block.addEventListener('click', () => {
        if(selectedMx.has(d.mx)) selectedMx.delete(d.mx); else selectedMx.add(d.mx);
        renderGrid();
        updateResultText();
      });
      applyHoverEffect(block);
      reportGrid.appendChild(block);
    });
  }

  function updateResultText(){
    const lines = [];
    for(const d of allData){
      if(!selectedMx.has(d.mx)) continue;
      lines.push(d.mx);
      for(const t of d.transfers) lines.push(String(t));
      lines.push('');
    }
    const text = lines.join('\n').trim();
    resultText.value = text;
    resultReady = text.length > 0;
    setButtonsEnabled(resultReady);
  }

  function formatMoney(n){
    if(!Number.isFinite(n)) n = Number(n) || 0;
    const s = Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."); // thousands with dot
    return s;
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function setsEqual(a,b){
    if(a.size !== b.size) return false;
    for(const x of a) if(!b.has(x)) return false;
    return true;
  }

  // Copy & download
  copyBtn.addEventListener('click', async () => {
    if(!resultReady) return;
    try {
      await navigator.clipboard.writeText(resultText.value);
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Скопировано в буфер обмена', {type:'success'});
    } catch(e){
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Ошибка копирования', {type:'error'});
    }
  });

  downloadBtn.addEventListener('click', () => {
    if(!resultReady) return;
    const blob = new Blob([resultText.value], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Буфер.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Файл сохранён', {type:'success'});
  });

  // Drag & drop UI
  ;['dragenter','dragover'].forEach(ev => {
    dropArea.addEventListener(ev, function(e){
      e.preventDefault();
      dropArea.style.outline = '2px dashed var(--accent)';
    }, false);
  });
  ;['dragleave','drop'].forEach(ev => {
    dropArea.addEventListener(ev, function(e){
      e.preventDefault();
      dropArea.style.outline = '';
    }, false);
  });

  dropArea.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => /\.(xlsx|xls)$/i.test(f.name));
    if(files.length === 0){
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Нет файлов .xlsx', {type:'info'});
      return;
    }
    dropHint.textContent = `Загружаю ${files.length} файл(ов)...`;
    const rows = await parseFiles(files);
    processRows(rows);
    dropHint.textContent = 'или перетащите файлы сюда';
  });

  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).filter(f => /\.(xlsx|xls)$/i.test(f.name));
    if(files.length === 0) {
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Выберите .xlsx файлы', {type:'info'});
      return;
    }
    dropHint.textContent = `Загружаю ${files.length} файл(ов)...`;
    const rows = await parseFiles(files);
    processRows(rows);
    dropHint.textContent = 'или перетащите файлы сюда';
    fileInput.value = '';
  });

  // "Выбрать файлы" label
  document.getElementById('select-files-btn').addEventListener('click', () => fileInput.click());

  // init
  setButtonsEnabled(false);
  // если есть пользователь (из локалстор), отрисуем его имя (не трогаем логику доступа)
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const nameEl = document.getElementById('user-name-small');
    if(nameEl && user.name) nameEl.textContent = user.name;
  } catch(e){}

})();
