/**
 * LPV - CORE JAVASCRIPT
 * Centraliza: Firebase, Auth Check, Dark Mode e PWA
 */

// 1. IMPORTAÇÕES DO FIREBASE (CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
// Se usar Firestore ou Analytics, importe aqui também:
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// 2. CONFIGURAÇÃO (COPIE DO SEU ANTIGO firebase-config.js)
const firebaseConfig = {
  apiKey: "AIzaSyBtVkq04DofTd1GvQAdi0p-Z2ctwuuC2Io",
  authDomain: "labpatvet-9e06a.firebaseapp.com",
  projectId: "labpatvet-9e06a",
  storageBucket: "labpatvet-9e06a.firebasestorage.app",
  messagingSenderId: "845095292264",
  appId: "1:845095292264:web:0c03bfecdf69d318d5dadd",
  measurementId: "G-G27RV552EM"
};

// 3. INICIALIZAÇÃO
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app); // Descomente se usar banco de dados

// 4. SISTEMA DE TEMA (DARK MODE)
function initThemeSystem() {
    const themeToggle = document.getElementById('theme-toggle');
    
    // Sincroniza ícone inicial
    if (themeToggle) {
        const currentTheme = localStorage.getItem('theme');
        const icon = themeToggle.querySelector('i');
        
        if (currentTheme === 'dark' && icon) {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        }

        // Evento de Clique
        themeToggle.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const icon = themeToggle.querySelector('i');

            if (isDark) {
                // Mudar para Light
                document.documentElement.removeAttribute('data-theme');
                localStorage.setItem('theme', 'light');
                if (icon) {
                    icon.classList.remove('fa-sun');
                    icon.classList.add('fa-moon');
                }
            } else {
                // Mudar para Dark
                document.documentElement.setAttribute('data-theme', 'dark');
                localStorage.setItem('theme', 'dark');
                if (icon) {
                    icon.classList.remove('fa-moon');
                    icon.classList.add('fa-sun');
                }
            }
        });
    }
}

// 5. PWA (SERVICE WORKER)
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            // Ajuste o caminho se seu sw.js não estiver na raiz
            navigator.serviceWorker.register('/sw.js') // ou '../sw.js' dependendo da página
                .then(reg => console.log('✅ PWA: Service Worker registrado'))
                .catch(err => console.error('❌ PWA: Falha ao registrar', err));
        });
    }
}

// 6. AUTO-EXECUÇÃO
document.addEventListener('DOMContentLoaded', () => {
    initThemeSystem();
    registerServiceWorker();
});

// 7. EXPORTAÇÕES (Para usar em outros arquivos)
export { app, auth, db, onAuthStateChanged, signOut };  