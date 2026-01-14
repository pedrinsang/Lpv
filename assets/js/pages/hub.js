/**
 * LPV - HUB / DASHBOARD SCRIPT
 * Gerencia: Display de usuário, Verificação de Admin e Alertas de Aniversário (Dinâmico).
 */

import { auth, db, onAuthStateChanged, signOut } from '../core.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
// IMPORTANTE: Agora importamos as funções dinâmicas do Firestore
import { fetchBirthdays, filterBirthdaysToday } from '../birthdays.js';

// Elementos do DOM
const userNameElement = document.getElementById("user-name");
const logoutBtn = document.getElementById("logout-btn");
const adminCard = document.getElementById("admin-card");
const birthdayContainer = document.getElementById('birthday-alert-container');

// ================================================================
// 1. MONITORAMENTO DE ESTADO (Auth & Role)
// ================================================================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // 1. Atualiza interface básica (Nome)
    updateUI(user);

    // 2. Verifica Aniversariantes do Dia (Agora busca no Banco)
    checkBirthdays();

    try {
        // 3. Verifica Permissões e Role no Firestore
        const userDoc = await getDoc(doc(db, "users", user.uid));
        
        if (userDoc.exists()) {
            const userData = userDoc.data();

            // Segurança: Se o usuário foi bloqueado enquanto estava logado, expulsa ele.
            if (userData.status !== 'aprovado') {
                alert("Seu acesso foi revogado ou ainda está pendente. Entre em contato com o administrador.");
                await signOut(auth);
                window.location.href = "auth.html";
                return;
            }

            // Lógica de Admin: Se for admin, remove a classe 'hidden' do cartão
            if (userData.role === 'admin') {
                if(adminCard) adminCard.classList.remove('hidden');
            }
        }
    } catch (error) {
        console.error("Erro ao buscar dados do usuário:", error);
    }

  } else {
    // Se não estiver logado, manda pro login
    window.location.href = "auth.html";
  }
});

// ================================================================
// 2. FUNÇÕES DE UI
// ================================================================

function updateUI(user) {
  if (userNameElement) {
    // Pega o primeiro nome para não ficar muito longo
    const fullName = user.displayName || "Usuário";
    userNameElement.textContent = fullName.split(' ')[0]; 
  }
}

// ================================================================
// 3. LÓGICA DE ANIVERSÁRIOS (Atualizada para Firestore)
// ================================================================
async function checkBirthdays() {
    if (!birthdayContainer) return;

    try {
        // 1. Busca a lista completa no Firestore (Assíncrono)
        const allBirthdays = await fetchBirthdays();
        
        // 2. Filtra localmente apenas os que fazem aniversário hoje
        const aniversariantes = filterBirthdaysToday(allBirthdays);

        if (aniversariantes.length > 0) {
            // Formata os nomes (ex: "João" ou "João e Maria")
            const listaNomes = aniversariantes.map(a => `<strong>${a.nome}</strong>`);
            let textoNomes = "";
            
            if (listaNomes.length === 1) {
                textoNomes = listaNomes[0];
            } else {
                const ultimo = listaNomes.pop();
                textoNomes = listaNomes.join(', ') + " e " + ultimo;
            }
            
            // Injeta o HTML do Banner Festivo
            birthdayContainer.innerHTML = `
                <div class="card fade-in" style="
                    background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 99%, #fecfef 100%);
                    border: none;
                    margin-bottom: 2rem;
                    display: flex;
                    align-items: center;
                    gap: 1.5rem;
                    color: #880e4f;
                    box-shadow: 0 8px 20px rgba(255, 154, 158, 0.4);
                ">
                    <div style="
                        background: white;
                        width: 60px; height: 60px;
                        border-radius: 50%;
                        display: flex; align-items: center; justify-content: center;
                        font-size: 1.8rem;
                        box-shadow: 0 4px 10px rgba(0,0,0,0.1);
                        flex-shrink: 0;
                    ">
                        🎉
                    </div>
                    <div>
                        <h3 style="margin: 0; font-size: 1.2rem; font-weight: 700;">Feliz Aniversário!</h3>
                        <p style="margin: 4px 0 0; font-size: 0.95rem;">
                            Hoje é dia de festa para: ${textoNomes}. Parabéns! 🎂
                        </p>
                    </div>
                </div>
            `;
        }
    } catch (e) {
        console.warn("Não foi possível carregar aniversários no Hub (pode ser erro de rede ou permissão):", e);
        // Em caso de erro, apenas não mostramos o banner, sem travar o app
    }
}

// ================================================================
// 4. LOGOUT
// ================================================================
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
        await signOut(auth);
        window.location.href = "auth.html";
    } catch (error) {
        console.error("Erro ao sair:", error);
    }
  });
}