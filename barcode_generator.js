(async function () {

    // prefix mapping (фиксировано)
    const PREFIXES = {
        'BLNK': '',
        'SQUA': 'SQUA',
        'PLCE': 'PLCE',
        'WCT':  'WCT',
        'WHPT': 'WHPT',
        'TRBX': 'TRBX'
    };
    const RU_TO_EN = {
        'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p','х':'[','ъ':']',
        'ф':'a','ы':'s','в':'d','а':'f','п':'g','р':'h','о':'j','л':'k','д':'l','ж':';','э':'\'',
        'я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m','б':',','ю':'.',
    };

    function ruToEnLayout(str) {
        return str
            .toLowerCase()
            .split('')
            .map(ch => RU_TO_EN[ch] || ch)
            .join('');
    }


    // UI elements
    const input = document.getElementById('barcode-input');
    const typeSelect = document.getElementById('barcode-type');
    const resultTextEl = document.getElementById('result-text');
    const qrCanvas = document.getElementById('qr-canvas');
    const printBtn = document.getElementById('print-btn');

    const mhBlock = document.getElementById('mh-block');
    const mhNameEl = document.getElementById('mh-name');
    const generatorCard = document.getElementById('generator-card');

    let user = null;
    let userWhId = null;
    let selectedPlace = null;
    let activeScanModal = null;

    // ----- Access check -----
    function checkPageAccess() {
        try {
            const raw = localStorage.getItem('user');
            if (!raw) {
                window.location.href = 'login.html';
                return false;
            }
            user = JSON.parse(raw);
            userWhId = user.user_wh_id;

            const meta = document.querySelector('meta[name="required-access"]');
            const required = meta ? meta.content : null;

            const accesses = Array.isArray(user.accesses) ? user.accesses : (user.accesses ? [user.accesses] : []);
            const normalized = accesses.map(a => String(a).trim());

            if (!required) return true;
            if (normalized.includes('all') || normalized.includes(required)) return true;

            MiniUI.toast('Нет доступа', { type: 'error' });
            setTimeout(() => window.location.href = 'index.html', 800);
            return false;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    function renderUserNameSmall() {
        try {
            const nameEl = document.getElementById('user-name-small');
            if (nameEl && user?.name) nameEl.textContent = user.name;
        } catch {}
    }

    // ------------------------------------
    // СКАНИРОВАНИЕ МХ ПРИ ЗАПУСКЕ
    // ------------------------------------

    async function lookupPlace(sticker) {
        const trimmedSticker = sticker.toString().trim();
        console.log('Траблшут lookupPlace. Ищем sticker:', trimmedSticker);
        try {
            const { data, error } = await supabaseClient
                .from('places')
                .select('*')
                .eq('place_sticker', trimmedSticker)
                .maybeSingle();

            if (error) {
                console.error('Ошибка Supabase:', error);
                return null;
            }

            console.log('Результат lookupPlace:', data);
            return data;
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    async function handleScannedSticker(sticker) {
        if (!sticker) return;

            const fixedSticker = ruToEnLayout(sticker);

            const place = await lookupPlace(fixedSticker);
        if (!place) {
            console.error('МХ не найден для кода:', sticker);
            MiniUI.toast('МХ не найден', { type: 'error' });
            return;
        }

        console.log('Найден МХ:', place);

        if (String(place.wh_id) !== String(userWhId)) {
            console.warn('Склад не совпадает. place.wh_id:', place.wh_id, 'userWhId:', userWhId);
            MiniUI.toast('Этот МХ относится к другому складу', { type: 'error' });
            return;
        }

        // SUCCESS
        selectedPlace = place;

        if (activeScanModal) {
            activeScanModal.remove();
            activeScanModal = null;
        }
        // закрыть модалку
        mhBlock.style.display = ''; // показать блок МХ
        generatorCard.style.display = ''; // включить генератор

        mhNameEl.textContent = `${place.place_name} (${place.place})`;

        input.focus();
    }

    function startScanModal() {
        // Создаем модалку вручную
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';

        modal.innerHTML = `
        <div class="modal-content" style="width:360px;max-width:90%;padding:26px 28px 32px;box-sizing:border-box;">
            <div style="font-weight:600;margin-bottom:12px;">Отсканируйте МХ рядом</div>
            <input class="input" type="text" placeholder="Сканируйте или введите код">
            <div id="scan-feedback" style="margin-top:8px;font-size:14px;color:red;min-height:18px;"></div>
        </div>
    `;

        document.body.appendChild(modal);
        activeScanModal = modal;

        const inputEl = modal.querySelector('.input');

        // ✨ Единственная добавка → гарантирует автоматический фокус
        setTimeout(() => inputEl.focus(), 0);

        let buffer = '';
        inputEl.addEventListener('keydown', async (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                const code = buffer.trim();
                buffer = '';
                console.log('Введён код для сканирования:', code);

                if (code) await handleScannedSticker(code);
                inputEl.value = '';
                return;
            }
            if (ev.key.length === 1) buffer += ev.key;
        });
    }


    // ------------------------------------
    // Основной функционал генератора
    // ------------------------------------

    async function logBarcodeGeneration(shkValue) {
        try {
            const { error } = await supabaseClient
                .from('shk_rep')
                .insert({
                    shk: shkValue,
                    operation: 'Генерация баркода',
                    emp: user.id,
                    place: selectedPlace.place,
                    place_new: null,
                    date: new Date().toISOString()
                });

            if (error) {
                console.error('Ошибка записи в shk_rep:', error);
            }
        } catch (e) {
            console.error('Ошибка логирования генерации:', e);
        }
    }


    async function updateUI() {
        const value = input.value.trim();
        const prefix = PREFIXES[typeSelect.value] || '';
        const result = prefix + value;

        resultTextEl.textContent = result;
        if (result) {
            await logBarcodeGeneration(result);
        }
        const valid = result.length > 0;

        printBtn.style.display = valid ? '' : 'none';


        const ctx = qrCanvas.getContext('2d');

        if (!valid) {
            ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
            return;
        }

        try {
            await QRCode.toCanvas(qrCanvas, result, {
                errorCorrectionLevel: 'M',
                width: qrCanvas.width,
                margin: 1,
                color: { dark: '#000000', light: '#FFFFFF' }
            });
        } catch (e) {
            console.error(e);
            ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
        }
    }

    async function copyResult() {
        try {
            const text = resultTextEl.textContent;
            if (!text) return;
            await navigator.clipboard.writeText(text);
            MiniUI.toast('Скопировано', { type: 'success' });
        } catch {
            MiniUI.toast('Ошибка копирования', { type: 'error' });
        }
    }

    function savePng() {
        try {
            const url = qrCanvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = url;
            a.download = `barcode_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            MiniUI.toast('PNG сохранён', { type: 'success' });
        } catch {
            MiniUI.toast('Ошибка сохранения', { type: 'error' });
        }
    }

    function printQrOnly() {
        try {
            const url = qrCanvas.toDataURL('image/png');

            const frame = document.createElement('iframe');
            frame.style.position = 'fixed';
            frame.style.right = '0';
            frame.style.bottom = '0';
            frame.style.width = '0';
            frame.style.height = '0';
            frame.style.border = '0';

            document.body.appendChild(frame);

            const doc = frame.contentWindow.document;
            doc.open();
            doc.write(`
            <html>
            <head>
                <style>
                    body {
                        margin: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                    }
                    img {
                        max-width: 100%;
                        max-height: 100%;
                    }
                </style>
            </head>
            <body>
                <img id="qr-img" src="${url}" />
            </body>
            </html>
        `);
            doc.close();

            const img = frame.contentWindow.document.getElementById('qr-img');

            img.onload = () => {
                frame.contentWindow.focus();
                frame.contentWindow.print();

                // аккуратно удаляем iframe после печати
                setTimeout(() => frame.remove(), 500);
            };

        } catch (e) {
            console.error(e);
            MiniUI.toast('Ошибка печати', { type: 'error' });
        }
    }


    function bindEvents() {

        document.getElementById('generate-btn').addEventListener('click', updateUI);


        printBtn.addEventListener('click', printQrOnly);

        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                updateUI();
            }
        });

    }

    // ------------------------------------
    // Init
    // ------------------------------------

    document.addEventListener('DOMContentLoaded', () => {
        const ok = checkPageAccess();
        if (!ok) return;

        renderUserNameSmall();
        bindEvents();

        // Показываем обязательное сканирование
        startScanModal();
    });

})();
