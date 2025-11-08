// shk_generator.js
// Порт алгоритма Verhoeff + ShkWithCheckSumV1 из Python в JS (1:1 логика)
// Минимальный UI: ввод числа -> генерируем строку ШК -> показываем строку и QR

(function(){
  // проверка доступа/авторизации (как в constructor.js)
  const logged = localStorage.getItem('user');
  if(!logged){
    window.location.href = 'login.html';
    return;
  }

  // --- Verhoeff / ShkWithCheckSumV1 port ---
  const VerhoeffJS = (function(){
    const char_list = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const light_prefix = "*";
    const check_sum_first_size = 4;
    const check_sum_second_size = 4;
    // tables from python
    const d = [
      [0,1,2,3,4,5,6,7,8,9],
      [1,2,3,4,0,6,7,8,9,5],
      [2,3,4,0,1,7,8,9,5,6],
      [3,4,0,1,2,8,9,5,6,7],
      [4,0,1,2,3,9,5,6,7,8],
      [5,9,8,7,6,0,4,3,2,1],
      [6,5,9,8,7,1,0,4,3,2],
      [7,6,5,9,8,2,1,0,4,3],
      [8,7,6,5,9,3,2,1,0,4],
      [9,8,7,6,5,4,3,2,1,0]
    ];
    const p = [
      [0,1,2,3,4,5,6,7,8,9],
      [1,5,7,6,2,8,3,0,9,4],
      [5,8,0,3,7,9,6,1,4,2],
      [8,9,1,6,0,4,3,5,2,7],
      [9,4,5,3,1,2,6,8,7,0],
      [4,2,8,6,5,7,3,9,0,1],
      [2,7,9,3,8,0,6,4,1,5],
      [7,0,4,6,9,1,3,2,5,8]
    ];
    const inv = [0,4,3,2,1,5,6,7,8,9];

    function common_encode(j){
      if(!Number.isFinite(j)) j = Number(j) || 0;
      if(j === 0) return light_prefix; // but python appends light_prefix at end after building string; handle below
      let sb = [];
      const base = char_list.length;
      while(j !== 0){
        const idx = j % base;
        sb.push(char_list.charAt(idx));
        j = Math.floor(j / base);
      }
      sb.push(light_prefix);
      return sb.reverse().join('');
    }

    function generate_verhoeff_shk_checksums_common(j){
      // mirrors Python implementation
      let split_count = String(j).length/2 | 0;
      if(String(j).length % 2 !== 0) split_count = Math.floor(String(j).length/2) + 1;
      const array_list = [];
      let i = 0;
      let b = 0;
      let tmp = j;
      while(tmp > 0){
        if(i === split_count){
          array_list.push(inv[b]);
          i = 0;
          b = 0;
        }
        const i2 = tmp % 10;
        tmp = Math.floor(tmp / 10);
        i += 1;
        b = d[b][ p[i % 8][i2] ];
      }
      array_list.push(inv[b]);
      return array_list;
    }

    function generate_light_shk_package(j){
      const checksums = generate_verhoeff_shk_checksums_common(j);
      let j_byte_value = checksums[0] || 0;
      if(checksums.length === 2){
        j_byte_value |= (checksums[1] << check_sum_first_size);
      }
      // shift j left by total checksum bits
      const totalShift = check_sum_first_size + check_sum_second_size;
      // Use Number (safe for these bit sizes)
      return (j * Math.pow(2, totalShift)) | j_byte_value;
    }

    function encode_shk_light(j){
      if(j < 0) j = 0;
      const pkg = generate_light_shk_package(j);
      return common_encode(pkg);
    }

    function common_decode_v2(barcode){
      if(!barcode || barcode.charAt(0) !== light_prefix) return null;
      let body = barcode.slice(1);
      // decode base |char_list|
      let result = 0;
      const base = char_list.length;
      // process reversed: least significant char is last in string, but python reverses
      for(let i=0; i<body.length; i++){
        const ch = body.charAt(body.length - 1 - i);
        const idx = char_list.indexOf(ch);
        if(idx === -1) return null;
        result += idx * Math.pow(base, i);
      }
      return result;
    }

    function validate_verhoeff_for_two_checksum(shk_val, chk_sum, chk_sum2){
      // Transliterate python loop carefully
      const s = String(shk_val);
      const len = s.length;
      const split_count = Math.floor(len/2) + (len % 2 !== 0 ? 1 : 0);

      // build digits array from digits of shk_val
      const digits = Array.from(String(shk_val)).map(ch => Number(ch));
      let b = 0;
      let i = 0;

      for(let idx=0; idx<digits.length; idx++){
        const digit = digits[idx];
        if(i === split_count){
          if(inv[b] !== 0) return false;
          b = 0;
          i = 0;
          b = d[b][ p[i % 8][chk_sum2] ];
          i += 1;
        }
        b = d[b][ p[i % 8][digit] ];
        i += 1;
      }

      if(i === split_count){
        if(inv[b] !== 0) return false;
        b = 0;
        i = 0;
        b = d[b][ p[i % 8][chk_sum2] ];
        i += 1;
      }

      b = d[b][ p[i % 8][chk_sum] ];
      return inv[b] === 0;
    }

    return {
      encode_shk_light,
      common_decode_v2,
      validate_verhoeff_for_two_checksum,
      check_sum_first_size,
      check_sum_second_size,
      light_prefix,
      SHK_VALUE_SIZE: 42
    };
  })();

  // ShkWithCheckSumV1 port
  function ShkWithCheckSumV1JS(){
    const CHECK_SUM_FIRST_SIZE = 4;
    const CHECK_SUM_SECOND_SIZE = 4;
    const PREFIX = '*';
    const SHK_VALUE_SIZE = 42;

    function fix_russian_layout(barcode){
      // basic transliteration: keep as in Python version (best-effort)
      // We'll just replace common RU->EN letters that confuse keyboard layout (minimal).
      const rus = 'ёйцукенгшщзхъфывапролджэячсмитьбю';
      const eng = '`qwertyuiop[]asdfghjkl;\'zxcvbnm,./';
      let map = {};
      for(let i=0;i<rus.length;i++){ map[rus[i]] = eng[i]; map[rus[i].toUpperCase()] = eng[i].toUpperCase(); }
      let out = '';
      for(const ch of barcode){
        out += (map[ch] !== undefined) ? map[ch] : ch;
      }
      return out;
    }

    function get_bits_from_end(decoded, count_of_bits){
      return decoded & ((1 << count_of_bits) - 1);
    }

    function is_shk_valid(shk_val, chk_sum, chk_sum2){
      return VerhoeffJS.validate_verhoeff_for_two_checksum(shk_val, chk_sum, chk_sum2);
    }

    function try_parse(barcode, allow_invalid_checksum = true){
      if(!barcode) return null;
      barcode = barcode.trim();
      barcode = fix_russian_layout(barcode);

      if(barcode.length === 0 || barcode.charAt(0) !== PREFIX) return null;

      try {
        const decoded = VerhoeffJS.common_decode_v2(barcode);
        if(decoded === null || decoded === undefined) return null;

        const chk_sum = get_bits_from_end(decoded, CHECK_SUM_FIRST_SIZE);
        const chk_sum2 = get_bits_from_end(decoded >> CHECK_SUM_FIRST_SIZE, CHECK_SUM_SECOND_SIZE);
        const shk_val = get_bits_from_end(decoded >> (CHECK_SUM_FIRST_SIZE + CHECK_SUM_SECOND_SIZE), SHK_VALUE_SIZE);
        const remaining = decoded >> (CHECK_SUM_FIRST_SIZE + CHECK_SUM_SECOND_SIZE + SHK_VALUE_SIZE);

        if(remaining !== 0) return null;

        if(!is_shk_valid(shk_val, chk_sum, chk_sum2)){
          if(!allow_invalid_checksum) return null;
        }

        if(shk_val === 0){
          // Python raises ValueError here; we return null
          return null;
        }

        return { prefix: PREFIX, value: shk_val, barcode: barcode };
      } catch(e){
        return null;
      }
    }

    return { try_parse };
  }

  // --- UI logic ---
  const input = document.getElementById('shk-input');
  const generateBtn = document.getElementById('generate-btn');
  const resultTextEl = document.getElementById('result-text');
  const qrCanvas = document.getElementById('qr-canvas');
  const copyBtn = document.getElementById('copy-btn');
  const saveBtn = document.getElementById('save-btn');

  const decoder = ShkWithCheckSumV1JS();

  // allow only digits in input (visual)
  input.addEventListener('input', (e) => {
    input.value = input.value.replace(/[^\d]/g, '');
  });

  async function generateAndShow(){
    const v = input.value.trim();
    if(!v){
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Введите число', {type:'info'});
      return;
    }
    if(!/^\d+$/.test(v)){
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Только цифры', {type:'error'});
      return;
    }
    const num = Number(v);
    if(!Number.isFinite(num) || num < 0){
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Число вне диапазона', {type:'error'});
      return;
    }

    try {
      const barcode = VerhoeffJS.encode_shk_light(num);
      const parsed = decoder.try_parse(barcode, true);

      let display = '';
      if(parsed && parsed.barcode){
        display = parsed.barcode;
      } else {
        display = String(barcode);
      }

      resultTextEl.textContent = display;

      // QR: use qrcode lib if loaded
      if(window.QRCode && typeof QRCode.toCanvas === 'function'){
        // QRCode.toCanvas(canvas, text, options, cb)
        try {
          await QRCode.toCanvas(qrCanvas, display, { width: 150, margin: 1 });
        } catch(e){
          // fallback clear
          try { const ctx = qrCanvas.getContext('2d'); ctx.clearRect(0,0,qrCanvas.width,qrCanvas.height); } catch(e){}
        }
      } else {
        // clear canvas if lib not ready
        try { const ctx = qrCanvas.getContext('2d'); ctx.clearRect(0,0,qrCanvas.width,qrCanvas.height); } catch(e){}
      }

      copyBtn.style.display = 'inline-flex';
      saveBtn.style.display = 'inline-flex';
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Сгенерировано', {type:'success'});
      input.value = '';
    } catch(err){
      console.error(err);
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Ошибка генерации', {type:'error'});
    }
  }

  generateBtn.addEventListener('click', generateAndShow);
  input.addEventListener('keydown', (ev) => {
    if(ev.key === 'Enter') generateAndShow();
  });

  copyBtn.addEventListener('click', async () => {
    const txt = resultTextEl.textContent || '';
    if(!txt) return;
    try {
      await navigator.clipboard.writeText(txt);
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Скопировано в буфер', {type:'success'});
    } catch(e){
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Ошибка копирования', {type:'error'});
    }
  });

  saveBtn.addEventListener('click', () => {
    // save canvas as png if QR present
    try {
      const dataUrl = qrCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'shk_qr.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Сохранено', {type:'success'});
    } catch(e){
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Ошибка сохранения', {type:'error'});
    }
  });

  // fill small user name (if any)
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const nameEl = document.getElementById('user-name-small');
    if(nameEl && user.name) nameEl.textContent = user.name;
  } catch(e){}

})();
