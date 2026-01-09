/**
 * LPV - AUTHENTICATION SCRIPT
 * Gerencia: Login, Cadastro (com validação de código), PWA e Tema.
 */

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
// 0. LOGO SWITCHER (Troca logo Branco/Escuro conforme tema)
// ================================================================
function initLogoSwitcher() {
    const brandLogo = document.getElementById('brand-logo');
    if (!brandLogo) return;

    const updateLogo = () => {
        // Verifica se tem o atributo data-theme="dark" no HTML
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        
        // Se for Dark Mode -> Logo Original (LPV.png)
        // Se for Light Mode -> Logo Branco (LPV2.png) para contrastar com fundo azul
        if (isDark) {
            brandLogo.src = '../assets/images/LPV.png';
        } else {
            brandLogo.src = '../assets/images/LPV2.png';
        }
    };

    // Executa ao carregar
    updateLogo();

    // Observa mudanças no tema em tempo real
    const observer = new MutationObserver(updateLogo);
    observer.observe(document.documentElement, { 
        attributes: true, 
        attributeFilter: ['data-theme'] 
    });
}

// Inicializa assim que o DOM carregar
document.addEventListener('DOMContentLoaded', initLogoSwitcher);


// ================================================================
// 1. LOGIN (Com Verificação de Status: Pendente/Bloqueado)
// ================================================================
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const btn = loginForm.querySelector('button');
        const alert = document.getElementById('login-alert');

        setLoading(btn, true, 'Verificando permissões...');
        alert.classList.add('hidden');

        try {
            // 1. Autentica no Firebase Auth
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Verifica status no Firestore (Banco de Dados)
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);

            if (userDoc.exists()) {
                const userData = userDoc.data();
                
                if (userData.status === 'bloqueado') {
                    await signOut(auth);
                    throw new Error("Acesso negado: Sua conta foi bloqueada.");
                }
                
                if (userData.status === 'pendente') {
                    await signOut(auth);
                    throw new Error("Acesso em análise: Aguarde aprovação do administrador.");
                }
            } else {
                // Se o usuário existe no Auth mas não no Firestore (caso raro/antigo)
                // Criamos o doc básico como 'pendente' por segurança
                await setDoc(userDocRef, {
                    email: user.email,
                    name: user.displayName || "Sem Nome",
                    role: "user",
                    status: "pendente",
                    createdAt: new Date().toISOString()
                });
                await signOut(auth);
                throw new Error("Cadastro atualizado. Aguarde aprovação.");
            }

            // 3. Sucesso - Redireciona
            alert.textContent = 'Acesso Autorizado! Entrando...';
            alert.className = 'alert-message success';
            alert.classList.remove('hidden');
            setTimeout(() => window.location.href = 'hub.html', 1000);

        } catch (error) {
            console.error(error);
            let msg = error.message;
            // Traduções amigáveis
            if (error.code === 'auth/invalid-credential') msg = 'Email ou senha incorretos.';
            if (error.code === 'auth/user-not-found') msg = 'Usuário não encontrado.';
            if (error.code === 'auth/wrong-password') msg = 'Senha incorreta.';

            showAlert(alert, msg, 'error');
            setLoading(btn, false, 'Entrar');
        }
    });
}


// ================================================================
// 2. CADASTRO (Com Código Secreto + Confirmação de Senha)
// ================================================================
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Coleta valores
        const name = document.getElementById('register-name').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;
        const confirmPassword = document.getElementById('register-confirm-password').value;
        const inputCode = document.getElementById('register-code').value.trim();
        
        const btn = registerForm.querySelector('button');
        const alert = document.getElementById('register-alert');

        // Validação Local: Senhas iguais
        if (password !== confirmPassword) {
            showAlert(alert, 'As senhas não coincidem.', 'error');
            return;
        }

        setLoading(btn, true, 'Validando Código...');
        alert.classList.add('hidden');

        try {
            // 1. Busca o Código Secreto no Firestore
            const configRef = doc(db, "config", "registration");
            const configSnap = await getDoc(configRef);

            let serverCode = "LPV2024"; // Fallback padrão
            
            if (configSnap.exists()) {
                serverCode = configSnap.data().secretCode || "LPV2024";
            } else {
                // Cria doc inicial se não existir (Bootstrap)
                await setDoc(configRef, { secretCode: "LPV2024" });
            }

            // 2. Compara Código
            if (inputCode !== serverCode) {
                throw new Error("Código de acesso inválido. Contate o administrador.");
            }

            // 3. Cria Usuário no Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            // Atualiza Nome
            await updateProfile(user, { displayName: name });

            // 4. Salva no Firestore como PENDENTE
            await setDoc(doc(db, "users", user.uid), {
                name: name,
                email: email,
                role: "user",      // Todo mundo nasce user
                status: "pendente", // Todo mundo nasce pendente
                createdAt: new Date().toISOString()
            });
            
            // 5. Desloga imediatamente (segurança)
            await signOut(auth);

            showAlert(alert, 'Solicitação enviada! Aguarde a liberação do administrador.', 'success');
            
            // Limpa o formulário
            registerForm.reset();
            setLoading(btn, false, 'Solicitar Acesso');

        } catch (error) {
            console.error(error);
            let msg = error.message;
            if (error.code === 'auth/email-already-in-use') msg = 'Este email já está cadastrado.';
            if (error.code === 'auth/weak-password') msg = 'A senha deve ter pelo menos 6 caracteres.';
            
            showAlert(alert, msg, 'error');
            setLoading(btn, false, 'Solicitar Acesso');
        }
    });
}


// ================================================================
// 3. PWA & MODAIS (Lógica de Instalação)
// ================================================================

// Utilitários de detecção
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

// Se já estiver instalado, esconde a área de instalação
if (isStandalone()) {
    if (installArea) installArea.style.display = 'none';
}

// Captura evento nativo do Chrome/Android
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

// Listener do Botão
if (installBtn) {
    installBtn.addEventListener('click', async () => {
        // Caso 1: Android/Chrome (Nativo)
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
            if (outcome === 'accepted') installArea.style.display = 'none';
            return;
        }
        
        // Caso 2: iPhone (Tutorial)
        if (isIOS()) {
            openModal('ios');
            return;
        }
        
        // Caso 3: Desktop/Incompatível (Aviso)
        openModal('error');
    });
}

// Helpers de Modal
function openModal(type) {
    modalIOS.classList.add('hidden');
    modalError.classList.add('hidden');
    
    if (type === 'ios') modalIOS.classList.remove('hidden');
    else modalError.classList.remove('hidden');
    
    pwaModal.classList.add('open');
}

// Fechar Modal (X ou Botão OK)
[document.getElementById('close-modal'), document.getElementById('btn-modal-ok')].forEach(btn => {
    if(btn) btn.addEventListener('click', () => pwaModal.classList.remove('open'));
});

// Fechar clicando fora
if (pwaModal) {
    pwaModal.addEventListener('click', (e) => {
        if (e.target === pwaModal) pwaModal.classList.remove('open');
    });
}


// ================================================================
// 4. HELPERS DE UI
// ================================================================

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