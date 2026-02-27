(function () {
    const logged = localStorage.getItem("user");
    if (!logged) {
        window.location.href = "login.html";
        return;
    }

    const supabaseClient = window.supabaseClient;
    if (!supabaseClient) {
        console.error("supabaseClient missing - ui.js must be loaded first");
        return;
    }

    const profileCard = document.getElementById("profile-card");
    const profileFio = document.getElementById("profile-fio");
    const profileWh = document.getElementById("profile-wh");
    const profileId = document.getElementById("profile-id");
    const profileAccesses = document.getElementById("profile-accesses");

    const badgeBtn = document.getElementById("badge-btn");
    const changePasswordBtn = document.getElementById("change-password-btn");
    const syncWarehouseBtn = document.getElementById("sync-warehouse-btn");
    const badgeModal = document.getElementById("badge-modal");
    const badgeModalContent = badgeModal ? badgeModal.querySelector(".modal-content") : null;
    const badgeCanvas = document.getElementById("badge-canvas");
    const badgeCloseBtn = document.getElementById("badge-close-btn");
    const badgeDownloadBtn = document.getElementById("badge-download-btn");
    const badgePrintBtn = document.getElementById("badge-print-btn");

    const passwordModal = document.getElementById("password-modal");
    const oldPasswordInput = document.getElementById("old-password");
    const newPasswordInput = document.getElementById("new-password");
    const confirmPasswordInput = document.getElementById("confirm-password");
    const passwordCancelBtn = document.getElementById("password-cancel");
    const passwordSubmitBtn = document.getElementById("password-submit");

    let currentUser = null;
    let currentWhName = "";
    let activeWarehouseModal = null;
    let pendingWarehouse = null;
    let pagesMap = {};

    function normalizeAccesses(accesses) {
        if (Array.isArray(accesses)) {
            return accesses.map((a) => String(a).trim()).filter(Boolean);
        }

        return String(accesses || "")
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean);
    }

    function getEmployeeNumericId() {
        const rawId = String(currentUser?.id || "").trim();
        if (!rawId) return "";
        return rawId.replace(/\D/g, "");
    }

    function buildRuToEnMap() {
        const ruLow = "ё1234567890-=йцукенгшщзхъ\\фывапролджэячсмитьбю.";
        const enLow = "`1234567890-=qwertyuiop[]\\asdfghjkl;'zxcvbnm,./";
        const ruHigh = "Ё!\"№;%:?*()_+ЙЦУКЕНГШЩЗХЪ/ФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,";
        const enHigh = "~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:\"ZXCVBNM<>?";

        const map = {};
        for (let i = 0; i < ruLow.length; i += 1) map[ruLow[i]] = enLow[i];
        for (let i = 0; i < ruHigh.length; i += 1) map[ruHigh[i]] = enHigh[i];
        return map;
    }

    const RU_TO_EN = buildRuToEnMap();

    function fixRussianLayout(str) {
        return String(str || "")
            .split("")
            .map((ch) => RU_TO_EN[ch] || ch)
            .join("");
    }

    async function getWarehouseNameById(whId) {
        if (!whId) return "";

        const { data, error } = await supabaseClient
            .from("wh_rep")
            .select("wh_name")
            .eq("wh_id", String(whId))
            .maybeSingle();

        if (error || !data) return "";
        return data.wh_name || "";
    }

    async function loadPagesMap() {
        const { data, error } = await supabaseClient
            .from("pages")
            .select("page,page_name");

        if (error || !Array.isArray(data)) {
            console.error("Cannot load pages map", error);
            pagesMap = {};
            return;
        }

        const map = {};
        data.forEach((row) => {
            const code = String(row.page || "").trim();
            if (!code) return;
            map[code] = String(row.page_name || code);
        });
        pagesMap = map;
    }

    function updateLocalUser(user, whName) {
        try {
            const raw = JSON.parse(localStorage.getItem("user") || "{}");
            const fresh = {
                ...raw,
                id: user.id,
                fio: user.fio ?? "",
                name: user.fio || raw.name || "",
                pass: user.pass ?? raw.pass ?? "",
                accesses: normalizeAccesses(user.accesses),
                user_wh_id: user.user_wh_id,
                wh_name: whName || ""
            };

            localStorage.setItem("user", JSON.stringify(fresh));
            localStorage.removeItem("user_cache");
        } catch (e) {
            console.error("Cannot sync local user", e);
        }
    }

    function renderUser() {
        if (!currentUser) return;

        profileFio.textContent = currentUser.fio || "Без ФИО";
        profileWh.textContent = currentWhName || `Склад ID: ${currentUser.user_wh_id || "-"}`;
        profileId.textContent = currentUser.id || "-";

        const accesses = normalizeAccesses(currentUser.accesses);
        profileAccesses.innerHTML = "";

        if (!accesses.length) {
            const empty = document.createElement("div");
            empty.className = "profile-access-item";
            empty.textContent = "Нет доступов";
            profileAccesses.appendChild(empty);
        } else {
            accesses.forEach((access) => {
                const row = document.createElement("div");
                row.className = "profile-access-item";
                row.textContent = pagesMap[access] || access;
                profileAccesses.appendChild(row);
            });
        }

        profileCard.style.display = "";
    }

    async function loadCurrentUser() {
        const localUser = JSON.parse(localStorage.getItem("user") || "{}");
        const userId = localUser?.id;

        if (!userId) {
            window.location.href = "login.html";
            return;
        }

        const { data, error } = await supabaseClient
            .from("users")
            .select("*")
            .eq("id", String(userId))
            .maybeSingle();

        if (error || !data) {
            MiniUI.toast("Не удалось загрузить пользователя", { type: "error" });
            return;
        }

        currentUser = data;
        if ((currentUser.pass === undefined || currentUser.pass === null || currentUser.pass === "") && localUser.pass) {
            currentUser.pass = localUser.pass;
        }
        await loadPagesMap();
        currentWhName = await getWarehouseNameById(currentUser.user_wh_id);

        updateLocalUser(currentUser, currentWhName);
        renderUser();
    }

    function openPasswordModal() {
        if (!currentUser) return;

        oldPasswordInput.value = "";
        newPasswordInput.value = "";
        confirmPasswordInput.value = "";

        passwordModal.classList.remove("hidden");
        setTimeout(() => oldPasswordInput.focus(), 0);
    }

    function closePasswordModal() {
        passwordModal.classList.add("hidden");
    }

    async function submitPasswordChange() {
        if (!currentUser) return;

        const oldPass = oldPasswordInput.value.trim();
        const newPass = newPasswordInput.value.trim();
        const confirmPass = confirmPasswordInput.value.trim();

        if (!oldPass || !newPass || !confirmPass) {
            MiniUI.toast("Заполните все поля", { type: "error" });
            return;
        }

        if (String(currentUser.pass || "") !== oldPass) {
            MiniUI.toast("Старый пароль указан неверно", { type: "error" });
            return;
        }

        if (newPass !== confirmPass) {
            MiniUI.toast("Новый пароль и подтверждение не совпадают", { type: "error" });
            return;
        }

        const { error } = await supabaseClient
            .from("users")
            .update({ pass: newPass })
            .eq("id", String(currentUser.id));

        if (error) {
            MiniUI.toast("Не удалось сменить пароль", { type: "error" });
            return;
        }

        currentUser.pass = newPass;
        updateLocalUser(currentUser, currentWhName);

        closePasswordModal();
        MiniUI.toast("Пароль успешно изменен", { type: "success" });
    }

    function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
        const words = String(text || "").trim().split(/\s+/).filter(Boolean);
        if (!words.length) return y;

        let line = "";
        let lineCount = 0;

        for (let i = 0; i < words.length; i += 1) {
            const testLine = line ? `${line} ${words[i]}` : words[i];
            if (ctx.measureText(testLine).width > maxWidth && line) {
                if (lineCount >= maxLines - 1) {
                    let clipped = line;
                    while (clipped && ctx.measureText(`${clipped}...`).width > maxWidth) {
                        clipped = clipped.slice(0, -1);
                    }
                    ctx.fillText(`${clipped}...`, x, y);
                    return y + lineHeight;
                }
                ctx.fillText(line, x, y);
                y += lineHeight;
                lineCount += 1;
                line = words[i];
            } else {
                line = testLine;
            }
        }

        if (lineCount < maxLines) {
            if (lineCount === maxLines - 1 && ctx.measureText(line).width > maxWidth) {
                let clipped = line;
                while (clipped && ctx.measureText(`${clipped}...`).width > maxWidth) {
                    clipped = clipped.slice(0, -1);
                }
                ctx.fillText(`${clipped}...`, x, y);
            } else {
                ctx.fillText(line, x, y);
            }
            y += lineHeight;
        }

        return y;
    }

    async function drawBadgeSticker() {
        if (!badgeCanvas || !currentUser) return false;
        if (typeof window.QRCode === "undefined" || typeof window.JsBarcode === "undefined") {
            MiniUI.toast("Не загружены библиотеки QR/Barcode", { type: "error" });
            return false;
        }

        const employeeId = getEmployeeNumericId();
        if (!employeeId) {
            MiniUI.toast("ID сотрудника должен быть числовым", { type: "error" });
            return false;
        }

        const fio = currentUser.fio || "";
        const warehouseName = currentWhName || `Склад ID: ${currentUser.user_wh_id || "-"}`;
        const ctx = badgeCanvas.getContext("2d");
        ctx.clearRect(0, 0, badgeCanvas.width, badgeCanvas.height);

        const CANVAS_SIZE = badgeCanvas.width || 350;
        const SCALE = CANVAS_SIZE / 1000;

        const QR_SIZE = Math.round(200 * SCALE);
        const BAR_H_HEIGHT = Math.round(200 * SCALE);
        const BAR_V_WIDTH = Math.round(200 * SCALE);
        const OFFSET = Math.round(20 * SCALE);
        const MARGIN = Math.round(20 * SCALE);
        const FRAME_RADIUS = Math.round(20 * SCALE);
        const FRAME_LINE = Math.max(2, Math.round(10 * SCALE));
        const TEXT_OFFSET = Math.round(25 * SCALE);
        const TOP_FONT_SIZE = Math.round(44 * SCALE);
        const FIO_FONT_SIZE = Math.round(54 * SCALE);
        const BOTTOM_FONT_SIZE = Math.round(54 * SCALE);

        const BAR_H_WIDTH = CANVAS_SIZE - 2 * QR_SIZE - 2 * OFFSET - 2 * MARGIN;
        const BAR_V_HEIGHT = CANVAS_SIZE - 2 * QR_SIZE - 2 * OFFSET - 2 * MARGIN;

        const makeQR = (text) =>
            new Promise((resolve) => {
                const div = document.createElement("div");
                new QRCode(div, { text, width: QR_SIZE, height: QR_SIZE, margin: 0 });
                setTimeout(() => resolve(div.querySelector("canvas")), 50);
            });

        const makeBarHScaled = (text) => {
            const temp = document.createElement("canvas");
            temp.width = Math.round(864 * SCALE);
            temp.height = BAR_H_HEIGHT;
            JsBarcode(temp, text, {
                format: "CODE128",
                displayValue: false,
                width: 3,
                height: BAR_H_HEIGHT,
                margin: 0
            });

            const canvas = document.createElement("canvas");
            canvas.width = BAR_H_WIDTH;
            canvas.height = BAR_H_HEIGHT;
            canvas.getContext("2d").drawImage(temp, 0, 0, BAR_H_WIDTH, BAR_H_HEIGHT);
            return canvas;
        };

        const makeBarV = (text) => {
            const temp = makeBarHScaled(text);
            const canvas = document.createElement("canvas");
            canvas.width = BAR_V_WIDTH;
            canvas.height = BAR_V_HEIGHT;
            const c = canvas.getContext("2d");
            c.save();
            c.translate(BAR_V_WIDTH, 0);
            c.rotate(Math.PI / 2);
            c.drawImage(temp, 0, 0);
            c.restore();
            return canvas;
        };

        const qr = await makeQR(employeeId);
        const barTop = makeBarHScaled(employeeId);
        const barBottom = makeBarHScaled(employeeId);
        const barLeft = makeBarV(employeeId);
        const barRight = makeBarV(employeeId);

        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        ctx.drawImage(qr, MARGIN, MARGIN);
        ctx.drawImage(qr, CANVAS_SIZE - QR_SIZE - MARGIN, MARGIN);
        ctx.drawImage(qr, MARGIN, CANVAS_SIZE - QR_SIZE - MARGIN);
        ctx.drawImage(qr, CANVAS_SIZE - QR_SIZE - MARGIN, CANVAS_SIZE - QR_SIZE - MARGIN);

        ctx.drawImage(barTop, QR_SIZE + OFFSET + MARGIN, MARGIN);
        ctx.drawImage(barBottom, QR_SIZE + OFFSET + MARGIN, CANVAS_SIZE - BAR_H_HEIGHT - MARGIN);
        ctx.drawImage(barLeft, MARGIN, QR_SIZE + OFFSET + MARGIN);
        ctx.drawImage(barRight, CANVAS_SIZE - BAR_V_WIDTH - MARGIN, QR_SIZE + OFFSET + MARGIN);

        const frameX = QR_SIZE + OFFSET + MARGIN;
        const frameY = QR_SIZE + OFFSET + MARGIN;
        const frameWidth = CANVAS_SIZE - 2 * frameX;
        const frameHeight = CANVAS_SIZE - 2 * frameY;

        ctx.lineWidth = FRAME_LINE;
        ctx.strokeStyle = "black";
        ctx.beginPath();
        ctx.moveTo(frameX + FRAME_RADIUS, frameY);
        ctx.lineTo(frameX + frameWidth - FRAME_RADIUS, frameY);
        ctx.quadraticCurveTo(frameX + frameWidth, frameY, frameX + frameWidth, frameY + FRAME_RADIUS);
        ctx.lineTo(frameX + frameWidth, frameY + frameHeight - FRAME_RADIUS);
        ctx.quadraticCurveTo(frameX + frameWidth, frameY + frameHeight, frameX + frameWidth - FRAME_RADIUS, frameY + frameHeight);
        ctx.lineTo(frameX + FRAME_RADIUS, frameY + frameHeight);
        ctx.quadraticCurveTo(frameX, frameY + frameHeight, frameX, frameY + frameHeight - FRAME_RADIUS);
        ctx.lineTo(frameX, frameY + FRAME_RADIUS);
        ctx.quadraticCurveTo(frameX, frameY, frameX + FRAME_RADIUS, frameY);
        ctx.stroke();

        const maxWidth = frameWidth - 2 * TEXT_OFFSET;
        const startX = frameX + TEXT_OFFSET;
        let textY = frameY + TEXT_OFFSET;

        ctx.fillStyle = "black";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        ctx.font = `${TOP_FONT_SIZE}px 'Inter', sans-serif`;
        textY = drawWrappedText(ctx, warehouseName, startX, textY, maxWidth, TOP_FONT_SIZE + 6, 2);
        textY += 10;

        ctx.font = `${FIO_FONT_SIZE}px 'Inter', sans-serif`;
        textY = drawWrappedText(ctx, fio, startX, textY, maxWidth, FIO_FONT_SIZE + 6, 4);

        ctx.textBaseline = "bottom";
        ctx.font = `${Math.round(34 * SCALE)}px 'Inter', sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText("ID сотрудника", frameX + TEXT_OFFSET, frameY + frameHeight - TEXT_OFFSET);

        ctx.font = `${BOTTOM_FONT_SIZE}px 'Inter', sans-serif`;
        ctx.textAlign = "right";
        ctx.fillText(employeeId, frameX + frameWidth - TEXT_OFFSET, frameY + frameHeight - TEXT_OFFSET);
        return true;
    }

    function closeBadgeModal() {
        badgeModal.classList.add("hidden");
    }

    function downloadBadgeSticker() {
        if (!badgeCanvas) return;
        const employeeId = getEmployeeNumericId() || "employee";
        const link = document.createElement("a");
        link.href = badgeCanvas.toDataURL("image/png");
        link.download = `badge_${employeeId}.png`;
        link.click();
    }

    function printBadgeSticker() {
        if (!badgeCanvas) return;
        const url = badgeCanvas.toDataURL("image/png");

        const frame = document.createElement("iframe");
        frame.style.position = "fixed";
        frame.style.right = "0";
        frame.style.bottom = "0";
        frame.style.width = "0";
        frame.style.height = "0";
        frame.style.border = "0";
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
                <img id="badge-print-img" src="${url}" />
            </body>
            </html>
        `);
        doc.close();

        const img = frame.contentWindow.document.getElementById("badge-print-img");
        img.onload = () => {
            frame.contentWindow.focus();
            frame.contentWindow.print();
            setTimeout(() => frame.remove(), 500);
        };
    }

    function syncBadgeModalLayout() {
        if (!badgeModalContent || !badgeCanvas) return;

        const basePadding = 32; // left+right padding inside modal-content
        const targetWidth = badgeCanvas.width + basePadding;

        badgeModalContent.style.width = `${targetWidth}px`;
        badgeModalContent.style.maxWidth = "calc(100vw - 24px)";
    }

    async function openBadgeModal() {
        const ok = await drawBadgeSticker();
        if (!ok) return;
        syncBadgeModalLayout();
        badgeModal.classList.remove("hidden");
    }

    async function lookupPlace(sticker) {
        const code = fixRussianLayout(sticker.trim());
        if (!code) return null;

        const { data, error } = await supabaseClient
            .from("places")
            .select("*")
            .eq("place_sticker", code)
            .maybeSingle();

        if (error) {
            console.error("Place lookup error", error);
            return null;
        }

        return data || null;
    }

    function closeWarehouseModal() {
        if (activeWarehouseModal) {
            activeWarehouseModal.remove();
            activeWarehouseModal = null;
        }
        pendingWarehouse = null;
    }

    async function applyWarehouseChange() {
        if (!currentUser || !pendingWarehouse) return;

        const targetWhId = pendingWarehouse.place.wh_id;
        const { error } = await supabaseClient
            .from("users")
            .update({ user_wh_id: targetWhId })
            .eq("id", String(currentUser.id));

        if (error) {
            MiniUI.toast("Не удалось сменить склад", { type: "error" });
            return;
        }

        currentUser.user_wh_id = targetWhId;
        currentWhName = pendingWarehouse.whName;

        updateLocalUser(currentUser, currentWhName);
        renderUser();

        const headerWh = document.getElementById("header-wh");
        if (headerWh) headerWh.textContent = currentWhName;

        closeWarehouseModal();
        MiniUI.toast("Склад пользователя обновлен", { type: "success" });
    }

    async function handleScannedPlace(scannedCode, resultBlock, placeEl, whEl) {
        const place = await lookupPlace(scannedCode);
        if (!place) {
            MiniUI.toast("МХ не найден", { type: "error" });
            return;
        }

        const whName = await getWarehouseNameById(place.wh_id);

        pendingWarehouse = {
            place,
            whName: whName || `Склад ID: ${place.wh_id || "-"}`
        };

        placeEl.textContent = `${place.place_name || "-"} (${place.place || "-"})`;
        whEl.textContent = pendingWarehouse.whName;
        resultBlock.style.display = "block";
    }

    function openWarehouseScanModal() {
        closeWarehouseModal();

        const modal = document.createElement("div");
        modal.className = "modal";
        modal.style.display = "flex";

        modal.innerHTML = `
            <div class="modal-content" style="width:360px;max-width:90%;padding:26px 28px 32px;box-sizing:border-box;">
                <div style="font-weight:600;margin-bottom:12px;">Отсканируйте МХ</div>
                <input class="input" placeholder="Сканируйте МХ" style="width:100%;display:block;box-sizing:border-box;margin:0;">
                <div class="scan-result" style="display:none;">
                    <div class="scan-result-row">МХ: <span data-place-name>-</span></div>
                    <div class="scan-result-row">Склад: <span data-wh-name>-</span></div>
                    <button class="btn btn-rect" data-wh-submit style="margin-top:8px;width:100%;">Сменить склад</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        activeWarehouseModal = modal;

        const input = modal.querySelector("input");
        const resultBlock = modal.querySelector(".scan-result");
        const placeNameEl = modal.querySelector("[data-place-name]");
        const whNameEl = modal.querySelector("[data-wh-name]");
        const submitBtn = modal.querySelector("[data-wh-submit]");

        setTimeout(() => {
            input.focus();
            input.select();
        }, 0);

        let buffer = "";

        input.addEventListener("keydown", async (e) => {
            if (e.key === "Escape") {
                closeWarehouseModal();
                return;
            }

            if (e.key === "Enter") {
                e.preventDefault();
                const scanned = (buffer || input.value || "").trim();
                buffer = "";
                input.value = "";

                if (!scanned) return;

                await handleScannedPlace(scanned, resultBlock, placeNameEl, whNameEl);
                return;
            }

            if (e.key.length === 1) {
                buffer += e.key;
            }
        });

        submitBtn.addEventListener("click", applyWarehouseChange);

        modal.addEventListener("click", (e) => {
            if (e.target === modal) {
                closeWarehouseModal();
            }
        });
    }

    function bindEvents() {
        badgeBtn.addEventListener("click", openBadgeModal);
        changePasswordBtn.addEventListener("click", openPasswordModal);
        syncWarehouseBtn.addEventListener("click", openWarehouseScanModal);
        badgeCloseBtn.addEventListener("click", closeBadgeModal);
        badgeDownloadBtn.addEventListener("click", downloadBadgeSticker);
        badgePrintBtn.addEventListener("click", printBadgeSticker);
        window.addEventListener("resize", () => {
            if (badgeModal && !badgeModal.classList.contains("hidden")) {
                syncBadgeModalLayout();
            }
        });

        badgeModal.addEventListener("click", (e) => {
            if (e.target === badgeModal) {
                closeBadgeModal();
            }
        });

        passwordCancelBtn.addEventListener("click", closePasswordModal);
        passwordSubmitBtn.addEventListener("click", submitPasswordChange);

        passwordModal.addEventListener("click", (e) => {
            if (e.target === passwordModal) {
                closePasswordModal();
            }
        });

        [oldPasswordInput, newPasswordInput, confirmPasswordInput].forEach((input) => {
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    submitPasswordChange();
                }
                if (e.key === "Escape") {
                    closePasswordModal();
                }
            });
        });
    }

    document.addEventListener("DOMContentLoaded", async () => {
        bindEvents();
        await loadCurrentUser();
    });
})();
