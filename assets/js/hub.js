import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { 
  getAuth, 
  onAuthStateChanged, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

// Inicializa Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Referências DOM
const userNameElement = document.getElementById("user-name");
const logoutBtn = document.getElementById("logout-btn");
const themeToggleBtn = document.getElementById("theme-toggle");

// ================================================================
// DARK MODE LOGIC
// ================================================================

function initTheme() {
  // Verificar preferência salva
  const savedTheme = localStorage.getItem("lpv-theme");
  
  // Se não houver salvo, verifica preferência do sistema
  if (!savedTheme) {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (prefersDark) {
      setTheme("dark");
    }
  } else {
    setTheme(savedTheme);
  }
}

function setTheme(theme) {
  const icon = themeToggleBtn.querySelector("i");
  
  if (theme === "dark") {
    document.body.setAttribute("data-theme", "dark");
    icon.classList.remove("fa-moon");
    icon.classList.add("fa-sun");
    localStorage.setItem("lpv-theme", "dark");
  } else {
    document.body.removeAttribute("data-theme");
    icon.classList.remove("fa-sun");
    icon.classList.add("fa-moon");
    localStorage.setItem("lpv-theme", "light");
  }
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const isDark = document.body.getAttribute("data-theme") === "dark";
    setTheme(isDark ? "light" : "dark");
  });
}

// Inicializa tema imediatamente
initTheme();

/**
 * Monitora o estado de autenticação
 */
onAuthStateChanged(auth, (user) => {
  if (user) {
    // Usuário está logado
    console.log("Usuário autenticado:", user.email);
    updateUI(user);
    document.body.classList.remove("loading"); // Remove loading state se houver
  } else {
    // Usuário não está logado -> Redireciona
    console.warn("Usuário não autenticado. Redirecionando...");
    window.location.href = "auth.html";
  }
});

/**
 * Atualiza a interface com dados do usuário
 * @param {object} user - Objeto de usuário do Firebase
 */
function updateUI(user) {
  if (userNameElement) {
    // Usa displayName se disponível, senão usa "Dr. Usuário" (fallback visual)
    // ou parte do email
    const name = user.displayName || "Dr. Usuário";
    userNameElement.textContent = name;
    
    // Atualiza saudação principal também se existir
    const welcomeName = document.querySelector(".welcome-title");
    if (welcomeName) {
        welcomeName.innerHTML = `Olá, ${name.split(' ')[0]}`;
    }
  }
}

/**
 * Função de Logout
 */
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      // O onAuthStateChanged vai lidar com o redirecionamento
    } catch (error) {
      console.error("Erro ao sair:", error);
      alert("Erro ao tentar sair. Tente novamente.");
    }
  });
}
