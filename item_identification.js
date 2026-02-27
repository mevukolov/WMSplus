(function () {
    "use strict";

    const loggedRaw = localStorage.getItem("user");
    if (!loggedRaw) {
        window.location.href = "login.html";
        return;
    }

    let user = null;
    try {
        user = JSON.parse(loggedRaw);
    } catch (e) {
        window.location.href = "login.html";
        return;
    }

    let supabaseClient = null;
    let lookupInProgress = false;
    let photoLookupToken = 0;

    let shkInputEl = null;
    let findBtnEl = null;
    let decodedGroupEl = null;
    let decodedShkEl = null;
    let decodedSourceEl = null;
    let resultGroupEl = null;
    let nmValueEl = null;
    let descriptionValueEl = null;
    let photoGroupEl = null;
    let photoStatusEl = null;
    let productPhotoEl = null;
    let nmQrGroupEl = null;
    let nmQrCanvasEl = null;
    let nmQrValueEl = null;

    const CHECK_SUM_FIRST_SIZE = 4;
    const CHECK_SUM_SECOND_SIZE = 4;
    const SHK_VALUE_SIZE = 42;
    const PREFIX = "*";
    const CHAR_LIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    const VERHOEFF_D = [
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

    const VERHOEFF_P = [
        [0,1,2,3,4,5,6,7,8,9],
        [1,5,7,6,2,8,3,0,9,4],
        [5,8,0,3,7,9,6,1,4,2],
        [8,9,1,6,0,4,3,5,2,7],
        [9,4,5,3,1,2,6,8,7,0],
        [4,2,8,6,5,7,3,9,0,1],
        [2,7,9,3,8,0,6,4,1,5],
        [7,0,4,6,9,1,3,2,5,8]
    ];

    const VERHOEFF_INV = [0,4,3,2,1,5,6,7,8,9];

    function buildRuToEnMap() {
        const ruLow = "ё1234567890-=йцукенгшщзхъ\\фывапролджэячсмитьбю.";
        const enLow = "`1234567890-=qwertyuiop[]\\asdfghjkl;'zxcvbnm,./";
        const ruHigh = "Ё!\"№;%:?*()_+ЙЦУКЕНГШЩЗХЪ/ФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,";
        const enHigh = "~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:\"ZXCVBNM<>?";

        const map = {};
        for (let i = 0; i < ruLow.length; i++) map[ruLow[i]] = enLow[i];
        for (let i = 0; i < ruHigh.length; i++) map[ruHigh[i]] = enHigh[i];
        return map;
    }

    const RU_TO_EN = buildRuToEnMap();

    function normalizeStickerLayout(str) {
        let out = String(str || "")
            .split("")
            .map(ch => RU_TO_EN[ch] || ch)
            .join("");

        // В русской раскладке символ "/" часто приходит как "."
        out = out.replace(/\./g, "/");
        return out;
    }

    function renderUserNameSmall() {
        try {
            const nameEl = document.getElementById("user-name-small");
            if (nameEl && user?.name) nameEl.textContent = user.name;
        } catch (e) {}
    }

    function bindElements() {
        shkInputEl = document.getElementById("item-shk-input");
        findBtnEl = document.getElementById("find-item-btn");
        decodedGroupEl = document.getElementById("decoded-group");
        decodedShkEl = document.getElementById("decoded-shk-value");
        decodedSourceEl = document.getElementById("decoded-source-value");
        resultGroupEl = document.getElementById("result-group");
        nmValueEl = document.getElementById("nm-value");
        descriptionValueEl = document.getElementById("description-value");
        photoGroupEl = document.getElementById("photo-group");
        photoStatusEl = document.getElementById("photo-status");
        productPhotoEl = document.getElementById("product-photo");
        nmQrGroupEl = document.getElementById("nm-qr-group");
        nmQrCanvasEl = document.getElementById("nm-qr-canvas");
        nmQrValueEl = document.getElementById("nm-qr-value");

        return !!(
            shkInputEl &&
            findBtnEl &&
            decodedGroupEl &&
            decodedShkEl &&
            decodedSourceEl &&
            resultGroupEl &&
            nmValueEl &&
            descriptionValueEl &&
            photoGroupEl &&
            photoStatusEl &&
            productPhotoEl &&
            nmQrGroupEl &&
            nmQrCanvasEl &&
            nmQrValueEl
        );
    }

    function getWbCardUrl(nm) {
        return `https://www.wildberries.ru/catalog/${encodeURIComponent(String(nm || "").trim())}/detail.aspx`;
    }

    function normalizeNmDigits(nm) {
        return String(nm || "").replace(/\D/g, "");
    }

    function normalizeHttpUrl(value) {
        let url = String(value || "").trim();
        if (!url) return "";
        if (url.startsWith("//")) url = `https:${url}`;
        if (url.startsWith("http://")) url = `https://${url.slice(7)}`;
        return /^https?:\/\//i.test(url) ? url : "";
    }

    function isLikelyImageUrl(url) {
        const u = String(url || "");
        return (
            /\.(webp|jpe?g|png)(?:\?|$)/i.test(u) ||
            /\/images\/(big|c516x688|tm)\//i.test(u) ||
            /\/img\//i.test(u)
        );
    }

    function uniqueUrls(urls) {
        const out = [];
        const seen = new Set();
        for (const raw of urls || []) {
            const url = normalizeHttpUrl(raw);
            if (!url || !isLikelyImageUrl(url)) continue;
            if (seen.has(url)) continue;
            seen.add(url);
            out.push(url);
        }
        return out;
    }

    function buildWbBasketInfoUrls(nmDigits) {
        const digits = String(nmDigits || "").trim();
        if (!digits) return [];

        const article = Number(digits);
        if (!Number.isFinite(article)) return [];

        const vol = Math.floor(article / 100000);
        const part = Math.floor(article / 1000);
        const urls = [];

        for (let i = 1; i <= 80; i++) {
            const idx = String(i).padStart(2, "0");
            urls.push(`https://basket-${idx}.wbbasket.ru/vol${vol}/part${part}/${digits}/info/ru/card.json`);
            urls.push(`https://basket-${idx}.wb.ru/vol${vol}/part${part}/${digits}/info/ru/card.json`);
        }

        return urls;
    }

    function extractPicsCountFromCardInfoJson(json) {
        if (!json || typeof json !== "object") return 0;

        if (Array.isArray(json.mediaFiles) && json.mediaFiles.length) {
            return Math.max(1, Math.min(json.mediaFiles.length, 12));
        }
        if (Array.isArray(json.photos) && json.photos.length) {
            return Math.max(1, Math.min(json.photos.length, 12));
        }
        if (Array.isArray(json.imgs) && json.imgs.length) {
            return Math.max(1, Math.min(json.imgs.length, 12));
        }

        const raw = Number(json.pics || json.picsCount || json.photoCount || 0);
        if (Number.isFinite(raw) && raw > 0) {
            return Math.max(1, Math.min(Math.round(raw), 12));
        }

        return 0;
    }

    async function fetchJsonWithTimeout(url, timeoutMs) {
        const canAbort = typeof AbortController === "function";
        const controller = canAbort ? new AbortController() : null;
        const timer = setTimeout(() => {
            if (controller) controller.abort();
        }, timeoutMs);

        try {
            const response = await fetch(url, {
                method: "GET",
                mode: "cors",
                credentials: "omit",
                cache: "no-store",
                signal: controller ? controller.signal : undefined
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } finally {
            clearTimeout(timer);
        }
    }

    async function resolvePhotoMetaByNmDigits(nmDigits) {
        const urls = buildWbBasketInfoUrls(nmDigits);
        if (!urls.length) return { picsCount: 4 };

        const batchSize = 10;
        for (let i = 0; i < urls.length; i += batchSize) {
            const batch = urls.slice(i, i + batchSize);
            const results = await Promise.all(batch.map(async url => {
                try {
                    const json = await fetchJsonWithTimeout(url, 1200);
                    const pics = extractPicsCountFromCardInfoJson(json);
                    return pics > 0 ? { picsCount: pics } : null;
                } catch (e) {
                    return null;
                }
            }));

            const found = results.find(Boolean);
            if (found) return found;
        }

        return { picsCount: 4 };
    }

    function buildDirectWbImageCandidates(nm, options) {
        const digits = normalizeNmDigits(nm);
        if (!digits) return [];

        const article = Number(digits);
        if (!Number.isFinite(article)) return [];

        const opts = options || {};
        const maxHosts = Math.max(12, Math.min(Number(opts.maxHosts || 80), 99));
        const maxPics = Math.max(1, Math.min(Number(opts.maxPics || 4), 12));

        const vol = Math.floor(article / 100000);
        const part = Math.floor(article / 1000);
        const urls = [];

        const hosts = [];
        for (let i = 1; i <= maxHosts; i++) {
            const idx = String(i).padStart(2, "0");
            hosts.push(`https://basket-${idx}.wbbasket.ru`);
            hosts.push(`https://basket-${idx}.wb.ru`);
        }

        const primarySizes = ["big", "c516x688"];
        const exts = ["webp", "jpg"];
        for (let imageIndex = 1; imageIndex <= maxPics; imageIndex++) {
            for (const size of primarySizes) {
                for (const ext of exts) {
                    for (const host of hosts) {
                        urls.push(`${host}/vol${vol}/part${part}/${digits}/images/${size}/${imageIndex}.${ext}`);
                    }
                }
            }
        }

        // fallback на wbstatic-путь.
        const shard = `${digits.slice(0, Math.max(digits.length - 4, 1))}0000`;
        for (let imageIndex = 1; imageIndex <= Math.min(maxPics, 6); imageIndex++) {
            urls.push(`https://images.wbstatic.net/c516x688/new/${shard}/${digits}-${imageIndex}.jpg`);
            urls.push(`https://images.wbstatic.net/big/new/${shard}/${digits}-${imageIndex}.jpg`);
            urls.push(`https://images.wbstatic.net/c516x688/new/${shard}/${digits}-${imageIndex}.webp`);
            urls.push(`https://images.wbstatic.net/big/new/${shard}/${digits}-${imageIndex}.webp`);
        }

        return uniqueUrls(urls);
    }

    function probeImageUrl(url, timeoutMs) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            let done = false;

            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                img.onload = null;
                img.onerror = null;
                reject(new Error("timeout"));
            }, timeoutMs);

            img.onload = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                img.onload = null;
                img.onerror = null;
                resolve(url);
            };

            img.onerror = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                img.onload = null;
                img.onerror = null;
                reject(new Error("load error"));
            };

            img.src = url;
        });
    }

    function firstFulfilled(promises) {
        return new Promise(resolve => {
            if (!promises.length) {
                resolve("");
                return;
            }

            let rejected = 0;
            let done = false;

            promises.forEach(p => {
                p.then(url => {
                    if (done) return;
                    done = true;
                    resolve(url);
                }).catch(() => {
                    rejected += 1;
                    if (!done && rejected === promises.length) resolve("");
                });
            });
        });
    }

    async function findFirstLoadableImage(urls) {
        const batchSize = 16;
        for (let i = 0; i < urls.length; i += batchSize) {
            const batch = urls.slice(i, i + batchSize);
            const probes = batch.map(url => probeImageUrl(url, 1300));
            const found = await firstFulfilled(probes);
            if (found) return found;
        }
        return "";
    }

    function setPhotoPreviewState(options) {
        const {
            showGroup = false,
            status = "",
            imageUrl = "",
            cardUrl = ""
        } = options || {};

        photoGroupEl.style.display = showGroup ? "" : "none";
        photoStatusEl.textContent = status;

        if (imageUrl) {
            productPhotoEl.src = imageUrl;
            productPhotoEl.style.display = "";
        } else {
            productPhotoEl.removeAttribute("src");
            productPhotoEl.style.display = "none";
        }

        productPhotoEl.dataset.cardUrl = cardUrl || "";
    }

    function bindPhotoOpenHandler() {
        productPhotoEl.addEventListener("click", () => {
            const cardUrl = String(productPhotoEl.dataset.cardUrl || "").trim();
            if (!cardUrl || productPhotoEl.style.display === "none") return;
            window.open(cardUrl, "_blank", "noopener,noreferrer");
        });
    }

    function resetNmQr() {
        nmQrGroupEl.style.display = "none";
        nmQrValueEl.textContent = "";
        const ctx = nmQrCanvasEl.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, nmQrCanvasEl.width, nmQrCanvasEl.height);
    }

    async function renderNmQr(nm) {
        const value = String(nm || "").trim();
        if (!value) {
            resetNmQr();
            return;
        }

        nmQrGroupEl.style.display = "";
        nmQrValueEl.textContent = value;

        const ctx = nmQrCanvasEl.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, nmQrCanvasEl.width, nmQrCanvasEl.height);

        if (!window.QRCode || typeof window.QRCode.toCanvas !== "function") {
            return;
        }

        try {
            await window.QRCode.toCanvas(nmQrCanvasEl, value, {
                width: 128,
                margin: 1,
                errorCorrectionLevel: "M",
                color: { dark: "#000000", light: "#FFFFFF" }
            });
        } catch (e) {
            console.error("Ошибка генерации QR номенклатуры:", e);
        }
    }

    async function loadProductPhotoByNm(nmRaw, token) {
        const nm = String(nmRaw || "").trim();
        if (!nm) {
            setPhotoPreviewState({ showGroup: false });
            return;
        }

        const cardUrl = getWbCardUrl(nm);
        const nmDigits = normalizeNmDigits(nm);
        if (nmDigits.length < 5) {
            setPhotoPreviewState({
                showGroup: true,
                status: "Фото не найдено.",
                cardUrl: cardUrl
            });
            return;
        }

        setPhotoPreviewState({
            showGroup: true,
            status: "Ищу фото товара...",
            cardUrl: cardUrl
        });

        const meta = await resolvePhotoMetaByNmDigits(nmDigits);
        if (token !== photoLookupToken) return;

        const primaryUrls = buildDirectWbImageCandidates(nmDigits, {
            maxPics: meta?.picsCount || 4,
            maxHosts: 30
        });

        let found = await findFirstLoadableImage(primaryUrls);
        if (token !== photoLookupToken) return;

        if (!found) {
            setPhotoPreviewState({
                showGroup: true,
                status: "Ищу фото товара (расширенный поиск)...",
                cardUrl: cardUrl
            });

            const expandedUrls = buildDirectWbImageCandidates(nmDigits, {
                maxPics: meta?.picsCount || 4,
                maxHosts: 80
            });

            const primarySet = new Set(primaryUrls);
            const onlyExpanded = expandedUrls.filter(url => !primarySet.has(url));
            found = await findFirstLoadableImage(onlyExpanded);
            if (token !== photoLookupToken) return;
        }

        if (!found) {
            setPhotoPreviewState({
                showGroup: true,
                status: "Фото не найдено.",
                cardUrl: cardUrl
            });
            return;
        }

        setPhotoPreviewState({
            showGroup: true,
            status: "",
            imageUrl: found,
            cardUrl: cardUrl
        });
    }

    function commonDecodeV2(barcode) {
        if (!barcode || barcode.charAt(0) !== PREFIX) return null;

        const body = barcode.slice(1);
        const base = BigInt(CHAR_LIST.length);
        let result = 0n;

        for (let i = 0; i < body.length; i++) {
            const ch = body.charAt(body.length - 1 - i);
            const idx = CHAR_LIST.indexOf(ch);
            if (idx < 0) return null;
            result += BigInt(idx) * (base ** BigInt(i));
        }

        return result;
    }

    function getBitsFromEnd(value, countOfBits) {
        const mask = (1n << BigInt(countOfBits)) - 1n;
        return Number(value & mask);
    }

    function validateVerhoeffForTwoChecksum(shkValue, chkSum, chkSum2) {
        const s = String(shkValue);
        const splitCount = Math.floor(s.length / 2) + (s.length % 2 !== 0 ? 1 : 0);
        const digits = Array.from(s).map(ch => Number(ch));

        let b = 0;
        let i = 0;

        for (let idx = 0; idx < digits.length; idx++) {
            const digit = digits[idx];
            if (i === splitCount) {
                if (VERHOEFF_INV[b] !== 0) return false;
                b = 0;
                i = 0;
                b = VERHOEFF_D[b][VERHOEFF_P[i % 8][chkSum2]];
                i += 1;
            }
            b = VERHOEFF_D[b][VERHOEFF_P[i % 8][digit]];
            i += 1;
        }

        if (i === splitCount) {
            if (VERHOEFF_INV[b] !== 0) return false;
            b = 0;
            i = 0;
            b = VERHOEFF_D[b][VERHOEFF_P[i % 8][chkSum2]];
            i += 1;
        }

        b = VERHOEFF_D[b][VERHOEFF_P[i % 8][chkSum]];
        return VERHOEFF_INV[b] === 0;
    }

    function decodeStickerBarcode(barcode) {
        const decoded = commonDecodeV2(barcode);
        if (decoded === null) {
            return { ok: false, message: "Стикер не распознан" };
        }

        const chkSum = getBitsFromEnd(decoded, CHECK_SUM_FIRST_SIZE);
        const chkSum2 = getBitsFromEnd(decoded >> BigInt(CHECK_SUM_FIRST_SIZE), CHECK_SUM_SECOND_SIZE);
        const valueBigInt = (decoded >> BigInt(CHECK_SUM_FIRST_SIZE + CHECK_SUM_SECOND_SIZE)) & ((1n << BigInt(SHK_VALUE_SIZE)) - 1n);
        const remaining = decoded >> BigInt(CHECK_SUM_FIRST_SIZE + CHECK_SUM_SECOND_SIZE + SHK_VALUE_SIZE);

        if (remaining !== 0n) {
            return { ok: false, message: "Некорректная длина стикера" };
        }

        const valueNumber = Number(valueBigInt);
        if (!Number.isSafeInteger(valueNumber) || valueNumber <= 0) {
            return { ok: false, message: "Некорректное значение ШК" };
        }

        const checksumValid = validateVerhoeffForTwoChecksum(valueNumber, chkSum, chkSum2);
        return {
            ok: true,
            value: String(valueNumber),
            checksumValid: checksumValid
        };
    }

    function parseInputShk(rawInput) {
        const raw = String(rawInput || "").trim();
        if (!raw) return { ok: false, message: "Введите ШК" };

        if (/^\d+$/.test(raw)) {
            return {
                ok: true,
                shk: raw,
                sourceText: ""
            };
        }

        let normalized = normalizeStickerLayout(raw).trim();
        if (normalized.startsWith("!")) {
            normalized = `*${normalized.slice(1)}`;
        }

        if (!normalized.startsWith("*")) {
            return { ok: false, message: "Некорректный формат. Введите цифры или скан-код с префиксом * / !" };
        }

        const decoded = decodeStickerBarcode(normalized);
        if (!decoded.ok) return decoded;

        return {
            ok: true,
            shk: decoded.value,
            sourceText: decoded.checksumValid
                ? `Скан: ${normalized}`
                : `Скан: ${normalized} (контрольная сумма невалидна)`
        };
    }

    function resetResult() {
        resultGroupEl.style.display = "none";
        nmValueEl.textContent = "";
        descriptionValueEl.textContent = "";
        decodedGroupEl.style.display = "none";
        decodedShkEl.textContent = "";
        decodedSourceEl.textContent = "";
        decodedSourceEl.style.display = "";
        photoLookupToken += 1;
        setPhotoPreviewState({ showGroup: false });
        resetNmQr();
    }

    async function lookupNmRepByShk(shk) {
        const { data, error } = await supabaseClient
            .from("nm_rep")
            .select("nm, description, shk, date")
            .eq("shk", shk)
            .order("date", { ascending: false })
            .limit(1);

        if (error) {
            return { ok: false, error: error };
        }

        if (!Array.isArray(data) || data.length === 0) {
            return { ok: false, notFound: true };
        }

        return { ok: true, row: data[0] };
    }

    async function logAwaitingAcceptance(shk) {
        try {
            const { error } = await supabaseClient
                .from("shk_rep")
                .insert({
                    shk: shk,
                    operation: "Ожидает оприходования",
                    emp: user.id,
                    place: "",
                    place_new: null,
                    date: (window.MiniUI?.nowIsoPlus3 ? window.MiniUI.nowIsoPlus3() : new Date().toISOString())
                });

            if (error) {
                console.error("Ошибка записи в shk_rep:", error);
            }
        } catch (e) {
            console.error("Ошибка логирования в shk_rep:", e);
        }
    }

    async function handleLookup() {
        if (lookupInProgress) return;

        const parsed = parseInputShk(shkInputEl.value);
        if (!parsed.ok) {
            MiniUI.toast(parsed.message || "Ошибка распознавания ШК", { type: "error" });
            resetResult();
            return;
        }

        lookupInProgress = true;
        findBtnEl.disabled = true;

        decodedGroupEl.style.display = "";
        decodedShkEl.textContent = parsed.shk;
        decodedSourceEl.textContent = parsed.sourceText || "";
        decodedSourceEl.style.display = parsed.sourceText ? "" : "none";
        shkInputEl.value = "";

        try {
            const found = await lookupNmRepByShk(parsed.shk);
            if (!found.ok) {
                if (found.notFound) {
                    MiniUI.toast("В репозитории ШК нет данных о вещи", { type: "info" });
                } else {
                    console.error("Ошибка поиска в nm_rep:", found.error);
                    MiniUI.toast("Ошибка связи с базой данных", { type: "error" });
                }

                resultGroupEl.style.display = "none";
                nmValueEl.textContent = "";
                descriptionValueEl.textContent = "";
                photoLookupToken += 1;
                setPhotoPreviewState({ showGroup: false });
                resetNmQr();
                return;
            }

            const row = found.row || {};
            const nm = String(row.nm || "").trim();
            const description = String(row.description || "").trim();

            resultGroupEl.style.display = "";
            nmValueEl.textContent = nm || "—";
            descriptionValueEl.textContent = description || "—";
            await renderNmQr(nm);
            await logAwaitingAcceptance(parsed.shk);

            MiniUI.toast("Товар найден", { type: "success" });

            const token = ++photoLookupToken;
            if (nm) {
                await loadProductPhotoByNm(nm, token);
            } else {
                setPhotoPreviewState({ showGroup: false });
            }
        } catch (e) {
            console.error(e);
            MiniUI.toast("Ошибка поиска", { type: "error" });
        } finally {
            lookupInProgress = false;
            findBtnEl.disabled = false;
        }
    }

    function bindEvents() {
        bindPhotoOpenHandler();

        findBtnEl.addEventListener("click", handleLookup);

        shkInputEl.addEventListener("keydown", ev => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                handleLookup();
            }
        });

        shkInputEl.addEventListener("input", () => {
            if (!String(shkInputEl.value || "").trim()) {
                resetResult();
            }
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        if (!bindElements()) {
            console.error("Не найдены элементы страницы item_identification");
            return;
        }

        supabaseClient = window.supabaseClient;
        if (!supabaseClient) {
            MiniUI.toast("Ошибка связи с базой данных", { type: "error" });
            return;
        }

        renderUserNameSmall();
        setPhotoPreviewState({ showGroup: false });
        resetResult();
        bindEvents();

        setTimeout(() => shkInputEl.focus(), 0);
    });
})();
