// barcode_generator.js
// Вариант 1: простой prefix + digits; рендер QR; кнопки: сохранить/копировать/печать
// Использует qrious (подключается в HTML). Также доверяет ui.js для тостов (window.MiniUI.toast).

(function(){
  // --- доступность страницы: читаем meta required-access ---
  const meta = document.querySelector('meta[name="required-access"]');
  const requiredAccess = meta ? meta.getAttribute('content') : null;

  // Проверка авторизации/доступа (локально)
  function ensureAccessOrRedirect(){
    const raw = localStorage.getItem('user');
    if(!raw){
      // неавторизован
      window.location.href = 'login.html';
      return false;
    }
    try {
      const user = JSON.parse(raw);
      const accesses = Array.isArray(user.accesses) ? user.accesses : (user.accesses ? [user.accesses] : []);
      if(!requiredAccess) return true; // если мета нет — пропускаем
      if(accesses.includes('all') || accesses.includes(requiredAccess)){
        return true;
      } else {
        // нет доступа — редирект на index и тост
        // ждем пока ui.js загрузится и создаст createToast / MiniUI
        setTimeout(() => {
          if(window.MiniUI && window.MiniUI.toast){
            window.MiniUI.toast('Нет доступа к этой странице', {type:'error', duration:3500});
          } else {
            // fallback: alert
            console.warn('Нет доступа к странице: ', requiredAccess);
          }
        }, 120);
        window.location.href = 'index.html';
        return false;
      }
    } catch(e){
      window.location.href = 'login.html';
      return false;
    }
  }

  if(!ensureAccessOrRedirect()) return;

  // DOM elements
  const prefixSelect = document.getElementById('prefix-select');
  const digitsInput = document.getElementById('digits-input');
  const resultDisplay = document.getElementById('result-display');
  const qrCanvas = document.getElementById('qr-canvas');
  const saveBtn = document.getElementById('save-btn');
  const copyBtn = document.getElementById('copy-btn');
  const printBtn = document.getElementById('print-btn');

  // QR generator object (qrious)
  let qr = null;
  if(window.QRious){
    qr = new QRious({element: qrCanvas, size: 160, value: '', level: 'M'});
  } else {
    console.error('QRious not found. QR will not be generated.');
  }

  function onlyDigits(str){
    return (str || '').replace(/\D+/g, '');
  }

  // Update result and QR
  function updateAll(){
    const digits = onlyDigits(digitsInput.value || '');
    const prefix = prefixSelect.value || '';
    const result = prefix + (digits || '');

    resultDisplay.textContent = result;

    const enabled = digits.length > 0;
    toggleButtons(enabled);

    if(qr){
      qr.value = enabled ? result : '';
    }
  }

  function toggleButtons(enabled){
    if(enabled){
      saveBtn.removeAttribute('disabled'); saveBtn.setAttribute('aria-disabled','false');
      copyBtn.removeAttribute('disabled'); copyBtn.setAttribute('aria-disabled','false');
      printBtn.removeAttribute('disabled'); printBtn.setAttribute('aria-disabled','false');
    } else {
      saveBtn.setAttribute('disabled','true'); saveBtn.setAttribute('aria-disabled','true');
      copyBtn.setAttribute('disabled','true'); copyBtn.setAttribute('aria-disabled','true');
      printBtn.setAttribute('disabled','true'); printBtn.setAttribute('aria-disabled','true');
    }
  }

  // Events
  digitsInput.addEventListener('input', (e) => {
    // Keep only digits in the input UI
    const cleaned = onlyDigits(e.target.value);
    if(cleaned !== e.target.value){
      const pos = e.target.selectionStart - (e.target.value.length - cleaned.length);
      e.target.value = cleaned;
      e.target.setSelectionRange(pos, pos);
    }
    updateAll();
  });

  prefixSelect.addEventListener('change', updateAll);

  // copy result (string)
  copyBtn.addEventListener('click', async () => {
    const text = resultDisplay.textContent || '';
    if(!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if(window.MiniUI && window.MiniUI.toast) window.MiniUI.toast('Скопировано в буфер обмена', {type:'success'});
    } catch(e){
      if(window.MiniUI && window.MiniUI.toast) window.MiniUI.toast('Ошибка копирования', {type:'error'});
    }
  });

  // save PNG (download QR)
  saveBtn.addEventListener('click', () => {
    if(!qrCanvas) return;
    const text = resultDisplay.textContent || '';
    if(!text) return;
    try {
      const dataURL = qrCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = `${text}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if(window.MiniUI && window.MiniUI.toast) window.MiniUI.toast('PNG сохранён', {type:'success'});
    } catch(e){
      if(window.MiniUI && window.MiniUI.toast) window.MiniUI.toast('Ошибка сохранения', {type:'error'});
    }
  });

  // print QR (open new window with image)
  printBtn.addEventListener('click', () => {
    const text = resultDisplay.textContent || '';
    if(!text) return;
    try {
      const dataURL = qrCanvas.toDataURL('image/png');
      const w = window.open('', '_blank', 'noopener');
      if(!w) {
        if(window.MiniUI && window.MiniUI.toast) window.MiniUI.toast('Поп-ап заблокирован', {type:'error'});
        return;
      }
      w.document.write(`<html><head><title>Печать — ${text}</title><style>body{margin:0;display:flex;height:100vh;align-items:center;justify-content:center;}img{max-width:100%;height:auto;}</style></head><body><img src="${dataURL}" alt="${text}"><script>window.onload=function(){setTimeout(()=>{window.print();},200);};</script></body></html>`);
      w.document.close();
    } catch(e){
      if(window.MiniUI && window.MiniUI.toast) window.MiniUI.toast('Ошибка печати', {type:'error'});
    }
  });

  // Initial: set name in header if present, and initial update
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const nameEl = document.getElementById('user-name-small');
    if(nameEl && user.name) nameEl.textContent = user.name;
  } catch(e){/* ignore */}

  // initialize state
  updateAll();

  // accessibility: Enter on digits input triggers nothing special (instant update), but we can focus copy
  digitsInput.addEventListener('keydown', (ev) => {
    if(ev.key === 'Enter'){
      const txt = resultDisplay.textContent || '';
      if(txt) {
        // try to copy and show toast
        navigator.clipboard.writeText(txt).then(()=> {
          if(window.MiniUI && window.MiniUI.toast) window.MiniUI.toast('Скопировано в буфер обмена', {type:'success'});
        }).catch(()=>{});
      }
    }
  });

})();
