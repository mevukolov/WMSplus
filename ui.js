// --- Проверка авторизации и обновление доступа ---
async function checkUserAccess() {
  let user = JSON.parse(localStorage.getItem('user'));

  if(!user){
    window.location.href = 'login.html';
    return;
  }

  try {
    const res = await fetch(`https://your-api.com/getUser?id=${user.id}&pass=${user.pass}`);
    if(!res.ok) throw new Error('Не удалось обновить доступы');
    const freshUser = await res.json();

    if(freshUser.status !== 'ok'){
      window.location.href = 'login.html';
      return;
    }

    localStorage.setItem('user', JSON.stringify(freshUser));
    user = freshUser;

    updateUserName(user.name);
    filterMenu(user.accesses);

  } catch(err){
    console.error('Ошибка обновления данных пользователя:', err);
    updateUserName(user.name);
    filterMenu(user.accesses);
  }
}

function filterMenu(accesses){
  const sidebarLinks = document.querySelectorAll('#sidebar a');

  sidebarLinks.forEach(link => {
    const access = link.getAttribute('data-access');
    if(access){
      if(!accesses.includes('all') && !accesses.includes(access)){
        link.style.display = 'none';
      } else {
        link.style.display = '';
      }
    }
  });
}

// --- Отображение имени пользователя ---
function updateUserName(name){
  const nameEl = document.getElementById('user-name');
  if(nameEl && name){
    nameEl.textContent = name;
  }
}

// --- вызываем при загрузке ---
// --- вызываем при загрузке ---
document.addEventListener('DOMContentLoaded', () => {
  const userRaw = localStorage.getItem('user');
  if(!userRaw){
    window.location.href = 'login.html';
    return;
  }

  // ---- PAGE ACCESS VERIFY VIA META TAG ----
  const metaAccess = document.querySelector('meta[name="required-access"]');
  if(metaAccess){
      const required = metaAccess.getAttribute('content');
      const user = JSON.parse(localStorage.getItem('user'));

      if(user && !user.accesses.includes('all') && !user.accesses.includes(required)){
          localStorage.setItem('pendingToast', JSON.stringify({msg:'У вас нет доступа к этой странице.', type:'error'}));
          window.location.href = 'index.html';
      }
  }

  const user = JSON.parse(userRaw);
  updateUserName(user.name);
  filterMenu(user.accesses);
  checkUserAccess();

  // --- Logout кнопка ---
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('user');
      window.location.href = 'login.html';
    });
  }

  // --- pending toast on redirect ---
  const pending = localStorage.getItem('pendingToast');
  if(pending){
    const p = JSON.parse(pending);
    createToast(p.msg, {type: p.type});
    localStorage.removeItem('pendingToast');
  }
});


// --- Toast manager ---
const toastsRoot = document.getElementById('toasts');
function createToast(message, opts = {}) {
  const { duration = 3000, type = 'default' } = opts;
  const el = document.createElement('div');
  el.className = 'toast';
  el.role = 'status';
  el.tabIndex = 0;

  if(type === 'success') el.style.background = 'linear-gradient(90deg,#16a34a,#059669)';
  if(type === 'error') el.style.background = 'linear-gradient(90deg,#ef4444,#dc2626)';
  if(type === 'info') el.style.background = 'linear-gradient(90deg,#2563eb,#1e40af)';

  el.innerHTML = '<div style="flex:1;padding-right:8px">'+message+'</div><button aria-label="Закрыть" style="background:transparent;border:0;color:rgba(255,255,255,0.9);font-weight:700;cursor:pointer">✕</button>';
  const btn = el.querySelector('button');
  btn.addEventListener('click', () => removeToast(el));
  if(toastsRoot) toastsRoot.appendChild(el);
  el.focus();

  const timer = setTimeout(()=> removeToast(el), duration);
  el._timer = timer;

  function removeToast(node){
    if(!node) return;
    clearTimeout(node._timer);
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(()=> node.remove(), 180);
  }
  return el;
}

// --- Demo buttons ---
const toastOk = document.getElementById('toast-ok');
if(toastOk) toastOk.addEventListener('click', () => { createToast('Успешно сохранено!', {type:'success'}); });

