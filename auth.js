// auth.js (Supabase RPC login)
const SUPABASE_URL = 'https://bgphllmzmlwurfnbagho.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// Подключение Supabase происходит через глобальный объект `supabase`
// Перед использованием убедитесь, что в HTML подключён UMD-бандл supabase-js
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js/dist/umd/supabase.min.js"></script>
// --- Авторизация ---
const loginBtn = document.getElementById('login-btn');
const loginId = document.getElementById('login-id');
const loginPass = document.getElementById('login-pass');
const loginError = document.getElementById('login-error');

if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
        const id = loginId.value.trim();
        const pass = loginPass.value;

        if(!id || !pass) {
            loginError.textContent = 'Введите ID и пароль';
            loginError.style.display = 'block';
            return;
        }

        loginBtn.disabled = true;
        loginError.style.display = 'none';

        try {
            const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
                email: id + '@wms.internal',
                password: pass,
            });

            if (authError || !authData?.user) {
                loginError.textContent = 'Неверный ID или пароль';
                loginError.style.display = 'block';
                return;
            }

            const { data, error } = await supabaseClient
                .from('users')
                .select('*')
                .eq('auth_uid', authData.user.id)
                .maybeSingle();

            if (error || !data) {
                console.error('Profile lookup error', error);
                loginError.textContent = 'Не удалось загрузить профиль';
                loginError.style.display = 'block';
                return;
            }

            // Приведём к ожидаемому формату {id, name/fio, accesses: []} --
            // same shape as before, minus `pass`: it's never sent to the
            // client anywhere in the new flow.
            const userObj = {
                id: data.id,
                name: data.fio || data.name || '',
                fio: data.fio || '',
                accesses: Array.isArray(data.accesses) ? data.accesses : (data.accesses ? [data.accesses] : [])
            };

            localStorage.setItem('user', JSON.stringify(userObj));
            window.location.href = 'index.html';

        } catch (e) {
            console.error('Login exception', e);
            loginError.textContent = 'Ошибка сервера, попробуйте позже';
            loginError.style.display = 'block';
        } finally {
            loginBtn.disabled = false;
        }
    });
}
