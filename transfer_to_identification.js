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
    let pureLossesFetchDebounce = null;
    let lastPhotoNmRequested = "";
    let photoLookupToken = 0;
    let pureLossesLookupToken = 0;
    let isDescriptionAutofilled = false;
    let autofilledBrand = "";
    let autofilledBrandNm = "";
    let lastNmInputValue = "";

    let nmInput = null;
    let descriptionInput = null;
    let brandValueEl = null;
    let stickerInput = null;
    let decodedStickerValueEl = null;
    let decodedBarcodeValueEl = null;
    let assignBtn = null;
    let mhBlock = null;
    let mhNameEl = null;
    let generatorCard = null;
    let ttiSideWrap = null;
    let descriptionGroup = null;
    let brandGroup = null;
    let stickerGroup = null;
    let decodedGroup = null;
    let photoGroup = null;
    let photoStatusEl = null;
    let productPhotoEl = null;
    let pureLossesGroup = null;
    let pureLossesSearchInput = null;
    let pureLossesSearchBtn = null;
    let pureLossesStatusEl = null;
    let pureLossesListEl = null;

    const CHECK_SUM_FIRST_SIZE = 4;
    const CHECK_SUM_SECOND_SIZE = 4;
    const SHK_VALUE_SIZE = 42;
    const PREFIX = "*";
    const CHAR_LIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const PURE_LOSSES_TABLE = "pure_losses_rep";
    const PURE_DECISION_COLUMNS = ["opp_decision", "opp_deecision"];
    const PURE_NM_COLUMNS = ["nm", "nm_id", "nmId"];
    const PURE_DESCRIPTION_COLUMNS = ["description", "decription"];
    const PURE_BRAND_COLUMNS = ["brand", "brand_name", "brandName"];
    const PURE_FOUND_DECISION = "Найден";
    const MAX_VISUAL_VARIANTS = 24;
    const VISUAL_SIMILAR_MAP = {
        A: "А", a: "а",
        B: "В", b: "в",
        C: "С", c: "с",
        E: "Е", e: "е",
        H: "Н", h: "н",
        K: "К", k: "к",
        M: "М", m: "м",
        O: "О", o: "о",
        P: "Р", p: "р",
        T: "Т", t: "т",
        X: "Х", x: "х",
        Y: "У", y: "у",
        А: "A", а: "a",
        В: "B", в: "b",
        С: "C", с: "c",
        Е: "E", е: "e",
        Н: "H", н: "h",
        К: "K", к: "k",
        М: "M", м: "m",
        О: "O", о: "o",
        Р: "P", р: "p",
        Т: "T", т: "t",
        Х: "X", х: "x",
        У: "Y", у: "y"
    };
    const pureLossesResolvedColumns = {
        nm: "",
        description: "",
        brand: ""
    };
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

    function fmtDateMsk(value) {
        if (!value) return "";
        try {
            return new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
        } catch (e) {
            return new Date(value).toLocaleString("ru-RU");
        }
    }

    function fmtDateMskDateOnly(value) {
        if (!value) return "";
        try {
            return new Intl.DateTimeFormat("ru-RU", {
                timeZone: "Europe/Moscow",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).format(new Date(value));
        } catch (e) {
            return new Date(value).toLocaleDateString("ru-RU");
        }
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
        ttiSideWrap = document.getElementById("tti-side-wrap");

        nmInput = document.getElementById("nm-input");
        descriptionInput = document.getElementById("description-input");
        brandValueEl = document.getElementById("brand-value");
        stickerInput = document.getElementById("new-sticker-input");
        decodedStickerValueEl = document.getElementById("decoded-sticker-value");
        decodedBarcodeValueEl = document.getElementById("decoded-barcode-value");
        assignBtn = document.getElementById("assign-btn");
        photoGroup = document.getElementById("photo-group");
        photoStatusEl = document.getElementById("photo-status");
        productPhotoEl = document.getElementById("product-photo");
        pureLossesGroup = document.getElementById("pure-losses-group");
        pureLossesSearchInput = document.getElementById("pure-losses-search-input");
        pureLossesSearchBtn = document.getElementById("pure-losses-search-btn");
        pureLossesStatusEl = document.getElementById("pure-losses-status");
        pureLossesListEl = document.getElementById("pure-losses-list");

        descriptionGroup = document.getElementById("description-group");
        brandGroup = document.getElementById("brand-group");
        stickerGroup = document.getElementById("sticker-group");
        decodedGroup = document.getElementById("decoded-group");

        return !!(
            mhBlock &&
            mhNameEl &&
            generatorCard &&
            ttiSideWrap &&
            nmInput &&
            descriptionInput &&
            brandValueEl &&
            stickerInput &&
            decodedStickerValueEl &&
            decodedBarcodeValueEl &&
            assignBtn &&
            photoGroup &&
            photoStatusEl &&
            productPhotoEl &&
            pureLossesGroup &&
            pureLossesSearchInput &&
            pureLossesSearchBtn &&
            pureLossesStatusEl &&
            pureLossesListEl &&
            descriptionGroup &&
            brandGroup &&
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

    function extractProductBrand(product) {
        if (!product || typeof product !== "object") return "";
        const keys = [
            "brand",
            "brand_name",
            "brandName",
            "trademark",
            "tradeMark",
            "vendor",
            "vendor_name",
            "vendorName",
            "supplier",
            "supplier_name",
            "supplierName",
            "manufacturer",
            "manufacturer_name",
            "manufacturerName"
        ];

        for (const key of keys) {
            const value = String(product[key] || "").trim();
            if (value) return value;
        }

        const nestedCandidates = [
            product.selling,
            product.brandInfo,
            product.supplierInfo,
            product.meta
        ];
        for (const node of nestedCandidates) {
            if (!node || typeof node !== "object") continue;
            for (const key of keys) {
                const value = String(node[key] || "").trim();
                if (value) return value;
            }
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

    function buildWbBasketInfoUrls(nmDigits, options) {
        const digits = String(nmDigits || "").trim();
        if (!digits) return [];

        const article = Number(digits);
        if (!Number.isFinite(article)) return [];

        const vol = Math.floor(article / 100000);
        const part = Math.floor(article / 1000);
        const maxHosts = Math.max(6, Math.min(Number(options?.maxHosts || 16), 40));
        const urls = [];
        for (let i = 1; i <= maxHosts; i++) {
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

    async function fetchTextWithTimeout(url, timeoutMs) {
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
            return await response.text();
        } finally {
            clearTimeout(timer);
        }
    }

    function decodeHtmlEntities(text) {
        const value = String(text || "");
        if (!value) return "";
        const textarea = document.createElement("textarea");
        textarea.innerHTML = value;
        return textarea.value;
    }

    function extractBrandFromProductPageHtml(html) {
        const source = String(html || "");
        if (!source) return "";

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(source, "text/html");
            const el = doc.querySelector(".productHeaderBrand");
            const value = String(el?.textContent || "").trim();
            if (value) return value;
        } catch (e) {}

        const re = /class=["']productHeaderBrand["'][^>]*>(.*?)</i;
        const match = source.match(re);
        return decodeHtmlEntities(match?.[1] || "").trim();
    }

    function extractNameFromProductPageHtml(html) {
        const source = String(html || "");
        if (!source) return "";

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(source, "text/html");
            const el = doc.querySelector(".productTitle");
            const value = String(el?.textContent || "").trim();
            if (value) return value;
        } catch (e) {}

        const re = /class=["'][^"']*productTitle[^"']*["'][^>]*>(.*?)</i;
        const match = source.match(re);
        return decodeHtmlEntities(match?.[1] || "").trim();
    }

    async function resolveProductPageMeta(cardUrl) {
        const url = String(cardUrl || "").trim();
        if (!url) return { name: "", brand: "" };

        try {
            const html = await fetchTextWithTimeout(url, 1000);
            return {
                name: extractNameFromProductPageHtml(html),
                brand: extractBrandFromProductPageHtml(html)
            };
        } catch (e) {
            return { name: "", brand: "" };
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
        const brand = extractProductBrand(product) || extractProductBrand(json);
        const picsCount = extractPicsCountFromCardInfoJson(product) || extractPicsCountFromCardInfoJson(json);

        if (!name && !brand && !picsCount) return null;
        return {
            name: name || "",
            brand: brand || "",
            picsCount: picsCount || 4,
            imageUrls: []
        };
    }

    async function resolveProductMetaByNmDigits(nmDigits) {
        const urls = buildWbBasketInfoUrls(nmDigits, { maxHosts: 40 }).slice(0, 80);
        if (!urls.length) return null;

        const batchSize = 12;
        let fallbackMeta = null;
        for (let i = 0; i < urls.length; i += batchSize) {
            const batch = urls.slice(i, i + batchSize);
            const results = await Promise.all(batch.map(async url => {
                try {
                    const json = await fetchJsonWithTimeout(url, 700);
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
            schedulePureLossesAutoLookup();
        }
    }

    function tryAutofillBrand(brand, expectedNm, token) {
        if (token !== photoLookupToken) return;
        if (!brand) return;
        const nmNow = String(nmInput.value || "").trim();
        if (nmNow !== String(expectedNm || "").trim()) return;

        autofilledBrand = String(brand || "").trim();
        autofilledBrandNm = nmNow;
        updateFormVisibility();
        schedulePureLossesAutoLookup();
    }

    function isUnknownColumnError(error) {
        const code = String(error?.code || "");
        const message = String(error?.message || "").toLowerCase();
        return (
            code === "42703" ||
            code === "PGRST204" ||
            (message.includes("column") && (message.includes("does not exist") || message.includes("could not find")))
        );
    }

    function buildVisualVariants(sourceText, maxVariants = MAX_VISUAL_VARIANTS) {
        const text = String(sourceText || "").trim();
        if (!text) return [];

        const chars = Array.from(text);
        const positions = [];
        for (let i = 0; i < chars.length; i++) {
            if (VISUAL_SIMILAR_MAP[chars[i]]) positions.push(i);
        }

        const result = new Set([text]);
        if (!positions.length) return [...result];

        const maxPositionsForCombos = 12;
        const comboPositions = positions.slice(0, maxPositionsForCombos);

        const fullySwapped = chars
            .map(ch => VISUAL_SIMILAR_MAP[ch] || ch)
            .join("");
        result.add(fullySwapped);

        comboPositions.forEach(pos => {
            if (result.size >= maxVariants) return;
            const cloned = chars.slice();
            cloned[pos] = VISUAL_SIMILAR_MAP[cloned[pos]] || cloned[pos];
            result.add(cloned.join(""));
        });

        const maxMask = 1 << comboPositions.length;
        for (let mask = 1; mask < maxMask && result.size < maxVariants; mask++) {
            const cloned = chars.slice();
            for (let bit = 0; bit < comboPositions.length; bit++) {
                if ((mask & (1 << bit)) === 0) continue;
                const pos = comboPositions[bit];
                cloned[pos] = VISUAL_SIMILAR_MAP[cloned[pos]] || cloned[pos];
            }
            result.add(cloned.join(""));
        }

        return Array.from(result).slice(0, maxVariants);
    }

    function getPureRowDecision(row) {
        for (const key of PURE_DECISION_COLUMNS) {
            const value = String(row?.[key] || "").trim();
            if (value) return value;
        }
        return "";
    }

    function normalizeDecisionValue(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/ё/g, "е")
            .replace(/[^0-9a-zа-я]+/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function isPureLossesRowAllowed(row) {
        const decision = normalizeDecisionValue(getPureRowDecision(row));
        return decision !== "найден" && decision !== "обнаружен без шк";
    }

    function getPureRowNm(row) {
        return String(row?.nm || row?.nm_id || row?.nmId || "").trim();
    }

    function getPureRowDescription(row) {
        return String(row?.description || row?.decription || "").trim();
    }

    function getPureRowBrand(row) {
        return String(row?.brand || row?.brand_name || row?.brandName || "").trim();
    }

    function getPureRowShk(row) {
        return String(row?.shk || "").trim();
    }

    function getPureRowDate(row) {
        return String(row?.date_lost || row?.date || row?.created_at || "").trim();
    }

    function parsePureDateTs(value) {
        const raw = String(value || "").trim();
        if (!raw) return NaN;

        const direct = Date.parse(raw);
        if (Number.isFinite(direct)) return direct;

        const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
        if (!match) return NaN;

        const day = Number(match[1] || 0);
        const month = Number(match[2] || 0);
        const year = Number(match[3] || 0);
        const hours = Number(match[4] || 0);
        const minutes = Number(match[5] || 0);
        const seconds = Number(match[6] || 0);

        return new Date(year, Math.max(0, month - 1), day, hours, minutes, seconds).getTime();
    }

    function formatPureDate(value) {
        const raw = String(value || "").trim();
        if (!raw) return "";
        const ts = parsePureDateTs(raw);
        if (Number.isFinite(ts)) {
            return fmtDateMskDateOnly(new Date(ts).toISOString());
        }
        const ruMatch = raw.match(/^(\d{2}\.\d{2}\.\d{4})/);
        if (ruMatch) return ruMatch[1];
        const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`;
        return raw;
    }

    function dedupePureLossesRows(rows) {
        const out = [];
        const seen = new Set();

        (rows || []).forEach(row => {
            const idKey = row && (row.id || row.pure_id || row.uuid);
            const signature = idKey
                ? `id:${idKey}`
                : `sig:${getPureRowDate(row)}|${getPureRowNm(row)}|${getPureRowDescription(row)}|${getPureRowBrand(row)}|${getPureRowShk(row)}|${String(row?.lr || row?.loss_reason || "")}`;
            if (seen.has(signature)) return;
            seen.add(signature);
            out.push(row);
        });

        return out;
    }

    function sortPureLossesRows(rows, priorityNm) {
        const targetNm = String(priorityNm || "").trim();
        return [...(rows || [])].sort((a, b) => {
            const aExact = targetNm && getPureRowNm(a) === targetNm ? 1 : 0;
            const bExact = targetNm && getPureRowNm(b) === targetNm ? 1 : 0;
            if (aExact !== bExact) return bExact - aExact;

            const aTs = parsePureDateTs(getPureRowDate(a));
            const bTs = parsePureDateTs(getPureRowDate(b));
            const aValid = Number.isFinite(aTs);
            const bValid = Number.isFinite(bTs);
            if (aValid && bValid && aTs !== bTs) return bTs - aTs;
            if (aValid && !bValid) return -1;
            if (!aValid && bValid) return 1;
            return getPureRowNm(a).localeCompare(getPureRowNm(b));
        });
    }

    function setPureLossesStatus(text) {
        if (!pureLossesStatusEl) return;
        pureLossesStatusEl.textContent = String(text || "");
    }

    function buildShkHistoryUrl(shkValue) {
        const shk = String(shkValue || "").trim();
        if (!shk) return "";
        return `https://wms.wbwh.tech/shk/status/history?shk=${encodeURIComponent(shk)}`;
    }

    function createPureLossesShkPill(shkValue) {
        const wrap = document.createElement("div");
        wrap.className = "pure-losses-line";

        const pill = document.createElement("span");
        pill.className = "pure-losses-shk-pill";

        const shk = String(shkValue || "").trim();
        if (!shk) {
            pill.textContent = "ШК: —";
            wrap.appendChild(pill);
            return wrap;
        }

        const link = document.createElement("a");
        link.className = "pure-losses-shk-link";
        link.href = buildShkHistoryUrl(shk);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = shk;

        pill.appendChild(link);
        wrap.appendChild(pill);
        return wrap;
    }

    function renderPureLossesRows(rows, options) {
        if (!pureLossesListEl) return;

        const opts = options || {};
        const priorityNm = String(opts.priorityNm || "").trim();
        const emptyMessage = String(opts.emptyMessage || "Совпадений не найдено.");

        pureLossesListEl.innerHTML = "";
        const sortedRows = sortPureLossesRows(rows || [], priorityNm);
        if (!sortedRows.length) {
            const emptyEl = document.createElement("div");
            emptyEl.className = "pure-losses-empty";
            emptyEl.textContent = emptyMessage;
            pureLossesListEl.appendChild(emptyEl);
            return;
        }

        sortedRows.forEach(row => {
            try {
                const nmValue = getPureRowNm(row);
                const descriptionValue = getPureRowDescription(row);
                const brandValue = getPureRowBrand(row);
                const shkValue = getPureRowShk(row);
                const dateValue = formatPureDate(getPureRowDate(row));
                const lrValue = String(row?.lr || row?.loss_reason || row?.loss_id || "").trim();
                const isExact = priorityNm && nmValue === priorityNm;

                const item = document.createElement("div");
                item.className = `pure-losses-item${isExact ? " exact-match" : ""}`;

                const top = document.createElement("div");
                top.className = "pure-losses-top";

                const title = document.createElement("div");
                title.className = "pure-losses-title";
                title.textContent = `НМ ${nmValue || "—"}`;

                const date = document.createElement("div");
                date.className = "pure-losses-date";
                date.textContent = dateValue;

                top.append(title, date);

                const descriptionEl = document.createElement("div");
                descriptionEl.className = "pure-losses-line";
                descriptionEl.textContent = `Наименование: ${descriptionValue || "—"}`;

                const brandEl = document.createElement("div");
                brandEl.className = "pure-losses-line";
                brandEl.textContent = `Бренд: ${brandValue || "—"}`;

                const shkEl = createPureLossesShkPill(shkValue);
                shkEl.classList.add("pure-losses-shk-row");

                const detailsEl = document.createElement("div");
                detailsEl.className = "pure-losses-line pure-losses-lr-line";
                detailsEl.textContent = `LR: ${lrValue || "—"}`;

                const actionsEl = document.createElement("div");
                actionsEl.className = "pure-losses-actions";

                const foundBtn = document.createElement("button");
                foundBtn.type = "button";
                foundBtn.className = "btn btn-outline pure-losses-found-btn";
                foundBtn.textContent = "Обнаружен";
                foundBtn.addEventListener("click", () => {
                    handlePureLossesFoundClick(row);
                });
                actionsEl.appendChild(foundBtn);

                const bottomRow = document.createElement("div");
                bottomRow.className = "pure-losses-bottom";
                bottomRow.append(detailsEl, actionsEl);

                item.append(shkEl, top, descriptionEl, brandEl, bottomRow);
                pureLossesListEl.appendChild(item);
            } catch (e) {
                console.error("Ошибка рендера строки pure_losses_rep:", e, row);
            }
        });
    }

    function getCurrentBrandValue() {
        const nm = String(nmInput?.value || "").trim();
        if (autofilledBrandNm === nm && String(autofilledBrand || "").trim()) {
            return String(autofilledBrand || "").trim();
        }
        return String(brandValueEl?.value || "").trim();
    }

    function getCurrentPureLossesContext() {
        return {
            nm: String(nmInput?.value || "").trim(),
            description: String(descriptionInput?.value || "").trim(),
            brand: getCurrentBrandValue()
        };
    }

    function buildRussianStem(word) {
        const value = String(word || "").trim().toLowerCase();
        if (!value || !/[а-яё]/i.test(value)) return "";

        const endings = [
            "иями", "ями", "ами", "иях", "ях", "ах", "ого", "ему", "ому", "ими", "ыми",
            "ий", "ый", "ой", "ая", "яя", "ое", "ее", "ые", "ие", "ов", "ев", "ом", "ем",
            "ам", "ям", "ах", "ях", "ую", "юю", "ия", "ья", "ью", "ию", "ие", "ье",
            "а", "я", "ы", "и", "е", "о", "у", "ю"
        ];

        for (const suffix of endings) {
            if (!value.endsWith(suffix)) continue;
            const stem = value.slice(0, -suffix.length);
            if (stem.length >= 4) return stem;
        }

        return "";
    }

    function buildDescriptionWords(text) {
        const source = String(text || "").trim().toLowerCase();
        if (!source) return [];

        const words = source
            .replace(/[^0-9a-zа-яё]+/gi, " ")
            .split(/\s+/)
            .map(v => v.trim())
            .filter(v => v.length >= 4);

        const out = new Set();
        words.forEach(word => {
            out.add(word);
            const stem = buildRussianStem(word);
            if (stem && stem.length >= 4) out.add(stem);
        });

        return Array.from(out).slice(0, 6);
    }

    async function runPureLossesColumnQuery(column, matcher, value) {
        let query = supabaseClient
            .from(PURE_LOSSES_TABLE)
            .select("*");

        if (matcher === "eq") {
            query = query.eq(column, value);
        } else {
            query = query.ilike(column, value);
        }

        const { data, error } = await query.limit(200);
        return {
            rows: Array.isArray(data) ? data : [],
            error: error || null
        };
    }

    async function queryPureLossesByColumnFallback(cacheKey, candidates, matcher, value) {
        const ordered = [];
        const cached = String(pureLossesResolvedColumns[cacheKey] || "").trim();
        if (cached) ordered.push(cached);
        (candidates || []).forEach(col => {
            if (!ordered.includes(col)) ordered.push(col);
        });

        let lastError = null;
        for (const column of ordered) {
            const result = await runPureLossesColumnQuery(column, matcher, value);
            if (!result.error) {
                pureLossesResolvedColumns[cacheKey] = column;
                return result;
            }

            if (isUnknownColumnError(result.error)) {
                if (pureLossesResolvedColumns[cacheKey] === column) {
                    pureLossesResolvedColumns[cacheKey] = "";
                }
                continue;
            }

            lastError = result.error;
            break;
        }

        return { rows: [], error: lastError };
    }

    async function fetchPureLossesAutoRows(context) {
        const nm = String(context?.nm || "").trim();
        const description = String(context?.description || "").trim();
        const brand = String(context?.brand || "").trim();

        const tasks = [];
        if (/^\d+$/.test(nm) && nm.length >= 5) {
            tasks.push(queryPureLossesByColumnFallback("nm", PURE_NM_COLUMNS, "eq", nm));
        }

        const words = buildDescriptionWords(description);
        words.forEach(word => {
            tasks.push(queryPureLossesByColumnFallback("description", PURE_DESCRIPTION_COLUMNS, "ilike", `%${word}%`));
        });

        if (brand.length >= 2) {
            tasks.push(queryPureLossesByColumnFallback("brand", PURE_BRAND_COLUMNS, "ilike", brand));
        }

        if (!tasks.length) {
            return { rows: [], error: null };
        }

        const results = await Promise.all(tasks);
        let firstError = null;
        const merged = [];

        results.forEach(result => {
            if (result.error && !firstError) {
                firstError = result.error;
                return;
            }
            merged.push(...(result.rows || []));
        });

        const filtered = dedupePureLossesRows(merged).filter(isPureLossesRowAllowed);
        return { rows: filtered, error: firstError };
    }

    async function fetchPureLossesManualRows(queryText) {
        const query = String(queryText || "").trim();
        if (!query) return { rows: [], error: null };

        if (/^\d+$/.test(query)) {
            const result = await queryPureLossesByColumnFallback("nm", PURE_NM_COLUMNS, "eq", query);
            return {
                rows: dedupePureLossesRows(result.rows || []).filter(isPureLossesRowAllowed),
                error: result.error || null
            };
        }

        const variants = buildVisualVariants(query, MAX_VISUAL_VARIANTS);
        const tasks = [];
        variants.forEach(variant => {
            tasks.push(queryPureLossesByColumnFallback("description", PURE_DESCRIPTION_COLUMNS, "ilike", `%${variant}%`));
            tasks.push(queryPureLossesByColumnFallback("brand", PURE_BRAND_COLUMNS, "ilike", `%${variant}%`));
        });

        const results = await Promise.all(tasks);
        let firstError = null;
        const merged = [];

        results.forEach(result => {
            if (result.error && !firstError) {
                firstError = result.error;
                return;
            }
            merged.push(...(result.rows || []));
        });

        return {
            rows: dedupePureLossesRows(merged).filter(isPureLossesRowAllowed),
            error: firstError
        };
    }

    function schedulePureLossesAutoLookup() {
        if (pureLossesFetchDebounce) {
            clearTimeout(pureLossesFetchDebounce);
        }

        pureLossesFetchDebounce = setTimeout(() => {
            const manualQuery = String(pureLossesSearchInput?.value || "").trim();
            if (manualQuery) return;
            runAutoPureLossesLookup();
        }, 350);
    }

    async function runAutoPureLossesLookup() {
        const context = getCurrentPureLossesContext();
        const hasAnyContext = Boolean(context.nm || context.description || context.brand);

        if (!hasAnyContext) {
            setPureLossesStatus("Введите номенклатуру, наименование или бренд для подбора.");
            renderPureLossesRows([], {
                emptyMessage: "Совпадений пока нет."
            });
            return;
        }

        const token = ++pureLossesLookupToken;
        setPureLossesStatus("Подбираю варианты...");

        const result = await fetchPureLossesAutoRows(context);
        if (token !== pureLossesLookupToken) return;

        if (result.error) {
            console.error("Ошибка поиска в pure_losses_rep:", result.error);
            setPureLossesStatus("Ошибка связи с pure_losses_rep.");
            renderPureLossesRows([], {
                emptyMessage: "Не удалось получить данные."
            });
            return;
        }

        const rows = result.rows || [];
        const exactCount = context.nm
            ? rows.filter(row => getPureRowNm(row) === context.nm).length
            : 0;

        setPureLossesStatus(`Найдено вариантов: ${rows.length}${exactCount ? ` • точных НМ: ${exactCount}` : ""}`);
        renderPureLossesRows(rows, {
            priorityNm: context.nm,
            emptyMessage: "Совпадений не найдено."
        });
    }

    async function handlePureLossesManualSearch() {
        const query = String(pureLossesSearchInput?.value || "").trim();
        if (!query) {
            runAutoPureLossesLookup();
            return;
        }

        const token = ++pureLossesLookupToken;
        setPureLossesStatus("Ищу по pure_losses_rep...");

        const result = await fetchPureLossesManualRows(query);
        if (token !== pureLossesLookupToken) return;

        if (result.error) {
            console.error("Ошибка ручного поиска в pure_losses_rep:", result.error);
            setPureLossesStatus("Ошибка связи с pure_losses_rep.");
            renderPureLossesRows([], {
                emptyMessage: "Не удалось получить данные."
            });
            return;
        }

        const manualPriorityNm = /^\d+$/.test(query)
            ? query
            : String(nmInput?.value || "").trim();

        const rows = result.rows || [];
        const exactCount = manualPriorityNm
            ? rows.filter(row => getPureRowNm(row) === manualPriorityNm).length
            : 0;

        setPureLossesStatus(`Ручной поиск: ${rows.length}${exactCount ? ` • точных НМ: ${exactCount}` : ""}`);
        renderPureLossesRows(rows, {
            priorityNm: manualPriorityNm,
            emptyMessage: "Совпадений по ручному запросу не найдено."
        });
    }

    async function resolvePhotoViaDirectLinks(nm, cardUrl, token, apiImageUrls, picsCount) {
        const primaryDirectUrls = buildDirectWbImageCandidates(nm, { maxPics: picsCount || 4, maxHosts: 16 });
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
            const expandedDirectUrls = buildDirectWbImageCandidates(nm, { maxPics: picsCount || 4, maxHosts: 40 });
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
            setPhotoPreviewState({
                showGroup: true,
                status: "Введите номенклатуру для поиска фото."
            });
            return;
        }

        const nmDigits = normalizeNmDigits(nm);
        if (nmDigits.length < 5) {
            setPhotoPreviewState({
                showGroup: true,
                status: "Введите корректную номенклатуру."
            });
            return;
        }

        const cardUrl = getWbCardUrl(nm);
        setPhotoPreviewState({
            showGroup: true,
            status: "Ищу карточку товара...",
            cardUrl: cardUrl
        });

        // Фото ищем сразу, без ожидания метаданных, чтобы UI не тормозил.
        const photoPromise = resolvePhotoViaDirectLinks(
            nm,
            cardUrl,
            token,
            [],
            4
        );

        resolveProductPageMeta(cardUrl)
            .then(pageMeta => {
                if (token !== photoLookupToken) return;
                if (pageMeta?.name) {
                    tryAutofillDescription(pageMeta.name, nm, token);
                }
                if (pageMeta?.brand) {
                    tryAutofillBrand(pageMeta.brand, nm, token);
                }
            })
            .catch(() => {});

        resolveProductMetaByNmDigits(nmDigits)
            .then(wbMeta => {
                if (token !== photoLookupToken) return;
                if (wbMeta?.name && !String(descriptionInput.value || "").trim()) {
                    tryAutofillDescription(wbMeta.name, nm, token);
                }
                if (wbMeta?.brand && !String(getCurrentBrandValue() || "").trim()) {
                    tryAutofillBrand(wbMeta.brand, nm, token);
                }
            })
            .catch(() => {});

        await photoPromise;
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
        ttiSideWrap.style.display = "block";
        pureLossesGroup.style.display = "";
        mhNameEl.textContent = `${place.place_name} (${place.place})`;
        setPhotoPreviewState({
            showGroup: true,
            status: "Введите номенклатуру для поиска фото."
        });
        setPureLossesStatus("Введите номенклатуру, наименование или бренд для подбора.");
        renderPureLossesRows([], {
            emptyMessage: "Совпадений пока нет."
        });
        schedulePureLossesAutoLookup();

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
        const hasBrand = hasNm && autofilledBrandNm === String(nmInput.value || "").trim() && String(autofilledBrand || "").trim().length > 0;

        descriptionGroup.style.display = hasNm ? "" : "none";
        brandGroup.style.display = hasBrand ? "" : "none";
        brandValueEl.value = hasBrand ? autofilledBrand : "";
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
            return { ok: false, message: "Ожидается WB стикер" };
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
        MiniUI.toast(`Стикер распознан: ${parsed.value}`, { type: "success" });
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

    function getNowIsoPlus3() {
        return (window.MiniUI?.nowIsoPlus3 ? window.MiniUI.nowIsoPlus3() : getNowIsoAtOffset(180));
    }

    function validateTransferFormBeforeSave(options) {
        const opts = options || {};
        const requireScannedSticker = opts.requireScannedSticker !== false;

        if (!selectedPlace) {
            MiniUI.toast("Сначала отсканируйте МХ", { type: "error" });
            return null;
        }

        const nm = String(nmInput?.value || "").trim();
        const description = String(descriptionInput?.value || "").trim();
        if (!nm) {
            MiniUI.toast("Заполните поле «Номенклатура»", { type: "error" });
            return null;
        }
        if (!description) {
            MiniUI.toast("Заполните поле «Наименование»", { type: "error" });
            return null;
        }
        if (requireScannedSticker && !decodedStickerValue) {
            MiniUI.toast("Сканируйте новый стикер товара", { type: "error" });
            return null;
        }

        return { nm, description };
    }

    function resetTransferFormAfterSuccess() {
        nmInput.value = "";
        descriptionInput.value = "";
        pureLossesSearchInput.value = "";
        isDescriptionAutofilled = false;
        autofilledBrand = "";
        autofilledBrandNm = "";
        lastNmInputValue = "";
        clearStickerState();
        lastPhotoNmRequested = "";
        photoLookupToken += 1;
        setPhotoPreviewState({
            showGroup: true,
            status: "Введите номенклатуру для поиска фото."
        });
        setPureLossesStatus("Введите номенклатуру, наименование или бренд для подбора.");
        renderPureLossesRows([], {
            emptyMessage: "Совпадений пока нет."
        });
        updateFormVisibility();
        nmInput.focus();
    }

    function buildNmRepPayloadBase(nm, description, operation, extraFields) {
        return {
            nm: nm,
            description: description,
            brand: (autofilledBrandNm === nm ? autofilledBrand : ""),
            emp: user.id,
            operation: String(operation || "Опознание товара"),
            place: selectedPlace?.place || "",
            date: getNowIsoPlus3(),
            ...(extraFields || {})
        };
    }

    function buildPureLossesUpdateFilters(row) {
        const filters = [];
        const push = (obj) => {
            if (!obj || typeof obj !== "object") return;
            const entries = Object.entries(obj).filter(([, v]) => String(v ?? "").trim() !== "");
            if (!entries.length) return;
            filters.push(Object.fromEntries(entries));
        };

        push({ id: row?.id });
        push({ pure_id: row?.pure_id });
        push({ uuid: row?.uuid });

        const shk = getPureRowShk(row);
        const nm = getPureRowNm(row);
        const description = getPureRowDescription(row);
        if (shk && nm) push({ shk: shk, nm: nm });
        if (shk) push({ shk: shk });
        if (nm && description) {
            push({ nm: nm, description: description });
            push({ nm: nm, decription: description });
        }
        if (nm) push({ nm: nm });

        const unique = [];
        const seen = new Set();
        filters.forEach(item => {
            const sig = Object.entries(item)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => `${k}:${v}`)
                .join("|");
            if (!sig || seen.has(sig)) return;
            seen.add(sig);
            unique.push(item);
        });
        return unique;
    }

    async function updatePureLossesRowWithPatch(row, patch) {
        const filters = buildPureLossesUpdateFilters(row);
        let lastError = null;

        for (const filter of filters) {
            let query = supabaseClient.from(PURE_LOSSES_TABLE).update(patch);
            Object.entries(filter).forEach(([key, value]) => {
                query = query.eq(key, value);
            });

            const { data, error } = await query.select("*").limit(1);
            if (!error) {
                if (Array.isArray(data) && data.length) return { ok: true };
                continue;
            }

            if (isUnknownColumnError(error)) {
                continue;
            }
            lastError = error;
            break;
        }

        return { ok: false, error: lastError };
    }

    async function markPureLossAsFound(row, stickerValue) {
        const decisionCandidates = ["opp_decision", "opp_deecision"];
        const empCandidates = ["opp_emp", "emp"];
        let lastError = null;

        for (const decisionCol of decisionCandidates) {
            for (const empCol of empCandidates) {
                const patch = {
                    [decisionCol]: PURE_FOUND_DECISION,
                    [empCol]: user.id,
                    shk: String(stickerValue || "").trim()
                };

                const result = await updatePureLossesRowWithPatch(row, patch);
                if (result.ok) return { ok: true };
                if (result.error) {
                    lastError = result.error;
                    if (!isUnknownColumnError(result.error)) {
                        return { ok: false, error: result.error };
                    }
                }
            }
        }

        return {
            ok: false,
            error: lastError || new Error("Не удалось обновить запись pure_losses_rep")
        };
    }

    async function handlePureLossesFoundClick(row) {
        if (isSubmitting) return;
        const confirmed = await (window.MiniUI?.confirm
            ? window.MiniUI.confirm("Вы действительно хотите дать движение товару?")
            : Promise.resolve(window.confirm("Вы действительно хотите дать движение товару?")));
        if (!confirmed) return;

        const formData = validateTransferFormBeforeSave({ requireScannedSticker: false });
        if (!formData) return;

        const selectedPureShk = getPureRowShk(row);
        if (!selectedPureShk) {
            MiniUI.toast("В выбранной записи чистых списаний нет ШК", { type: "error" });
            return;
        }

        isSubmitting = true;
        assignBtn.disabled = true;

        try {
            const pureResult = await markPureLossAsFound(row, selectedPureShk);
            if (!pureResult.ok) {
                console.error("Ошибка обновления pure_losses_rep:", pureResult.error);
                MiniUI.toast("Ошибка записи в pure_losses_rep", { type: "error" });
                return;
            }

            const identifiedAt = getNowIsoPlus3();
            const payloadBase = buildNmRepPayloadBase(
                formData.nm,
                formData.description,
                "Обнаружение ШК",
                {
                    is_identified: 1,
                    date_identified: identifiedAt
                }
            );

            const nmResult = await insertIntoNmRep(payloadBase, selectedPureShk, { includeBarcode: false });
            if (!nmResult.ok) {
                console.error("Ошибка записи в nm_rep:", nmResult.error);
                MiniUI.toast("Ошибка записи в nm_rep", { type: "error" });
                return;
            }

            MiniUI.toast("Товар идентифицирован", { type: "success" });
            resetTransferFormAfterSuccess();
        } catch (e) {
            console.error(e);
            MiniUI.toast("Ошибка связи с базой данных", { type: "error" });
        } finally {
            isSubmitting = false;
            assignBtn.disabled = false;
        }
    }

    async function insertIntoNmRep(payloadBase, stickerValue, options) {
        const opts = options || {};
        const includeBarcode = opts.includeBarcode !== false;
        const barcodeValue = String(opts.barcodeValue ?? normalizedStickerBarcode ?? "").trim();

        const payloadBases = [{ ...payloadBase }];
        const optionalColumns = ["brand", "is_identified", "date_identified"];

        optionalColumns.forEach(col => {
            if (!Object.prototype.hasOwnProperty.call(payloadBase, col)) return;
            const nextVariants = [];
            payloadBases.forEach(base => {
                nextVariants.push(base);
                if (Object.prototype.hasOwnProperty.call(base, col)) {
                    const trimmed = { ...base };
                    delete trimmed[col];
                    nextVariants.push(trimmed);
                }
            });
            payloadBases.splice(0, payloadBases.length, ...nextVariants);
        });

        const payloadVariants = [];
        for (const base of payloadBases) {
            if (includeBarcode && barcodeValue) {
                payloadVariants.push({ ...base, shk: stickerValue, barcode: barcodeValue });
            }
            payloadVariants.push(
                { ...base, shk: stickerValue },
                { ...base, sticker: stickerValue },
                { ...base, new_sticker: stickerValue }
            );
            if (includeBarcode && barcodeValue) {
                payloadVariants.push({ ...base, barcode: barcodeValue });
            }
            payloadVariants.push({ ...base });
        }

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
        const formData = validateTransferFormBeforeSave();
        if (!formData) return;

        isSubmitting = true;
        assignBtn.disabled = true;

        try {
            const payloadBase = buildNmRepPayloadBase(
                formData.nm,
                formData.description,
                "Опознание товара"
            );

            const result = await insertIntoNmRep(payloadBase, decodedStickerValue);
            if (!result.ok) {
                console.error("Ошибка записи в nm_rep:", result.error);
                MiniUI.toast("Ошибка записи в nm_rep", { type: "error" });
                return;
            }

            MiniUI.toast("Стикер присвоен", { type: "success" });
            resetTransferFormAfterSuccess();
        } catch (e) {
            console.error(e);
            MiniUI.toast("Ошибка связи с базой данных", { type: "error" });
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
                autofilledBrand = "";
                autofilledBrandNm = "";
                lastNmInputValue = nmValue;
            }

            schedulePhotoLookup(nmValue);
            schedulePureLossesAutoLookup();
            if (!nmValue) {
                descriptionInput.value = "";
                isDescriptionAutofilled = false;
                autofilledBrand = "";
                autofilledBrandNm = "";
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
            schedulePureLossesAutoLookup();
        });
        descriptionInput.addEventListener("keydown", ev => {
            if (ev.key === "Enter" && descriptionInput.value.trim()) {
                ev.preventDefault();
                stickerInput.focus();
            }
        });

        bindStickerScannerInput();
        bindPhotoOpenHandler();
        pureLossesSearchBtn.addEventListener("click", handlePureLossesManualSearch);
        pureLossesSearchInput.addEventListener("keydown", ev => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                handlePureLossesManualSearch();
            }
        });
        pureLossesSearchInput.addEventListener("input", () => {
            if (!String(pureLossesSearchInput.value || "").trim()) {
                schedulePureLossesAutoLookup();
            }
        });
        assignBtn.addEventListener("click", handleAssignClick);
    }

    document.addEventListener("DOMContentLoaded", () => {
        if (!bindElements()) {
            console.error("Не найдены элементы страницы transfer_to_identification");
            return;
        }

        supabaseClient = window.supabaseClient;
        if (!supabaseClient) {
            MiniUI.toast("Ошибка связи с базой данных", { type: "error" });
            return;
        }

        renderUserNameSmall();
        setPhotoPreviewState({ showGroup: false });
        setPureLossesStatus("Введите номенклатуру, наименование или бренд для подбора.");
        renderPureLossesRows([], {
            emptyMessage: "Совпадений пока нет."
        });
        updateFormVisibility();
        bindEvents();

        mhBlock.style.display = "none";
        generatorCard.style.display = "none";
        ttiSideWrap.style.display = "none";
        pureLossesGroup.style.display = "none";

        startPlaceScanModal();
    });
})();
