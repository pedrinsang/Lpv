import { auth, db } from '../core.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    signOut,
    deleteUser
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { 
    doc, 
    setDoc,
    getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginContainer = document.getElementById('login-container');
const registerContainer = document.getElementById('register-container');
const showRegisterBtn = document.getElementById('show-register');
const showLoginBtn = document.getElementById('show-login');

// =========================================================
// RATE LIMITING — Bloqueio após 5 tentativas de login falhas
// Sem custo, funciona 100% no navegador (localStorage)
// =========================================================
const MAX_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutos

function getLoginAttempts() {
    const raw = localStorage.getItem('login_attempts');
    if (!raw) return { count: 0, blockedUntil: null };
    try { return JSON.parse(raw); } catch { return { count: 0, blockedUntil: null }; }
}

function saveLoginAttempts(data) {
    localStorage.setItem('login_attempts', JSON.stringify(data));
}

function registerFailedAttempt() {
    const data = getLoginAttempts();
    data.count += 1;
    if (data.count >= MAX_ATTEMPTS) {
        data.blockedUntil = Date.now() + BLOCK_DURATION_MS;
        data.count = 0; // reseta contador para próximo ciclo
    }
    saveLoginAttempts(data);
}

function resetLoginAttempts() {
    localStorage.removeItem('login_attempts');
}

function isLoginBlocked() {
    const data = getLoginAttempts();
    if (!data.blockedUntil) return false;
    if (Date.now() < data.blockedUntil) return true;
    resetLoginAttempts(); // desbloqueio automático após o tempo
    return false;
}

function getRemainingBlockTime() {
    const data = getLoginAttempts();
    if (!data.blockedUntil) return 0;
    return Math.ceil((data.blockedUntil - Date.now()) / 1000 / 60); // em minutos
}

// =========================================================
// ALTERNÂNCIA DE TELAS
// =========================================================
if (showRegisterBtn) {
    showRegisterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        loginContainer.classList.add('hidden');
        registerContainer.classList.remove('hidden');
    });
}
if (showLoginBtn) {
    showLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        registerContainer.classList.add('hidden');
        loginContainer.classList.remove('hidden');
    });
}

// =========================================================
// LOGIN
// =========================================================
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-password').value;
        const alertBox = document.getElementById('login-alert');
        const btn = loginForm.querySelector('button');

        // Verifica bloqueio por tentativas excessivas
        if (isLoginBlocked()) {
            showAlert(alertBox, `Muitas tentativas incorretas. Aguarde ${getRemainingBlockTime()} minuto(s) para tentar novamente.`, 'error');
            return;
        }

        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
        btn.disabled = true;
        alertBox.classList.add('hidden');

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, pass);
            const user = userCredential.user;

            const userDoc = await getDoc(doc(db, "users", user.uid));
            
            if (userDoc.exists()) {
                const userData = userDoc.data();
                
                if (userData.status === 'pending') {
                    await signOut(auth);
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    showAlert(alertBox, "Cadastro aguardando aprovação do Professor.", "warning");
                    return;
                }
            }

            // Login bem-sucedido — limpa tentativas
            resetLoginAttempts();
            window.location.href = '../pages/hub.html';

        } catch (error) {
            btn.innerHTML = originalText;
            btn.disabled = false;

            // Registra tentativa falha apenas para erros de credencial
            const credentialErrors = [
                'auth/wrong-password',
                'auth/user-not-found',
                'auth/invalid-credential',
                'auth/invalid-email'
            ];
            if (credentialErrors.includes(error.code)) {
                registerFailedAttempt();
            }

            // Mensagem GENÉRICA — não revela se o email existe ou não
            showAlert(alertBox, "Email ou senha inválidos. Verifique seus dados e tente novamente.", 'error');
        }
    });
}

