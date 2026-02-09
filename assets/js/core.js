/**
 * LPV - CORE SYSTEM (Versão Final v8.1 - Correção Theme Toggle)
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

console.log(">>> CORE.JS V8.1 CARREGADO <<<");

// --- CONFIGURAÇÃO ---
const firebaseConfig = {
  apiKey: "AIzaSyBtVkq04DofTd1GvQAdi0p-Z2ctwuuC2Io",
  authDomain: "labpatvet-9e06a.firebaseapp.com",
  projectId: "labpatvet-9e06a",
  storageBucket: "labpatvet-9e06a.firebasestorage.app",
  messagingSenderId: "845095292264",
  appId: "1:845095292264:web:0c03bfecdf69d318d5dadd",
  measurementId: "G-G27RV552EM"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

window.currentUserRole = null;

// --- TEMA ---
function initThemeSystem() {
    try {
        const themeToggleBtn = document.getElementById('theme-toggle');
        const html = document.documentElement;
        
        // 1. Verificar preferência salva ou do sistema
        const savedTheme = localStorage.getItem('theme');
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        // 2. Aplicar tema inicial
        if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
            html.setAttribute('data-theme', 'dark');
            updateThemeIcon(true);
        } else {
            html.removeAttribute('data-theme');
            updateThemeIcon(false);
        }

        // 3. Adicionar Listener (GARANTIA DE ÚNICA EXECUÇÃO)
        // Removemos qualquer listener anterior clone para evitar duplicidade
        if (themeToggleBtn) {
            // Clona e substitui o botão para limpar event listeners antigos (truque de segurança)
            const newBtn = themeToggleBtn.cloneNode(true);
            themeToggleBtn.parentNode.replaceChild(newBtn, themeToggleBtn);
            
            newBtn.addEventListener('click', () => {
                const isDark = html.getAttribute('data-theme') === 'dark';
                if (isDark) {
                    html.removeAttribute('data-theme');
                    localStorage.setItem('theme', 'light');
                    updateThemeIcon(false);
                } else {
                    html.setAttribute('data-theme', 'dark');
                    localStorage.setItem('theme', 'dark');
                    updateThemeIcon(true);
                }
            });
        }
    } catch(e) { console.log("Erro tema:", e); }
}

function updateThemeIcon(isDark) {
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
}

// --- MONITORAMENTO DE AUTH ---
onAuthStateChanged(auth, async (user) => {
    const currentPath = window.location.pathname;
    const isPagesDir = currentPath.includes('/pages/');
    const isPublicPage = currentPath.includes('auth.html') || 
                         currentPath.endsWith('/') || 
                         currentPath.includes('index.html') ||
                         currentPath.includes('resultados.html');
    
    const isAuthPage = currentPath.includes('auth.html');

    if (user) {
        // --- LOGADO ---
        console.log("Core: Usuário detectado:", user.uid);
        
        const userDoc = await getDoc(doc(db, "users", user.uid));
        
        if (userDoc.exists()) {
            const data = userDoc.data();
            const status = data.status || 'active';
            console.log("Core: Perfil encontrado. Status:", status);

            if (status === 'pending') {
                if (isAuthPage) {
                    console.log("Core: Usuário pendente na tela de Auth.");
                    return; 
                }
                console.warn("Core: Usuário pendente tentando acessar sistema.");
                await signOut(auth);
                if (!isAuthPage) window.location.href = isPagesDir ? 'auth.html' : 'pages/auth.html';
                return;
            }

            if (status === 'active' && (isAuthPage || currentPath.endsWith('/'))) {
                window.location.href = isPagesDir ? 'hub.html' : 'pages/hub.html';
                return;
            }

            if (!isPublicPage || currentPath.includes('hub.html')) {
                loadUserInterface(data, user.uid);
            }
        } else {
            console.log("⚠️ Core: Perfil não encontrado. Aguardando criação...");
        }
    } else {
        // --- DESLOGADO ---
        console.log("Core: Nenhum usuário logado.");
        if (!isPublicPage) {
            window.location.href = isPagesDir ? 'auth.html' : 'pages/auth.html';
        }
    }
});

function loadUserInterface(data, uid) {
    try {
        const fullName = data.name || "Usuário";
        const role = (data.role || "visitante").toLowerCase();
        const firstName = fullName.split(' ')[0];
        const displayRole = role.charAt(0).toUpperCase() + role.slice(1);

        window.currentUserRole = role; 

        const sidebarName = document.getElementById('sidebar-user-name');
        const sidebarRole = document.getElementById('sidebar-user-role');
        const headerBadge = document.getElementById('user-role-badge');
        const mobileName = document.getElementById('mobile-user-name');

        if (sidebarName) sidebarName.textContent = fullName;
        if (sidebarRole) sidebarRole.textContent = displayRole;
        if (headerBadge) headerBadge.textContent = displayRole;
        if (mobileName) mobileName.textContent = firstName;

        const pName = document.getElementById('profile-display-name');
        if (pName) {
            const pRole = document.getElementById('profile-display-role');
            const pEmail = document.getElementById('profile-display-email');
            const pUid = document.getElementById('profile-display-uid');
            if (pRole) pRole.textContent = displayRole;
            if (pEmail) pEmail.textContent = auth.currentUser.email;
            if (pUid) pUid.textContent = uid;
            pName.textContent = fullName;
        }

        applyRolePermissions(role);
    } catch(e) { console.error("Erro UI:", e); }
}

function applyRolePermissions(role) {
    const newBtnSidebar = document.querySelector('.btn-sidebar-new');
    const newFabMobile = document.querySelector('.nav-fab');
    const isSuperUser = (role === 'professor' || role === 'admin');

    if (role === 'estagiario') {
        if (newBtnSidebar) newBtnSidebar.style.display = 'none';
        if (newFabMobile) newFabMobile.style.display = 'none';
    }

    if (isSuperUser) {
        const adminCards = document.querySelectorAll('#admin-card');
        adminCards.forEach(card => card.classList.remove('hidden'));
    }

    const observer = new MutationObserver(() => {
        const statusSelect = document.getElementById('task-status');
        if (!isSuperUser && statusSelect) {
            for (let i = 0; i < statusSelect.options.length; i++) {
                const val = statusSelect.options[i].value;
                if (val === 'completed' || val === 'released' || val === 'liberado') {
                    statusSelect.options[i].style.display = 'none';
                    statusSelect.options[i].disabled = true;
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// --- FUNÇÃO DE LOGOUT GLOBAL ---
async function logout() {
    try {
        await signOut(auth);
        console.log("Logout realizado com sucesso.");
    } catch (error) {
        console.error("Erro ao fazer logout:", error);
    }
}

// --- INICIALIZAÇÃO ÚNICA (Correção da Duplicidade) ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Inicia o sistema de tema
    initThemeSystem();
    
    // 2. Configura botões de logout
    const logoutBtn = document.getElementById('logout-btn');
    const logoutProfile = document.getElementById('logout-btn-profile');
    
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    if (logoutProfile) logoutProfile.addEventListener('click', logout);
});

// EXPORTS
export { app, auth, db, initThemeSystem, signOut, logout };