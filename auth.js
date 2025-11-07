// --- Авторизация ---
const loginBtn = document.getElementById('login-btn');
const loginId = document.getElementById('login-id');
const loginPass = document.getElementById('login-pass');
const loginError = document.getElementById('login-error');

loginBtn.addEventListener('click', async () => {
  const id = loginId.value.trim();
  const pass = loginPass.value;

  if(!id || !pass) return;

  loginBtn.disabled = true;

  try {
    // Пример: обращение к Google Apps Script
    const res = await fetch(`https://script.google.com/macros/s/AKfycbwU4yu8t8S5F3JEM-7q9eqNfACST7mBeB89FPonow3OV_nWiji5le2QZQE3PKB5sBnAjQ/exec?id=${encodeURIComponent(id)}&pass=${encodeURIComponent(pass)}`);
    const data = await res.json(); // ожидаем {success:true/false, user:{id, fio, accesses:[]}}

    if(data.success){
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = 'index.html';
    } else {
      loginError.style.display = 'block';
    }

  } catch(e) {
    loginError.textContent = 'Ошибка сервера';
    loginError.style.display = 'block';
  } finally {
    loginBtn.disabled = false;
  }
});
