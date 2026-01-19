import { auth, db } from '../core.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { 
    doc, 
    setDoc,
    getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

console.log(">>> Auth.js carregado!");

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginContainer = document.getElementById('login-container');
const registerContainer = document.getElementById('register-container');
const showRegisterBtn = document.getElementById('show-register');
const showLoginBtn = document.getElementById('show-login');

// Alternância de Telas
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

// --- LOGIN ---
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log(">>> Iniciando Login...");
        
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-password').value;
        const alertBox = document.getElementById('login-alert');
        const btn = loginForm.querySelector('button');

        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
        btn.disabled = true;
        alertBox.classList.add('hidden');

        try {
            console.log("1. Autenticando...");
            const userCredential = await signInWithEmailAndPassword(auth, email, pass);
            const user = userCredential.user;
            console.log("2. Logado no Auth:", user.uid);

            console.log("3. Verificando Status no Firestore...");
            const userDoc = await getDoc(doc(db, "users", user.uid));
            
            if (userDoc.exists()) {
                const userData = userDoc.data();
                console.log("4. Dados do usuário:", userData);
                
                if (userData.status === 'pending') {
                    console.warn("BLOQUEIO: Usuário pendente.");
                    await signOut(auth);
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    showAlert(alertBox, "Cadastro aguardando aprovação do Professor.", "warning");
                    return;
                }
            } else {
                console.log("4. Usuário sem documento no banco (pode ser admin manual).");
            }

            console.log("5. Redirecionando...");
            window.location.href = '../pages/hub.html';

        } catch (error) {
            console.error("!!! ERRO NO LOGIN:", error);
            btn.innerHTML = originalText;
            btn.disabled = false;
            showAlert(alertBox, "Erro: " + error.message, 'error');
        }
    });
}

// --- CADASTRO ---
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log(">>> Iniciando Cadastro...");
        
        const name = document.getElementById('reg-name').value;
        const email = document.getElementById('reg-email').value;
        const inputCode = document.getElementById('reg-access-code').value.trim();
        const pass = document.getElementById('reg-pass').value;
        const confirm = document.getElementById('reg-confirm').value;
        const alertBox = document.getElementById('register-alert');
        const btn = registerForm.querySelector('button');

        alertBox.classList.add('hidden');

        if (pass !== confirm) {
            showAlert(alertBox, "As senhas não coincidem.", 'error');
            return;
        }

        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando código...';
        btn.disabled = true;

        try {
            // 1. Valida Código
            console.log("1. Buscando config/registration...");
            const codeRef = doc(db, "config", "registration");
            const codeSnap = await getDoc(codeRef);

            if (!codeSnap.exists()) {
                throw new Error("Documento de configuração não encontrado no banco! Verifique se criou a coleção 'config' e o documento 'registration'.");
            }

            const serverCode = codeSnap.data().access_code;
            console.log("2. Código do servidor:", serverCode);
            console.log("3. Código digitado:", inputCode);

            if (serverCode !== inputCode) {
                console.warn("Código inválido.");
                showAlert(alertBox, "Código de acesso inválido.", 'error');
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }

            // 2. Cria Usuário
            console.log("4. Código aceito. Criando usuário no Auth...");
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Criando conta...';
            
            // AQUI É ONDE GERALMENTE TRAVA SE TIVER PROBLEMA DE KEY
            const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
            const user = userCredential.user;
            console.log("5. Usuário Auth criado! UID:", user.uid);

            // 3. Salva no Firestore
            console.log("6. Salvando dados no Firestore...");
            await setDoc(doc(db, "users", user.uid), {
                name: name,
                email: email,
                role: 'estagiario', 
                status: 'pending',
                createdAt: new Date()
            });
            console.log("7. Dados salvos com sucesso!");

            // 4. Desloga
            console.log("8. Deslogando para exigir aprovação...");
            await signOut(auth);

            btn.innerHTML = originalText;
            btn.disabled = false;
            
            console.log("9. Finalizado. Voltando ao login.");
            registerContainer.classList.add('hidden');
            loginContainer.classList.remove('hidden');
            const loginAlert = document.getElementById('login-alert');
            showAlert(loginAlert, "Conta criada! Aguarde aprovação do Professor.", "warning");

        } catch (error) {
            console.error("!!! ERRO NO CADASTRO:", error);
            btn.innerHTML = originalText;
            btn.disabled = false;
            
            let msg = error.message;
            if (error.code === 'auth/email-already-in-use') msg = "Email já cadastrado.";
            if (error.code === 'permission-denied') msg = "Erro de permissão no banco de dados.";
            
            showAlert(alertBox, "Erro: " + msg, 'error');
        }
    });
}

function showAlert(element, message, type) {
    if (!element) return;
    element.innerHTML = message;
    element.className = `alert-message ${type}`; 
    element.classList.remove('hidden');
}