const toastInfo = document.getElementById('toast-info');
if(toastInfo) toastInfo.addEventListener('click', () => { createToast('Информационное сообщение', {type:'info'}); });

const toastErr = document.getElementById('toast-err');
if(toastErr) toastErr.addEventListener('click', () => { createToast('Ошибка при сохранении', {type:'error'}); });

// --- Loader control ---
const loader = document.getElementById('loader');
if(loader) loader.style.display = 'none';

const startBtn = document.getElementById('start-loading');
if(startBtn && loader) startBtn.addEventListener('click', () => { loader.style.display = 'block'; loader.setAttribute('aria-hidden','false'); });

const stopBtn = document.getElementById('stop-loading');
if(stopBtn && loader) stopBtn.addEventListener('click', () => { loader.style.display = 'none'; loader.setAttribute('aria-hidden','true'); });

// --- Buttons interactions ---
const btnPrimary = document.getElementById('btn-primary');
if(btnPrimary) btnPrimary.addEventListener('click', () => { createToast('Нажата прямоугольная кнопка', {type:'info'}); });

const btnRound = document.getElementById('btn-round');
if(btnRound) btnRound.addEventListener('click', () => { createToast('Нажата круглая кнопка', {type:'info'}); });

const btnSquare = document.getElementById('btn-square');
if(btnSquare) btnSquare.addEventListener('click', () => { createToast('Нажата квадратная кнопка', {type:'info'}); });

// --- Switch ---
const sw = document.getElementById('demo-switch');
const swState = document.getElementById('switch-state');
function setSwitch(on, emitEvent = true){
  if(!sw || !swState) return;
  if(on){
    sw.classList.add('on');
    sw.setAttribute('aria-checked','true');
    swState.textContent = 'Включено';
  } else {
    sw.classList.remove('on');
    sw.setAttribute('aria-checked','false');
    swState.textContent = 'Отключено';
  }
  if(emitEvent){
    const e = new CustomEvent('switch:change', {detail:{checked:on}});
    sw.dispatchEvent(e);
  }
}
if(sw){
  sw.addEventListener('click', () => setSwitch(!(sw.classList.contains('on'))));
  sw.addEventListener('keydown', (ev) => { if(ev.key === ' ' || ev.key === 'Enter'){ ev.preventDefault(); setSwitch(!(sw.classList.contains('on'))); } });
  setSwitch(false);
  sw.addEventListener('switch:change', (e) => { createToast('Переключатель: ' + (e.detail.checked ? 'ON' : 'OFF'), {type:'info', duration:1200}); });
}

// --- Tooltip hack for touch ---
const tooltips = document.querySelectorAll('.tooltip-wrapper');
tooltips.forEach(t => {
  let opened = false;
  t.addEventListener('click', (ev) => {
    if(window.matchMedia('(hover: none)').matches){
      opened = !opened;
      const bubble = t.querySelector('.tooltip-bubble');
      if(opened){
        bubble.style.opacity = '1';
        bubble.style.transform = 'translate(-50%,-12px)';
      } else {
        bubble.style.opacity = '';
        bubble.style.transform = '';
      }
    }
  });
});

// --- Select demo ---
const demoSelect = document.getElementById('demo-select');
if(demoSelect) demoSelect.addEventListener('change', (e) => { createToast('Выбрано: ' + e.target.value, {type:'info', duration:900}); });

// --- Input demo ---
const demoInput = document.getElementById('demo-input');
if(demoInput) demoInput.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ createToast('Введено: ' + e.target.value, {type:'success', duration:1400}); } });

// --- MiniUI API ---
window.MiniUI = {
  toast: createToast,
  setLoaderVisible: (v) => { if(loader){ loader.style.display = v ? 'block' : 'none'; loader.setAttribute('aria-hidden', v ? 'false' : 'true'); } },
  setSwitch
};

// --- Sidebar menu ---
const menuBtn = document.getElementById('menu-btn');
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('menu-overlay');

if(menuBtn && sidebar && overlay){
  menuBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  });

  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
  });
}
