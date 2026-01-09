/**
 * LPV - HUB / DASHBOARD SCRIPT
 */

import { auth, db, onAuthStateChanged, signOut } from '../core.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Elementos
const userNameElement = document.getElementById("user-name");
const logoutBtn = document.getElementById("logout-btn");
const adminCard = document.getElementById("admin-card");

// Monitoramento Auth
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // 1. Atualiza UI Básica
    updateUI(user);

    try {
        // 2. Busca dados extras no Firestore (Role e Status)
        const userDoc = await getDoc(doc(db, "users", user.uid));
        
        if (userDoc.exists()) {
            const userData = userDoc.data();

            // Verificação de Segurança Extra (caso o admin bloqueie enquanto o usuário está logado)
            if (userData.status !== 'aprovado') {
                alert("Seu acesso foi revogado. Entre em contato com o administrador.");
                await signOut(auth);
                window.location.href = "auth.html";
                return;
            }

            // Mostra botão Admin se for admin
            if (userData.role === 'admin') {
                if(adminCard) adminCard.classList.remove('hidden');
            }
        }
    } catch (error) {
        console.error("Erro ao buscar dados do usuário:", error);
    }

  } else {
    window.location.href = "auth.html";
  }
});

function updateUI(user) {
  if (userNameElement) {
    const name = user.displayName || "Usuário";
    userNameElement.textContent = name;
    
    const welcomeName = document.querySelector(".welcome-title");
    if (welcomeName) {
        welcomeName.innerHTML = `Olá, ${name.split(' ')[0]}`;
    }
  }
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "auth.html";
  });
}