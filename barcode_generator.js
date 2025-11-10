(function () {
  // prefix mapping (фиксированно)
  const PREFIXES = {
    'SQUA': 'SQUA',
    'PLCE': 'PLCE',
    'WCT' : 'WCT',
    'WHPT': 'WHPT',
    'TRBX': 'TRBX'
  };

  // элементы
  const input = document.getElementById('barcode-input');
  const typeSelect = document.getElementById('barcode-type');
  const resultTextEl = document.getElementById('result-text');
  const qrCanvas = document.getElementById('qr-canvas');
  const copyBtn = document.getElementById('copy-btn');
  const saveBtn = document.getElementById('save-btn');
  const printBtn = document.getElementById('print-btn');

  // Access control: if no user or no required access => redirect to index + toast
  function checkPageAccess() {
    try {
      const meta = document.querySelector('meta[name="required-access"]');
      const required = meta ? meta.content : null;
      const raw = localStorage.getItem('user');
      if (!raw) {
        // no auth at all
        // let ui.js handle redirect earlier, but double-check
        window.location.href = 'login.html';
        return false;
      }
      const user = JSON.parse(raw);
      const accesses = Array.isArray(user.accesses) ? user.accesses : (user.accesses ? [user.accesses] : []);
      // normalize
      const normalized = accesses.map(a => String(a).trim());
      if (!required) return true;
      if (normalized.includes('all') || normalized.includes(required)) {
        return true;
      } else {
        // show toast if possible then redirect
        if (window.MiniUI && window.MiniUI.toast) {
          window.MiniUI.toast('У вас нет доступа к этой странице. Перенаправление...', {type:'error', duration:2500});
        } else {
          // fallback
          alert('У вас нет доступа к этой странице.');
        }
        setTimeout(() => window.location.href = 'index.html', 600);
        return false;
      }
    } catch (e) {
      console.error('checkPageAccess error', e);
      return false;
    }
  }

  // write user name small if present
  function renderUserNameSmall() {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const nameEl = document.getElementById('user-name-small');
      if (nameEl && user && user.name) nameEl.textContent = user.name;
    } catch (e) {}
  }

  // sanitize input: keep only digits
  function sanitizeDigits(value) {
    return (value || '').toString().replace(/\D+/g, '');
  }

  // build result string
  function buildResult() {
    const digits = sanitizeDigits(input.value);
    const prefix = PREFIXES[typeSelect.value] || '';
    return prefix + digits;
  }

  // UI update: result text + QR + buttons visibility
  async function updateUI() {
    const digits = sanitizeDigits(input.value);
    const prefix = PREFIXES[typeSelect.value] || '';
    const result = prefix + digits;
    resultTextEl.textContent = result;

    const valid = digits.length > 0;
    // show/hide buttons
    if (valid) {
      copyBtn.style.display = '';
      saveBtn.style.display = '';
      printBtn.style.display = '';
    } else {
      copyBtn.style.display = 'none';
      saveBtn.style.display = 'none';
      printBtn.style.display = 'none';
    }

    // draw QR (use qrcode library if available)
    // if result is empty -> clear canvas
    if (!result) {
      const ctx = qrCanvas.getContext('2d');
      ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
      return;
    }

    try {
      if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
        // default options: fit canvas size
        await window.QRCode.toCanvas(qrCanvas, result, {
          errorCorrectionLevel: 'M',
          width: qrCanvas.width,
          margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' }
        });
      } else if (window.qrcode && typeof window.qrcode.toCanvas === 'function') {
        // alternative build
        await window.qrcode.toCanvas(qrCanvas, result, { width: qrCanvas.width, margin: 1 });
      } else {
        // fallback: draw text
        const ctx = qrCanvas.getContext('2d');
        ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
        ctx.fillStyle = '#000';
        ctx.font = '12px sans-serif';
        ctx.fillText(result, 6, 20);
      }
    } catch (err) {
      console.error('QR render error', err);
      // clear canvas on error
      const ctx = qrCanvas.getContext('2d');
      ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
    }
  }

  // copy result to clipboard
  async function copyResult() {
    try {
      const text = resultTextEl.textContent || '';
      if (!text) return;
      await navigator.clipboard.writeText(text);
      if (window.MiniUI && window.MiniUI.toast) window.MiniUI.toast('Скопировано в буфер обмена', {type:'success'});
    } catch (e) {
      console.error('copy error', e);
      if (window.MiniUI && window.MiniUI.toast) window.MiniUI.toast('Ошибка копирования', {type:'error'});
    }
  }

  // save QR as PNG
  function savePng() {
    try {
      // get dataURL from canvas
      const dataUrl = qrCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `barcode_${ts}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (window.MiniUI && window.MiniUI.toast) window.MiniUI.toast('PNG сохранён', {type:'success'});
    } catch (e) {
      console.error('save png error', e);
      if (window.MiniUI && window.MiniUI.toast) window.MiniUI.toast('Ошибка сохранения', {type:'error'});
    }
  }

  // print only QR (P2): open minimal window with image and call print()
    // print only QR (P2)
  function printQrOnly() {
    try {
      const dataUrl = qrCanvas.toDataURL('image/png');

      w.document.write(`
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8"/>
          <title>Печать QR</title>
          <style>
            body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:white;}
            img{max-width:100%;max-height:100%;display:block;}
          </style>
        </head>
        <body>
          <img src="${dataUrl}" alt="QR">
          <script>
            window.onload = function(){ 
              setTimeout(()=>{ 
                window.print(); 
                setTimeout(()=>window.close(), 120); 
              }, 150); 
            };
          </script>
        </body>
        </html>
      `);
      
      // открываем окно уже с html skeleton — иначе chrome блокирует
      const w = window.open('about:blank', '_blank');
      if (!w) {
        if (window.MiniUI && window.MiniUI.toast) window.MiniUI.toast('Блокировщик окон мешает печати', {type:'error'});
        return;
      }
      
    } catch (e) {
      console.error('print error', e);
      if (window.MiniUI && window.MiniUI.toast) window.MiniUI.toast('Ошибка печати', {type:'error'});
    }
  }


  // event bindings
  function bindEvents() {
    // input: sanitize and update immediately
    input.addEventListener('input', (ev) => {
      const sanitized = sanitizeDigits(input.value);
      if (input.value !== sanitized) {
        const pos = input.selectionStart || 0;
        input.value = sanitized;
        // try restore caret
        input.setSelectionRange(pos, pos);
      }
      updateUI();
    });

    // allow paste but sanitize
    input.addEventListener('paste', (ev) => {
      ev.preventDefault();
      const text = (ev.clipboardData || window.clipboardData).getData('text') || '';
      const sanitized = sanitizeDigits(text);
      // insert at caret
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const val = input.value;
      const newVal = val.slice(0, start) + sanitized + val.slice(end);
      input.value = sanitizeDigits(newVal);
      const caret = start + sanitized.length;
      input.setSelectionRange(caret, caret);
      updateUI();
    });

    // select change
    typeSelect.addEventListener('change', updateUI);

    copyBtn.addEventListener('click', copyResult);
    saveBtn.addEventListener('click', savePng);
    printBtn.addEventListener('click', printQrOnly);

    // keyboard: enter shouldn't reload page
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
      }
    });
  }

  // initial setup
  document.addEventListener('DOMContentLoaded', () => {
    // render user name
    renderUserNameSmall();

    // access control
    const ok = checkPageAccess();
    if (!ok) return;

    // initial empty UI
    updateUI();
    bindEvents();
  });

})();
