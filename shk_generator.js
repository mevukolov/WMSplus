// shk_generator.js (исправленная версия — BigInt, валидация диапазона 42 бит)
(function(){
  // проверка доступа/авторизации (как в constructor.js)
  const logged = localStorage.getItem('user');
  if(!logged){
    window.location.href = 'login.html';
    return;
  }

  // --- Verhoeff / ShkWithCheckSumV1 port (BigInt-safe) ---
  const VerhoeffJS = (function(){
    const char_list = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const light_prefix = "*";
    const check_sum_first_size = 4;
    const check_sum_second_size = 4;

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

    // common_encode: принимает BigInt (или Number), возвращает строку с префиксом '*'
    function common_encode(j){
      let n = (typeof j === 'bigint') ? j : BigInt(j);
      const base = BigInt(char_list.length);
      if(n === 0n){
        return light_prefix;
      }
      const sb = [];
      while(n > 0n){
        const idx = Number(n % base); // safe: idx in [0, base-1] small
        sb.push(char_list.charAt(idx));
        n = n / base;
      }
      sb.push(light_prefix);
      return sb.reverse().join('');
    }

    // generate_verhoeff_shk_checksums_common: использует BigInt операции, 
    // но считает цифры decimal, поэтому проще работать со строкой
    function generate_verhoeff_shk_checksums_common(j){
      // j может быть Number или BigInt
      const s = String(j);
      const len = s.length;
      const split_count = Math.floor(len/2) + (len % 2 !== 0 ? 1 : 0);

      const array_list = [];
      let i = 0;
      let b = 0;
      // обходим цифры с конца (как в Python: while j>0 ... j//=10)
      // проще пройти по строк справа налево
      for(let k = s.length - 1; k >= 0; k--){
        if(i === split_count){
          array_list.push(inv[b]);
          i = 0;
          b = 0;
        }
        const i2 = Number(s[k]);
        i += 1;
        b = d[b][ p[i % 8][i2] ];
      }
      array_list.push(inv[b]);
      return array_list;
    }

    function generate_light_shk_package(j){
      // j may be BigInt/Number; compute using BigInt shifts
      const checksums = generate_verhoeff_shk_checksums_common(j);
      let j_byte_value = BigInt(checksums[0] || 0);
      if(checksums.length === 2){
        j_byte_value = j_byte_value | (BigInt(checksums[1]) << BigInt(check_sum_first_size));
      }
      const jBig = (typeof j === 'bigint') ? j : BigInt(j);
      const totalShift = BigInt(check_sum_first_size + check_sum_second_size);
      return (jBig << totalShift) | j_byte_value; // BigInt
    }

    function encode_shk_light(j){
      let n = (typeof j === 'bigint') ? j : BigInt(j);
      if(n < 0n) n = 0n;
      const pkg = generate_light_shk_package(n);
      return common_encode(pkg);
    }

    function common_decode_v2(barcode){
      if(!barcode || barcode.charAt(0) !== light_prefix) return null;
      const body = barcode.slice(1);
      const base = BigInt(char_list.length);
      let result = 0n;
      for(let i = 0; i < body.length; i++){
        const ch = body.charAt(body.length - 1 - i); // reversed
        const idx = BigInt(char_list.indexOf(ch));
        if(idx < 0) return null;
        result += idx * (base ** BigInt(i));
      }
      return result;
    }

    function validate_verhoeff_for_two_checksum(shk_val, chk_sum, chk_sum2){
      // shk_val might be BigInt or Number; easier to work with its decimal string
      const s = String(shk_val);
      const len = s.length;
      const split_count = Math.floor(len/2) + (len % 2 !== 0 ? 1 : 0);
      const digits = Array.from(s).map(ch => Number(ch));

      let b = 0;
      let i = 0;
      for(let idx = 0; idx < digits.length; idx++){
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

  // ShkWithCheckSumV1 port (BigInt-aware)
  function ShkWithCheckSumV1JS(){
    const CHECK_SUM_FIRST_SIZE = 4;
    const CHECK_SUM_SECOND_SIZE = 4;
    const PREFIX = '*';
    const SHK_VALUE_SIZE = 42;

    function fix_russian_layout(barcode){
      const rus = 'ёйцукенгшщзхъфывапролджэячсмитьбю';
      const eng = '`qwertyuiop[]asdfghjkl;\'zxcvbnm,./';
      const map = {};
      for(let i=0;i<rus.length;i++){ map[rus[i]] = eng[i]; map[rus[i].toUpperCase()] = eng[i].toUpperCase(); }
      let out = '';
      for(const ch of barcode){
        out += (map[ch] !== undefined) ? map[ch] : ch;
      }
      return out;
    }

    function get_bits_from_end(decodedBigInt, count_of_bits){
      const mask = (1n << BigInt(count_of_bits)) - 1n;
      return Number(decodedBigInt & mask); // small number fits Number
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
        const chk_sum2 = get_bits_from_end(decoded >> BigInt(CHECK_SUM_FIRST_SIZE), CHECK_SUM_SECOND_SIZE);
        const shk_val = Number((decoded >> BigInt(CHECK_SUM_FIRST_SIZE + CHECK_SUM_SECOND_SIZE)) & ((1n << BigInt(SHK_VALUE_SIZE)) - 1n));
        const remaining = decoded >> BigInt(CHECK_SUM_FIRST_SIZE + CHECK_SUM_SECOND_SIZE + SHK_VALUE_SIZE);

        if(remaining !== 0n) return null;

        if(!is_shk_valid(shk_val, chk_sum, chk_sum2)){
          if(!allow_invalid_checksum) return null;
        }

        if(shk_val === 0) {
          // Python raised ValueError; here return null
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

  // SHK max according to SHK_VALUE_SIZE bits
  const MAX_SHK = (1n << 42n) - 1n; // 2^42 - 1 = 4398046511103

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

    // check range <= MAX_SHK
    let numBig = BigInt(v);
    if(numBig <= 0n){
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast('Число должно быть положительным', {type:'error'});
      return;
    }
    if(numBig > MAX_SHK){
      window.MiniUI && window.MiniUI.toast && window.MiniUI.toast(`Число должно быть меньше или равно ${String(MAX_SHK)}`, {type:'error', duration:6000});
      return;
    }

    try {
      const barcode = VerhoeffJS.encode_shk_light(numBig);
      const parsed = decoder.try_parse(barcode, true);

      let display = '';
      if(parsed && parsed.barcode){
        display = parsed.barcode;
      } else {
        display = String(barcode);
      }

      resultTextEl.textContent = display;

      // draw QR (qrcode lib)
      if(window.QRCode && typeof QRCode.toCanvas === 'function'){
        try {
          // set canvas size explicitly to avoid scaling artifacts
          const size = 150;
          qrCanvas.width = size;
          qrCanvas.height = size;
          await QRCode.toCanvas(qrCanvas, display, { width: size, margin: 1 });
        } catch(e){
          try { const ctx = qrCanvas.getContext('2d'); ctx.clearRect(0,0,qrCanvas.width,qrCanvas.height); } catch(e){}
        }
      } else {
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

