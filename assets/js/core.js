/**
 * LPV — CORE
 *
 * Firebase (Auth + Firestore), sessão, papéis do usuário e a casca comum das
 * páginas: tema, logout, sidebar mobile e registro do service worker.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import '../js/animations.js';

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
window.currentUserRoles = [];
let unsubscribeCurrentUserProfile = null;

const FULL_CONTROL_ROLES = ['admin', 'professor', 'pós graduando'];

function canonicalizeRole(rawRole) {
    if (!rawRole) return '';

    const normalized = rawRole
        .toString()
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (['admin', 'administrador', 'administradores'].includes(normalized)) {
        return 'admin';
    }
    if (['professor', 'professores'].includes(normalized)) {
        return 'professor';
    }
    if (['pos graduando', 'pos graduandos', 'posgraduando', 'posgraduandos'].includes(normalized)) {
        return 'pós graduando';
    }
    if (['estagiario', 'estagiarios'].includes(normalized)) {
        return 'estagiario';
    }

    return normalized;
}

/**
 * Normaliza o campo role (string ou array) para um array lowercase.
 * Compatível com formato antigo (string) e novo (array).
 */
function normalizeRoles(role) {
    if (!role) return [];
    const arr = Array.isArray(role) ? role : [role];
    return arr.map(canonicalizeRole).filter(Boolean);
}

/** Verifica se o usuário possui qualquer uma das roles listadas */
function hasAnyRole(role, targets) {
    const roles = normalizeRoles(role);
    const targetRoles = normalizeRoles(targets || []);
    return targetRoles.some(t => roles.includes(t));
}

/** Verifica se o usuário possui controle total no app */
function hasFullControl(role) {
    return hasAnyRole(role, FULL_CONTROL_ROLES);
}

/** Retorna a role "principal" para exibição */
function primaryRole(role) {
    const roles = normalizeRoles(role);
    const priority = ['admin', 'professor', 'pós graduando', 'pos-graduando', 'estagiario'];
    for (const p of priority) {
        if (roles.includes(p)) return p;
    }
    return roles[0] || 'visitante';
}

// --- TEMA (Sempre Dark) ---
function initThemeSystem() {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-force-motion', 'true');
    localStorage.setItem('theme', 'dark');
}

// --- MONITORAMENTO DE AUTH ---
onAuthStateChanged(auth, async (user) => {
    const currentPath = window.location.pathname;
    const isPagesDir = currentPath.includes('/pages/');

    // Qual página está aberta, pelo nome do arquivo e sem a extensão.
    //
    // Procurar a string "auth.html" no caminho não serve: hospedagem com "clean
    // URLs" (Vercel com a opção ligada, e o `npx serve` do desenvolvimento
    // local) entrega /pages/auth.html como /pages/auth. Sem o ".html" a tela de
    // login se achava página privada, e um visitante deslogado era mandado para
    // o login — de onde era mandado para o login de novo, sem parar.
    const pagina = (currentPath.split('/').pop() || '').replace(/\.html$/, '');

    const isAuthPage = pagina === 'auth';
    const isHubPage = pagina === 'hub';
    // Raiz do site ("" depois do split) e index são as páginas abertas.
    const isPublicPage = isAuthPage || pagina === '' || pagina === 'index';

    if (user) {
        // --- LOGADO ---
        if (unsubscribeCurrentUserProfile) {
            unsubscribeCurrentUserProfile();
            unsubscribeCurrentUserProfile = null;
        }
        
        const userDoc = await getDoc(doc(db, "users", user.uid));
        
        if (userDoc.exists()) {
            const data = userDoc.data();
            const status = data.status || 'active';

            if (status === 'pending') {
                // Na tela de login o próprio auth.js explica que falta aprovação.
                if (isAuthPage) return;
                console.warn("Core: Usuário pendente tentando acessar sistema.");
                await signOut(auth);
                if (!isAuthPage) window.location.href = isPagesDir ? 'auth.html' : 'pages/auth.html';
                return;
            }

            // Quem já está logado não fica na porta de entrada: vai para o Hub.
            if (status === 'active' && (isAuthPage || pagina === '' || pagina === 'index')) {
                window.location.href = isPagesDir ? 'hub.html' : 'pages/hub.html';
                return;
            }

            if (!isPublicPage || isHubPage) {
                loadUserInterface(data, user.uid);
            }

            // Mantém roles/perfil sincronizados em tempo real após login.
            unsubscribeCurrentUserProfile = onSnapshot(doc(db, "users", user.uid), (profileSnap) => {
                if (!profileSnap.exists()) return;

                const liveData = profileSnap.data();
                const liveStatus = liveData.status || 'active';

                if (liveStatus === 'pending') {
                    signOut(auth).catch(() => {});
                    return;
                }

                const liveRoles = normalizeRoles(liveData.role);
                window.currentUserRoles = liveRoles;
                window.currentUserRole = primaryRole(liveData.role);

                if (!isPublicPage || isHubPage) {
                    loadUserInterface(liveData, user.uid);
                }
            }, (err) => {
                console.warn('Core: falha ao sincronizar perfil em tempo real:', err);
            });
        } else {
            console.warn('Core: perfil não encontrado. Aguardando criação...');
        }
    } else {
        // --- DESLOGADO ---
        if (unsubscribeCurrentUserProfile) {
            unsubscribeCurrentUserProfile();
            unsubscribeCurrentUserProfile = null;
        }
        window.currentUserRole = null;
        window.currentUserRoles = [];

        if (!isPublicPage) {
            window.location.href = isPagesDir ? 'auth.html' : 'pages/auth.html';
        }
    }
});