// =========================================================
// CADASTRO
// =========================================================
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const inputCode = document.getElementById('reg-access-code').value.trim();
        const pass = document.getElementById('reg-pass').value;
        const confirm = document.getElementById('reg-confirm').value;
        const alertBox = document.getElementById('register-alert');
        const btn = registerForm.querySelector('button');

        alertBox.classList.add('hidden');

        // Validações no frontend
        if (pass !== confirm) {
            showAlert(alertBox, "As senhas não coincidem.", 'error');
            return;
        }

        if (pass.length < 8) {
            showAlert(alertBox, "A senha deve ter pelo menos 8 caracteres.", 'error');
            return;
        }

        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando código...';
        btn.disabled = true;
        let createdAuthUser = null;

        try {
            // 1. Valida Código de Acesso
            const codeRef = doc(db, "config", "registration");
            const codeSnap = await getDoc(codeRef);

            if (!codeSnap.exists()) {
                showAlert(alertBox, "Erro de configuração. Contate o administrador.", 'error');
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }

            const serverCode = codeSnap.data().access_code;

            if (serverCode !== inputCode) {
                showAlert(alertBox, "Código de acesso inválido.", 'error');
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }

            // 2. Cria Usuário no Firebase Auth
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Criando conta...';
            const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
            const user = userCredential.user;
            createdAuthUser = user;

            // 3. Salva perfil no Firestore com status pendente
            await setDoc(doc(db, "users", user.uid), {
                name: name,
                email: email,
                role: ['estagiario'], 
                status: 'pending',
                crmv: '',
                canSelfSignReports: false,
                signatureBase64: null,
                createdAt: new Date()
            });

            // 4. Desloga imediatamente — exige aprovação do professor
            await signOut(auth);

            btn.innerHTML = originalText;
            btn.disabled = false;

            registerContainer.classList.add('hidden');
            loginContainer.classList.remove('hidden');
            const loginAlert = document.getElementById('login-alert');
            showAlert(loginAlert, "Conta criada! Aguarde aprovação do Professor.", "warning");

        } catch (error) {
            btn.innerHTML = originalText;
            btn.disabled = false;

            // Se o perfil falhar por permissão após criar Auth, remove conta órfã.
            if (error?.code === 'permission-denied' && createdAuthUser) {
                try {
                    await deleteUser(createdAuthUser);
                } catch (cleanupError) {
                    console.error('Falha ao limpar usuario criado sem perfil:', cleanupError);
                }
            }

            // Log técnico para facilitar depuração no navegador.
            console.error('Erro no cadastro:', {
                code: error?.code,
                message: error?.message,
                name: error?.name
            });

            let msg = getRegisterErrorMessage(error);
            showAlert(alertBox, msg, 'error');
        }
    });
}

function getRegisterErrorMessage(error) {
    const code = error?.code;

    const knownErrors = {
        'auth/email-already-in-use': 'Este email ja possui cadastro.',
        'auth/invalid-email': 'Formato de email invalido.',
        'auth/weak-password': 'Senha muito fraca. Use pelo menos 8 caracteres.',
        'auth/network-request-failed': 'Falha de conexao. Verifique sua internet e tente novamente.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
        'permission-denied': 'Sem permissao para concluir o cadastro. Contate o administrador.',
        'unavailable': 'Servico temporariamente indisponivel. Tente novamente em instantes.'
    };

    if (code && knownErrors[code]) {
        return knownErrors[code];
    }

    if (code) {
        return `Erro no cadastro (${code}). Tente novamente.`;
    }

    if (error?.message) {
        return `Erro no cadastro: ${error.message}`;
    }

    return 'Ocorreu um erro no cadastro. Tente novamente.';
}

// =========================================================
// HELPER — Exibe alertas com segurança (sem XSS)
// Usa textContent em vez de innerHTML
// =========================================================
function showAlert(element, message, type) {
    if (!element) return;
    element.textContent = message; // ✅ seguro contra XSS
    element.className = `alert-message ${type}`; 
    element.classList.remove('hidden');
}

// =========================================================
// LÓGICA DE INSTALAÇÃO PWA
// =========================================================
let deferredPrompt; 
const installBtn = document.getElementById('btn-install-pwa');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.classList.remove('hidden');
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        installBtn.classList.add('hidden');
    });
}

window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.classList.add('hidden');
});