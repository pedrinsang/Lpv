import { auth, db } from '../core.js'; 
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// DOM Elements
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const installArea = document.getElementById('pwa-install-area');
const installBtn = document.getElementById('btn-install');
const pwaModal = document.getElementById('pwa-modal');
const modalIOS = document.getElementById('modal-content-ios');
const modalError = document.getElementById('modal-content-error');

let deferredPrompt; 

// ================================================================
// 1. LOGIN (Com Verificação de Aprovação)
// ================================================================
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const btn = loginForm.querySelector('button');
        const alert = document.getElementById('login-alert');

        setLoading(btn, true, 'Verificando...');
        alert.classList.add('hidden');

        try {
            // 1. Autentica no Firebase Auth
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Verifica status no Firestore
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);

            if (userDoc.exists()) {
                const userData = userDoc.data();
                
                if (userData.status === 'bloqueado') {
                    await signOut(auth);
                    throw new Error("Sua conta foi bloqueada pelo administrador.");
                }
                
                if (userData.status === 'pendente') {
                    await signOut(auth);
                    throw new Error("Sua conta aguarda aprovação do administrador.");
                }
            } else {
                // Se o usuário existe no Auth mas não no Firestore (caso antigo ou erro), criamos o doc básico
                // mas mantemos pendente por segurança.
                await setDoc(userDocRef, {
                    email: user.email,
                    name: user.displayName || "Sem Nome",
                    role: "user",
                    status: "pendente",
                    createdAt: new Date()
                });
                await signOut(auth);
                throw new Error("Cadastro atualizado. Aguarde aprovação.");
            }

            // 3. Sucesso - Redireciona
            alert.textContent = 'Acesso Autorizado! Redirecionando...';
            alert.className = 'alert-message success';
            alert.classList.remove('hidden');
            setTimeout(() => window.location.href = 'hub.html', 1000);

        } catch (error) {
            console.error(error);
            let msg = error.message;
            // Traduções de erro do Firebase
            if (error.code === 'auth/invalid-credential') msg = 'Email ou senha incorretos.';
            if (error.code === 'auth/user-not-found') msg = 'Usuário não encontrado.';
            if (error.code === 'auth/wrong-password') msg = 'Senha incorreta.';

            alert.textContent = msg;
            alert.className = 'alert-message error';
            alert.classList.remove('hidden');
            setLoading(btn, false, 'Entrar');
        }
    });
}

// ================================================================
// 2. CADASTRO (Com Validação de Código e Senha)
// ================================================================
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Campos
        const name = document.getElementById('register-name').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;
        const confirmPassword = document.getElementById('register-confirm-password').value;
        const inputCode = document.getElementById('register-code').value.trim();
        
        const btn = registerForm.querySelector('button');
        const alert = document.getElementById('register-alert');

        // Validações Básicas
        if (password !== confirmPassword) {
            showAlert(alert, 'As senhas não coincidem.', 'error');
            return;
        }

        setLoading(btn, true, 'Validando Código...');
        alert.classList.add('hidden');

        try {
            // 1. Busca o Código Secreto no Firestore
            // A coleção será "config" e o documento "registration"
            const configRef = doc(db, "config", "registration");
            const configSnap = await getDoc(configRef);

            let serverCode = "LPV2024"; // Fallback se não existir configuração ainda
            
            if (configSnap.exists()) {
                serverCode = configSnap.data().secretCode || "LPV2024";
            } else {
                // Cria a configuração inicial se não existir
                await setDoc(configRef, { secretCode: "LPV2024" });
            }

            // 2. Compara Código
            if (inputCode !== serverCode) {
                throw new Error("Código de acesso incorreto.");
            }

            // 3. Cria Usuário no Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            await updateProfile(user, { displayName: name });

            // 4. Salva no Firestore como PENDENTE
            await setDoc(doc(db, "users", user.uid), {
                name: name,
                email: email,
                role: "user",      // Padrão é usuário comum
                status: "pendente", // Padrão é bloqueado até aprovação
                createdAt: new Date().toISOString()
            });
            
            // 5. Desloga (para ele não entrar direto) e Avisa
            await signOut(auth);

            showAlert(alert, 'Solicitação enviada! Aguarde a liberação do administrador.', 'success');
            
            // Limpa form
            registerForm.reset();
            setLoading(btn, false, 'Solicitar Acesso');

        } catch (error) {
            console.error(error);
            let msg = error.message;
            if (error.code === 'auth/email-already-in-use') msg = 'Este email já está cadastrado.';
            if (error.code === 'auth/weak-password') msg = 'Senha muito fraca (min 6).';
            
            showAlert(alert, msg, 'error');
            setLoading(btn, false, 'Solicitar Acesso');
        }
    });
}

// ================================================================
// 3. PWA & UTILS (Mantidos)
// ================================================================
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

if (isStandalone()) {
    if (installArea) installArea.style.display = 'none';
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
            if (outcome === 'accepted') installArea.style.display = 'none';
            return;
        }
        if (isIOS()) {
            openModal('ios');
            return;
        }
        openModal('error');
    });
}

function openModal(type) {
    modalIOS.classList.add('hidden');
    modalError.classList.add('hidden');
    if (type === 'ios') modalIOS.classList.remove('hidden');
    else modalError.classList.remove('hidden');
    pwaModal.classList.add('open');
}

[document.getElementById('close-modal'), document.getElementById('btn-modal-ok')].forEach(btn => {
    if(btn) btn.addEventListener('click', () => pwaModal.classList.remove('open'));
});

function setLoading(btn, loading, text) {
    btn.disabled = loading;
    btn.textContent = text;
    if(loading) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + text;
}

function showAlert(el, msg, type) {
    el.textContent = msg;
    el.className = `alert-message ${type}`;
    el.classList.remove('hidden');
}