function loadUserInterface(data, uid) {
    try {
        const fullName = data.name || "Usuário";
        const roles = normalizeRoles(data.role);
        const role = primaryRole(data.role);
        const firstName = fullName.split(' ')[0];
        const displayRole = roles.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(' / ');

        window.currentUserRole = role;
        window.currentUserRoles = roles; 

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
    const roles = normalizeRoles(role);
    const isSuperUser = hasFullControl(role);

    // Estagiário SEM role de super-user não pode criar entradas
    if (roles.includes('estagiario') && !isSuperUser) {
        if (newBtnSidebar) newBtnSidebar.style.display = 'none';
        if (newFabMobile) newFabMobile.style.display = 'none';
    }

    if (isSuperUser) {
        const adminCards = document.querySelectorAll('#admin-card');
        adminCards.forEach(card => card.classList.remove('hidden'));
        const adminSidebarLink = document.getElementById('sidebar-admin-link');
        if (adminSidebarLink) adminSidebarLink.classList.remove('hidden');
    }

}

// --- SERVICE WORKER (PWA) ---
//
// Registrado aqui, e não numa página só, porque o app instalado abre direto em
// `pages/auth.html`: quem entrava por lá ficava sem service worker e, sem ele,
// o navegador não oferece a instalação.
//
// O endereço sai de `import.meta.url` (este arquivo é /assets/js/core.js, logo
// o sw.js está dois níveis acima). Assim vale tanto na raiz do domínio quanto
// numa subpasta como o /Lpv/ do GitHub Pages.
if ('serviceWorker' in navigator) {
    const swUrl = new URL('../../sw.js', import.meta.url);
    navigator.serviceWorker.register(swUrl, { scope: new URL('./', swUrl).href })
        .catch((erro) => console.warn('Service worker não registrado:', erro));
}

// --- FUNÇÃO DE LOGOUT GLOBAL ---
async function logout() {
    try {
        await signOut(auth);
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

    // 3. Stagger animation indices para sidebar links
    document.querySelectorAll('.sidebar-link').forEach((link, i) => {
        link.style.setProperty('--link-index', i);
    });

    // 4. Sidebar mobile toggle (global)
    const menuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.querySelector('.desktop-sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    function toggleSidebar() {
        if (!sidebar) return;
        sidebar.classList.toggle('active');
        if (sidebarOverlay) sidebarOverlay.classList.toggle('active');
    }

    if (menuBtn) menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSidebar(); });
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', toggleSidebar);
});

// EXPORTS
export { app, auth, db, initThemeSystem, onAuthStateChanged, signOut, logout, normalizeRoles, hasAnyRole, hasFullControl, primaryRole, FULL_CONTROL_ROLES };