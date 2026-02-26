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
    let selectedPlace = null;
    let activeScanModal = null;
    let decodedStickerValue = "";
    let normalizedStickerBarcode = "";
    let isSubmitting = false;

    let placeScanBuffer = "";
    let stickerScanBuffer = "";
    let stickerScanTimes = [];
    let photoFetchDebounce = null;
    let lastPhotoNmRequested = "";
    let photoLookupToken = 0;
    let isDescriptionAutofilled = false;
    let lastNmInputValue = "";

    let nmInput = null;
    let descriptionInput = null;
    let stickerInput = null;
    let decodedStickerValueEl = null;
    let decodedBarcodeValueEl = null;
    let assignBtn = null;
    let mhBlock = null;
    let mhNameEl = null;
    let generatorCard = null;
    let descriptionGroup = null;
    let stickerGroup = null;
    let decodedGroup = null;
    let photoGroup = null;
    let photoStatusEl = null;
    let productPhotoEl = null;

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

    function normalizeLayout(str) {
        return String(str || "")
            .split("")
            .map(ch => RU_TO_EN[ch] || ch)
            .join("");
    }

    function normalizeStickerLayout(str) {
        const rus = "ёйцукенгшщзхъфывапролджэячсмитьбю";
        const eng = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./";
        const map = {};
        for (let i = 0; i < rus.length; i++) {
            map[rus[i]] = eng[i];
            map[rus[i].toUpperCase()] = eng[i].toUpperCase();
        }

        let out = String(str || "")
            .split("")
            .map(ch => map[ch] || ch)
            .join("");

        // В русской раскладке символ "/" часто приходит как "."
        out = out.replace(/\./g, "/");
        return out;
    }

    function pad2(value) {
        return String(value).padStart(2, "0");
    }

    function pad3(value) {
        return String(value).padStart(3, "0");
    }

    function getNowIsoAtOffset(offsetMinutes) {
        const offset = Number(offsetMinutes) || 0;
        const shifted = new Date(Date.now() + (offset * 60000));
        const y = shifted.getUTCFullYear();
        const m = pad2(shifted.getUTCMonth() + 1);
        const d = pad2(shifted.getUTCDate());
        const hh = pad2(shifted.getUTCHours());
        const mm = pad2(shifted.getUTCMinutes());
        const ss = pad2(shifted.getUTCSeconds());
        const ms = pad3(shifted.getUTCMilliseconds());

        const sign = offset >= 0 ? "+" : "-";
        const abs = Math.abs(offset);
        const offH = pad2(Math.floor(abs / 60));
        const offM = pad2(abs % 60);

        return `${y}-${m}-${d}T${hh}:${mm}:${ss}.${ms}${sign}${offH}:${offM}`;
    }

    function renderUserNameSmall() {
        try {
            const nameEl = document.getElementById("user-name-small");
            if (nameEl && user?.name) nameEl.textContent = user.name;
        } catch (e) {}
    }

    function bindElements() {
        mhBlock = document.getElementById("mh-block");
        mhNameEl = document.getElementById("mh-name");
        generatorCard = document.getElementById("generator-card");

        nmInput = document.getElementById("nm-input");
        descriptionInput = document.getElementById("description-input");
        stickerInput = document.getElementById("new-sticker-input");
        decodedStickerValueEl = document.getElementById("decoded-sticker-value");
        decodedBarcodeValueEl = document.getElementById("decoded-barcode-value");
        assignBtn = document.getElementById("assign-btn");
        photoGroup = document.getElementById("photo-group");
        photoStatusEl = document.getElementById("photo-status");
        productPhotoEl = document.getElementById("product-photo");

        descriptionGroup = document.getElementById("description-group");
        stickerGroup = document.getElementById("sticker-group");
        decodedGroup = document.getElementById("decoded-group");

        return !!(
            mhBlock &&
            mhNameEl &&
            generatorCard &&
            nmInput &&
            descriptionInput &&
            stickerInput &&
            decodedStickerValueEl &&
            decodedBarcodeValueEl &&
            assignBtn &&
            photoGroup &&
            photoStatusEl &&
            productPhotoEl &&
            descriptionGroup &&
            stickerGroup &&
            decodedGroup
        );
    }

    function getWbCardUrl(nm) {
        return `https://www.wildberries.ru/catalog/${encodeURIComponent(String(nm || "").trim())}/detail.aspx`;
    }

    function normalizeNmDigits(nm) {
        const digits = String(nm || "").replace(/\D/g, "");
        return digits || "";
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

    function extractImageUrlsDeep(node, depth, out) {
        if (!node || depth > 5) return;

        if (typeof node === "string") {
            const url = normalizeHttpUrl(node);
            if (url && isLikelyImageUrl(url)) out.push(url);
            return;
        }

        if (Array.isArray(node)) {
            const limit = Math.min(node.length, 40);
            for (let i = 0; i < limit; i++) extractImageUrlsDeep(node[i], depth + 1, out);
            return;
        }

        if (typeof node !== "object") return;
        const entries = Object.entries(node);
        const limit = Math.min(entries.length, 80);
        for (let i = 0; i < limit; i++) {
            const [key, value] = entries[i];
            const lower = String(key || "").toLowerCase();

            if (typeof value === "string") {
                const maybeUrl = normalizeHttpUrl(value);
                if (maybeUrl && (isLikelyImageUrl(maybeUrl) || /(image|img|photo|pic|cover|thumb)/.test(lower))) {
                    out.push(maybeUrl);
                }
                continue;
            }

            if (Array.isArray(value) || (value && typeof value === "object")) {
                extractImageUrlsDeep(value, depth + 1, out);
            }
        }
    }

    function findProductsArray(node, depth) {
        if (!node || depth > 4) return [];

        if (Array.isArray(node)) {
            if (node.length > 0) {
                const hasProductShape = node.some(item => (
                    item &&
                    typeof item === "object" &&
                    (
                        Object.prototype.hasOwnProperty.call(item, "id") ||
                        Object.prototype.hasOwnProperty.call(item, "nm_id") ||
                        Object.prototype.hasOwnProperty.call(item, "nmId")
                    )
                ));
                if (hasProductShape) return node;
            }

            const limit = Math.min(node.length, 25);
            for (let i = 0; i < limit; i++) {
                const found = findProductsArray(node[i], depth + 1);
                if (found.length) return found;
            }
            return [];
        }

        if (typeof node !== "object") return [];
        if (Array.isArray(node.products)) return node.products;
        if (Array.isArray(node.items)) return node.items;

        const values = Object.values(node);
        const limit = Math.min(values.length, 25);
        for (let i = 0; i < limit; i++) {
            const found = findProductsArray(values[i], depth + 1);
            if (found.length) return found;
        }
        return [];
    }

    function pickProductByNm(products, nmDigits) {
        if (!Array.isArray(products) || !products.length) return null;
        const target = String(nmDigits || "").trim();
        if (!target) return products[0] || null;

        const byId = products.find(item => {
            if (!item || typeof item !== "object") return false;
            const candidates = [item.id, item.nm_id, item.nmId, item.nmID, item.nm];
            return candidates.some(v => String(v || "").trim() === target);
        });

        return byId || products[0] || null;
    }

    function findProductByNmDeep(node, nmDigits, depth) {
        if (!node || depth > 6) return null;
        const target = String(nmDigits || "").trim();

        if (Array.isArray(node)) {
            const limit = Math.min(node.length, 80);
            for (let i = 0; i < limit; i++) {
                const found = findProductByNmDeep(node[i], target, depth + 1);
                if (found) return found;
            }
            return null;
        }

        if (typeof node !== "object") return null;

        const idCandidates = [node.id, node.nm_id, node.nmId, node.nmID, node.nm];
        const idMatched = idCandidates.some(v => String(v || "").trim() === target);
        if (idMatched) return node;

        const values = Object.values(node);
        const limit = Math.min(values.length, 80);
        for (let i = 0; i < limit; i++) {
            const found = findProductByNmDeep(values[i], target, depth + 1);
            if (found) return found;
        }
        return null;
    }

    function extractProductName(product) {
        if (!product || typeof product !== "object") return "";
        const keys = [
            "name",
            "imt_name",
            "imtName",
            "title",
            "nm_name",
            "nmName",
            "goodsName",
            "displayName",
            "subject_name",
            "subjectName",
            "subject",
            "entity"
        ];
        for (const key of keys) {
            const value = String(product[key] || "").trim();
            if (value) return value;
        }
        return "";
    }

    function extractProductPicsCount(product, fallbackImageUrls) {
        if (product && typeof product === "object") {
            const rawValues = [
                product.pics,
                product.picsCount,
                product.pics_count,
                product.photoCount,
                product.photo_count
            ];
            for (const raw of rawValues) {
                const n = Number(raw);
                if (Number.isFinite(n) && n > 0) return Math.max(1, Math.min(Math.round(n), 12));
            }
        }

        if (Array.isArray(fallbackImageUrls) && fallbackImageUrls.length) {
            return Math.max(1, Math.min(fallbackImageUrls.length, 8));
        }
        return 4;
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

    function extractMetaFromInfoJson(json, nmDigits) {
        if (!json || typeof json !== "object") return null;

        const product =
            findProductByNmDeep(json, nmDigits, 0) ||
            (typeof json.nm_id !== "undefined" ? json : null) ||
            (typeof json.id !== "undefined" ? json : null) ||
            json;

        const name = extractProductName(product) || extractProductName(json);
        const picsCount = extractPicsCountFromCardInfoJson(product) || extractPicsCountFromCardInfoJson(json);

        if (!name && !picsCount) return null;
        return {
            name: name || "",
            picsCount: picsCount || 4,
            imageUrls: []
        };
    }

    async function resolveProductMetaByNmDigits(nmDigits) {
        const urls = buildWbBasketInfoUrls(nmDigits);
        if (!urls.length) return null;

        const batchSize = 10;
        let fallbackMeta = null;
        for (let i = 0; i < urls.length; i += batchSize) {
            const batch = urls.slice(i, i + batchSize);
            const results = await Promise.all(batch.map(async url => {
                try {
                    const json = await fetchJsonWithTimeout(url, 1200);
                    return extractMetaFromInfoJson(json, nmDigits);
                } catch (e) {
                    return null;
                }
            }));

            for (const meta of results) {
                if (!meta) continue;
                if (meta.name) return meta;
                if (!fallbackMeta) fallbackMeta = meta;
            }
        }

        return fallbackMeta;
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

        // Дополнительный fallback на wbstatic-путь.
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
            let finished = false;
            const timeout = setTimeout(() => {
                if (finished) return;
                finished = true;
                img.onload = null;
                img.onerror = null;
                reject(new Error("timeout"));
            }, timeoutMs);

            img.onload = () => {
                if (finished) return;
                finished = true;
                clearTimeout(timeout);
                img.onload = null;
                img.onerror = null;
                resolve(url);
            };
            img.onerror = () => {
                if (finished) return;
                finished = true;
                clearTimeout(timeout);
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
                p.then(value => {
                    if (done) return;
                    done = true;
                    resolve(value);
                }).catch(() => {
                    rejected += 1;
                    if (!done && rejected === promises.length) {
                        resolve("");
                    }
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

    function tryAutofillDescription(name, expectedNm, token) {
        if (token !== photoLookupToken) return;
        if (!name) return;
        if (String(nmInput.value || "").trim() !== String(expectedNm || "").trim()) return;

        const current = String(descriptionInput.value || "").trim();
        if (!current || isDescriptionAutofilled) {
            descriptionInput.value = name;
            isDescriptionAutofilled = true;
            updateFormVisibility();
        }
    }

    async function resolvePhotoViaDirectLinks(nm, cardUrl, token, apiImageUrls, picsCount) {
        const primaryDirectUrls = buildDirectWbImageCandidates(nm, { maxPics: picsCount || 4, maxHosts: 30 });
        const primaryUrls = uniqueUrls([...(apiImageUrls || []), ...primaryDirectUrls]);
        if (!primaryUrls.length) {
            if (token !== photoLookupToken) return;
            setPhotoPreviewState({
                showGroup: true,
                status: "Фото не найдено.",
                cardUrl: cardUrl
            });
            return;
        }

        if (token !== photoLookupToken) return;
        setPhotoPreviewState({
            showGroup: true,
            status: "Ищу фото товара...",
            cardUrl: cardUrl
        });

        let found = await findFirstLoadableImage(primaryUrls);
        if (token !== photoLookupToken) return;

        if (!found) {
            const expandedDirectUrls = buildDirectWbImageCandidates(nm, { maxPics: picsCount || 4, maxHosts: 80 });
            const primarySet = new Set(primaryUrls);
            const onlyExpanded = expandedDirectUrls.filter(url => !primarySet.has(url));
            if (onlyExpanded.length) {
                setPhotoPreviewState({
                    showGroup: true,
                    status: "Ищу фото товара (расширенный поиск)...",
                    cardUrl: cardUrl
                });
                found = await findFirstLoadableImage(onlyExpanded);
                if (token !== photoLookupToken) return;
            }
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
            status: "Фото найдено.",
            imageUrl: found,
            cardUrl: cardUrl
        });
    }

    function setPhotoPreviewState(options) {
        const {
            showGroup = false,
            status = "",
            imageUrl = "",
            cardUrl = ""
        } = options || {};

        photoGroup.style.display = showGroup ? "" : "none";
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

    async function loadProductPhotoByNm(nmRaw, token) {
        const nm = String(nmRaw || "").trim();
        if (!nm) {
            setPhotoPreviewState({ showGroup: false });
            return;
        }

        const nmDigits = normalizeNmDigits(nm);
        if (nmDigits.length < 5) {
            setPhotoPreviewState({ showGroup: false });
            return;
        }

        const cardUrl = getWbCardUrl(nm);
        setPhotoPreviewState({
            showGroup: true,
            status: "Ищу карточку товара...",
            cardUrl: cardUrl
        });

        const meta = await resolveProductMetaByNmDigits(nmDigits);
        if (token !== photoLookupToken) return;

        if (meta && meta.name) {
            tryAutofillDescription(meta.name, nm, token);
        }

        await resolvePhotoViaDirectLinks(
            nm,
            cardUrl,
            token,
            meta?.imageUrls || [],
            meta?.picsCount || 4
        );
    }

    function schedulePhotoLookup(nmValue) {
        const nm = String(nmValue || "").trim();
        if (photoFetchDebounce) {
            clearTimeout(photoFetchDebounce);
        }

        if (!nm) {
            lastPhotoNmRequested = "";
            loadProductPhotoByNm("");
            return;
        }

        photoFetchDebounce = setTimeout(() => {
            if (nm === lastPhotoNmRequested) return;
            lastPhotoNmRequested = nm;
            const token = ++photoLookupToken;
            loadProductPhotoByNm(nm, token);
        }, 450);
    }

    function bindPhotoOpenHandler() {
        productPhotoEl.addEventListener("click", () => {
            const cardUrl = String(productPhotoEl.dataset.cardUrl || "").trim();
            if (!cardUrl || productPhotoEl.style.display === "none") return;
            window.open(cardUrl, "_blank", "noopener,noreferrer");
        });
    }

    async function lookupPlace(sticker) {
        const code = normalizeLayout(sticker).trim();
        if (!code) return null;

        const { data, error } = await supabaseClient
            .from("places")
            .select("*")
            .eq("place_sticker", code)
            .maybeSingle();

        if (error) {
            console.error("Ошибка поиска МХ:", error);
            return null;
        }
        return data || null;
    }

    async function handleScannedPlace(code) {
        const place = await lookupPlace(code);
        if (!place) {
            MiniUI.toast("МХ не найден", { type: "error" });
            return;
        }

        if (String(place.wh_id) !== String(user.user_wh_id)) {
            MiniUI.toast("Этот МХ относится к другому складу", { type: "error" });
            return;
        }

        selectedPlace = place;

        if (activeScanModal) {
            activeScanModal.remove();
            activeScanModal = null;
        }

        mhBlock.style.display = "";
        generatorCard.style.display = "";
        mhNameEl.textContent = `${place.place_name} (${place.place})`;

        MiniUI.toast(`МХ выбран: ${place.place_name}`, { type: "success" });
        setTimeout(() => nmInput.focus(), 0);
    }

    function startPlaceScanModal() {
        const modal = document.createElement("div");
        modal.className = "modal";
        modal.style.display = "flex";

        modal.innerHTML = `
            <div class="modal-content" style="width:360px;max-width:90%;padding:26px 28px 32px;box-sizing:border-box;">
                <div style="font-weight:600;margin-bottom:12px;">Отсканируйте МХ</div>
                <input class="input" placeholder="Сканируйте МХ" style="width:100%;display:block;box-sizing:border-box;margin:0;">
            </div>
        `;

        document.body.appendChild(modal);
        activeScanModal = modal;

        const inputEl = modal.querySelector(".input");
        setTimeout(() => inputEl.focus(), 0);
        setTimeout(() => {
            inputEl.focus();
            inputEl.select();
        }, 0);

        placeScanBuffer = "";
        inputEl.addEventListener("keydown", async (ev) => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                const scanned = (placeScanBuffer || inputEl.value || "").trim();
                placeScanBuffer = "";
                inputEl.value = "";
                if (scanned) await handleScannedPlace(scanned);
                return;
            }
            if (ev.key.length === 1) {
                placeScanBuffer += ev.key;
            }
        });
    }

    function clearDecodedResult() {
        decodedStickerValue = "";
        normalizedStickerBarcode = "";
        decodedStickerValueEl.textContent = "";
        decodedBarcodeValueEl.textContent = "";
    }

    function clearStickerState() {
        stickerScanBuffer = "";
        stickerScanTimes = [];
        stickerInput.value = "";
        clearDecodedResult();
    }

    function updateFormVisibility() {
        const hasNm = nmInput.value.trim().length > 0;
        const hasDescription = hasNm && descriptionInput.value.trim().length > 0;
        const hasDecodedSticker = decodedStickerValue.length > 0;

        descriptionGroup.style.display = hasNm ? "" : "none";
        stickerGroup.style.display = hasDescription ? "" : "none";
        decodedGroup.style.display = hasDecodedSticker ? "" : "none";
        assignBtn.style.display = hasNm && hasDescription && hasDecodedSticker ? "inline-flex" : "none";
    }

    function isLikelyScannerInput(scannedText, scanTimes) {
        if (!scannedText || scannedText.length < 6) return false;
        if (!scanTimes || scanTimes.length < 2) return false;

        const duration = scanTimes[scanTimes.length - 1] - scanTimes[0];
        const avgInterval = duration / (scanTimes.length - 1);

        return avgInterval <= 80 && duration <= 1800;
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
        return { ok: true, value: String(valueNumber), checksumValid: checksumValid };
    }

    function parseScannedSticker(rawCode) {
        let normalized = normalizeStickerLayout(rawCode).trim();
        if (!normalized) {
            return { ok: false, message: "Пустой скан" };
        }

        if (normalized.startsWith("!")) {
            normalized = `*${normalized.slice(1)}`;
        }

        if (!normalized.startsWith("*")) {
            return { ok: false, message: "Некорректный стикер: нужен префикс \"*\" или \"!\"" };
        }

        const decoded = decodeStickerBarcode(normalized);
        if (!decoded.ok) {
            return decoded;
        }

        return {
            ok: true,
            barcode: normalized,
            value: decoded.value,
            checksumValid: decoded.checksumValid !== false
        };
    }

    function handleDecodedSticker() {
        const scanned = (stickerScanBuffer || stickerInput.value || "").trim();
        const scanTimes = stickerScanTimes.slice();

        stickerScanBuffer = "";
        stickerScanTimes = [];

        if (!scanned) {
            MiniUI.toast("Сканируйте стикер", { type: "info" });
            stickerInput.value = "";
            clearDecodedResult();
            updateFormVisibility();
            return;
        }

        if (!isLikelyScannerInput(scanned, scanTimes)) {
            MiniUI.toast("Ручной ввод запрещен. Используйте сканер.", { type: "error" });
            stickerInput.value = "";
            clearDecodedResult();
            updateFormVisibility();
            return;
        }

        const parsed = parseScannedSticker(scanned);
        if (!parsed.ok) {
            MiniUI.toast(parsed.message || "Ошибка распознавания стикера", { type: "error" });
            stickerInput.value = "";
            clearDecodedResult();
            updateFormVisibility();
            return;
        }

        decodedStickerValue = parsed.value;
        normalizedStickerBarcode = parsed.barcode;
        stickerInput.value = parsed.barcode;
        decodedStickerValueEl.textContent = parsed.value;
        decodedBarcodeValueEl.textContent = `Скан: ${parsed.barcode}`;
        updateFormVisibility();
        if (parsed.checksumValid) {
            MiniUI.toast(`Стикер распознан: ${parsed.value}`, { type: "success" });
        } else {
            MiniUI.toast(`Стикер распознан: ${parsed.value} (контрольная сумма невалидна)`, { type: "info", duration: 4500 });
        }
    }

    function bindStickerScannerInput() {
        stickerInput.addEventListener("keydown", ev => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                handleDecodedSticker();
                return;
            }

            if (ev.key === "Escape") {
                ev.preventDefault();
                clearStickerState();
                updateFormVisibility();
                return;
            }

            if (ev.key.length === 1) {
                stickerScanBuffer += ev.key;
                stickerScanTimes.push(Date.now());
                stickerInput.value = stickerScanBuffer;
            }
        });

        stickerInput.addEventListener("paste", ev => {
            ev.preventDefault();
            MiniUI.toast("Ручной ввод запрещен. Используйте сканер.", { type: "error" });
        });
        stickerInput.addEventListener("drop", ev => {
            ev.preventDefault();
            MiniUI.toast("Ручной ввод запрещен. Используйте сканер.", { type: "error" });
        });
        stickerInput.addEventListener("cut", ev => {
            ev.preventDefault();
        });
    }

    async function insertIntoNmRep(payloadBase, stickerValue) {
        const payloadVariants = [
            { ...payloadBase, shk: stickerValue, barcode: normalizedStickerBarcode },
            { ...payloadBase, shk: stickerValue },
            { ...payloadBase, sticker: stickerValue },
            { ...payloadBase, new_sticker: stickerValue },
            { ...payloadBase, barcode: normalizedStickerBarcode },
            { ...payloadBase }
        ];

        let lastError = null;
        for (const payload of payloadVariants) {
            const { error } = await supabaseClient.from("nm_rep").insert(payload);
            if (!error) return { ok: true };

            lastError = error;
            const code = String(error.code || "");
            const message = String(error.message || "").toLowerCase();
            const unknownColumn = (
                code === "42703" ||
                code === "PGRST204" ||
                (message.includes("column") && (message.includes("does not exist") || message.includes("could not find")))
            );
            if (!unknownColumn) break;
        }

        return { ok: false, error: lastError };
    }

    async function handleAssignClick() {
        if (isSubmitting) return;
        if (!selectedPlace) {
            MiniUI.toast("Сначала отсканируйте МХ", { type: "error" });
            return;
        }

        const nm = nmInput.value.trim();
        const description = descriptionInput.value.trim();
        if (!nm) {
            MiniUI.toast("Заполните поле «Номенклатура»", { type: "error" });
            return;
        }
        if (!description) {
            MiniUI.toast("Заполните поле «Наименование»", { type: "error" });
            return;
        }
        if (!decodedStickerValue) {
            MiniUI.toast("Сканируйте новый стикер товара", { type: "error" });
            return;
        }

        isSubmitting = true;
        assignBtn.disabled = true;

        try {
            const payloadBase = {
                nm: nm,
                description: description,
                emp: user.id,
                operation: "Опознание товара",
                place: selectedPlace.place,
                date: (window.MiniUI?.nowIsoPlus3 ? window.MiniUI.nowIsoPlus3() : getNowIsoAtOffset(180))
            };

            const result = await insertIntoNmRep(payloadBase, decodedStickerValue);
            if (!result.ok) {
                console.error("Ошибка записи в nm_rep:", result.error);
                MiniUI.toast("Ошибка записи в nm_rep", { type: "error" });
                return;
            }

            MiniUI.toast("Стикер присвоен", { type: "success" });

            nmInput.value = "";
            descriptionInput.value = "";
            isDescriptionAutofilled = false;
            lastNmInputValue = "";
            clearStickerState();
            lastPhotoNmRequested = "";
            photoLookupToken += 1;
            setPhotoPreviewState({ showGroup: false });
            updateFormVisibility();
            nmInput.focus();
        } catch (e) {
            console.error(e);
            MiniUI.toast("Ошибка отправки", { type: "error" });
        } finally {
            isSubmitting = false;
            assignBtn.disabled = false;
        }
    }

    function bindEvents() {
        nmInput.addEventListener("input", () => {
            const nmValue = String(nmInput.value || "").trim();
            if (nmValue !== lastNmInputValue) {
                clearStickerState();
                if (isDescriptionAutofilled) {
                    descriptionInput.value = "";
                    isDescriptionAutofilled = false;
                }
                lastNmInputValue = nmValue;
            }

            schedulePhotoLookup(nmValue);
            if (!nmValue) {
                descriptionInput.value = "";
                isDescriptionAutofilled = false;
                clearStickerState();
            }
            updateFormVisibility();
        });
        nmInput.addEventListener("keydown", ev => {
            if (ev.key === "Enter" && nmInput.value.trim()) {
                ev.preventDefault();
                descriptionInput.focus();
            }
        });

        descriptionInput.addEventListener("input", () => {
            isDescriptionAutofilled = false;
            clearStickerState();
            updateFormVisibility();
        });
        descriptionInput.addEventListener("keydown", ev => {
            if (ev.key === "Enter" && descriptionInput.value.trim()) {
                ev.preventDefault();
                stickerInput.focus();
            }
        });

        bindStickerScannerInput();
        bindPhotoOpenHandler();
        assignBtn.addEventListener("click", handleAssignClick);
    }

    document.addEventListener("DOMContentLoaded", () => {
        if (!bindElements()) {
            console.error("Не найдены элементы страницы transfer_to_identification");
            return;
        }

        supabaseClient = window.supabaseClient;
        if (!supabaseClient) {
            MiniUI.toast("Ошибка Supabase", { type: "error" });
            return;
        }

        renderUserNameSmall();
        setPhotoPreviewState({ showGroup: false });
        updateFormVisibility();
        bindEvents();

        mhBlock.style.display = "none";
        generatorCard.style.display = "none";

        startPlaceScanModal();
    });
})();
