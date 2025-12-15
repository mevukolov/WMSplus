(function () {

    if (typeof supabaseClient === "undefined") {
        console.error("supabaseClient missing — ui.js must be loaded first");
    }

    // DOM
    const tbody = document.getElementById("users-tbody");
    const btnAdd = document.getElementById("btn-add-user");

    // Modal
    const modal = document.getElementById("user-modal");
    const mTitle = document.getElementById("modal-title");
    const mId = document.getElementById("m-id");
    const mFio = document.getElementById("m-fio");
    const mPass = document.getElementById("m-pass");
    const mSave = document.getElementById("m-save");
    const mCancel = document.getElementById("m-cancel");
    const accessGroupsWrap = document.getElementById("access-groups");

    let users = [];
    let pages = [];
    let editModeUserId = null;

    // ===============================================
    // LOAD USERS
    // ===============================================

    async function loadUsers() {
        const { data, error } = await supabaseClient
            .from("users")
            .select("*")
            .order("id");

        if (error) {
            MiniUI.toast("Ошибка загрузки пользователей", { type: "error" });
            return;
        }

        users = data || [];
        renderUsers();
    }

    // ===============================================
    // LOAD PAGES → GROUPS
    // ===============================================

    async function loadPages() {
        const { data, error } = await supabaseClient
            .from("pages")
            .select("*")
            .order("menu_group", { ascending: true })
            .order("page_name", { ascending: true });

        if (error) {
            console.error(error);
            return;
        }

        pages = data || [];
    }

    // ===============================================
    // RENDER USERS TABLE
    // ===============================================

    function renderUsers() {
        tbody.innerHTML = "";

        users.forEach(u => {
            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td style="padding:8px;">${u.id}</td>
                <td style="padding:8px;">${u.fio || ""}</td>
                <td style="padding:8px;">${Array.isArray(u.accesses) ? u.accesses.join(", ") : ""}</td>
                <td style="padding:8px;white-space:nowrap;">
                    <button class="btn btn-outline" data-id="${u.id}" data-act="edit">✏️</button>
                    <button class="btn btn-outline" data-id="${u.id}" data-act="del">🗑️</button>
                </td>
            `;

            tr.querySelectorAll("button").forEach(b => {
                b.onclick = handleAction;
            });

            tbody.appendChild(tr);
        });
    }

    // ===============================================
    // OPEN MODAL (NEW / EDIT)
    // ===============================================

    function openModal(editUser = null) {
        modal.classList.remove("hidden");

        if (editUser) {
            editModeUserId = editUser.id;
            mTitle.textContent = "Редактировать пользователя";
            mId.value = editUser.id;
            mId.disabled = true;
            mFio.value = editUser.fio || "";
            mPass.value = editUser.pass || "";
        } else {
            editModeUserId = null;
            mTitle.textContent = "Новый пользователь";
            mId.value = "";
            mId.disabled = false;
            mFio.value = "";
            mPass.value = "";
        }

        buildAccessCheckboxes(editUser ? editUser.accesses || [] : []);
    }

    function closeModal() {
        modal.classList.add("hidden");
    }

    mCancel.onclick = closeModal;

    // ===============================================
    // BUILD ACCESS CHECKBOXES
    // ===============================================

    function buildAccessCheckboxes(activePages = []) {
        accessGroupsWrap.innerHTML = "";

        const groups = {};

        pages.forEach(p => {
            const g = p.menu_group || "Другое";
            if (!groups[g]) groups[g] = [];
            groups[g].push(p);
        });

        Object.keys(groups).forEach(groupName => {
            const block = document.createElement("div");
            block.style.marginBottom = "16px";

            const title = document.createElement("div");
            title.style.fontWeight = "700";
            title.style.marginBottom = "6px";
            title.textContent = groupName;

            block.appendChild(title);

            groups[groupName].forEach(p => {
                const label = document.createElement("label");
                label.style.display = "flex";
                label.style.alignItems = "center";
                label.style.gap = "6px";
                label.style.marginBottom = "4px";
                label.style.cursor = "pointer";

                const chk = document.createElement("input");
                chk.type = "checkbox";
                chk.value = p.page;
                chk.checked = activePages.includes(p.page);

                label.appendChild(chk);
                label.appendChild(document.createTextNode(p.page_name || p.url));

                block.appendChild(label);
            });

            accessGroupsWrap.appendChild(block);
        });
    }

    // ===============================================
    // ACTIONS (EDIT / DEL)
    // ===============================================

    async function handleAction(e) {
        const id = e.target.dataset.id;
        const act = e.target.dataset.act;

        if (!id) return;

        if (act === "edit") {
            const u = users.find(x => x.id === id);
            if (u) openModal(u);
        }

        if (act === "del") {
            const ok = await MiniUI.confirm("Удалить пользователя?", { title: "Удаление" });
            if (!ok) return;


            const { error } = await supabaseClient
                .from("users")
                .delete()
                .eq("id", id);

            if (error) {
                MiniUI.toast("Ошибка удаления", { type: "error" });
                return;
            }

            MiniUI.toast("Пользователь удалён", { type: "success" });
            await loadUsers();
        }
    }

    // ===============================================
    // SAVE USER (UPSERT)
    // ===============================================

    async function saveUser() {
        const id = mId.value.trim();
        const fio = mFio.value.trim();
        const pass = mPass.value.trim();

        if (!id) {
            MiniUI.toast("ID обязателен", { type: "warning" });
            return;
        }

        const checks = accessGroupsWrap.querySelectorAll("input[type=checkbox]");
        const accesses = Array.from(checks)
            .filter(ch => ch.checked)
            .map(ch => ch.value);

        const payload = {
            id,
            fio,
            pass,
            accesses
        };

        const { error } = await supabaseClient
            .from("users")
            .upsert(payload);

        if (error) {
            MiniUI.toast("Ошибка сохранения", { type: "error" });
            return;
        }

        MiniUI.toast("Сохранено", { type: "success" });

        closeModal();
        await loadUsers();
    }

    mSave.onclick = saveUser;

    btnAdd.onclick = () => openModal(null);

    // ===============================================
    // INIT
    // ===============================================

    (async () => {
        await loadPages();
        await loadUsers();
    })();

})();
