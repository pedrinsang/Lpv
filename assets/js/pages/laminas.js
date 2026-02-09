import { db, auth, logout } from '../core.js';
import { collection, addDoc, query, orderBy, onSnapshot, deleteDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const listContainer = document.getElementById('slide-list');
const totalDisplay = document.getElementById('total-count');
const formAdd = document.getElementById('form-add-slide');
const dateInput = document.getElementById('input-date');

// Modal de Rodízio
const rodizioModal = document.getElementById('rodizio-modal');
const rodizioTargetSpan = document.getElementById('rodizio-target');

// Define data de hoje no input
if(dateInput) dateInput.value = new Date().toISOString().split('T')[0];

// --- LISTENERS DE LOGOUT ---
const btnLogout = document.getElementById('btn-logout');
if(btnLogout) btnLogout.addEventListener('click', logout);

// --- ESTADO LOCAL ---
let previousTotal = -1; // Começa com -1 para indicar que é o primeiro carregamento

// --- CARREGAR DADOS ---
const q = query(collection(db, "slide_records"), orderBy("date", "desc"));

onSnapshot(q, (snapshot) => {
    let currentTotal = 0;
    const items = [];

    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        items.push({ id: docSnap.id, ...data });
        currentTotal += parseInt(data.quantity || 0);
    });

    // Renderiza a lista
    renderList(items);
    
    // Atualiza o total na tela
    if(totalDisplay) totalDisplay.textContent = currentTotal;

    // --- LÓGICA DO AVISO DE RODÍZIO (AO PASSAR DE 80, 160, 240...) ---
    
    // Só verifica se NÃO for o primeiro carregamento da página
    if (previousTotal !== -1) {
        // Calcula em qual "bloco de 80" estávamos e em qual estamos agora
        // Ex: 75 / 80 = 0.xx (bloco 0)
        // Ex: 85 / 80 = 1.xx (bloco 1) -> Mudou de bloco!
        const oldMilestone = Math.floor(previousTotal / 80);
        const newMilestone = Math.floor(currentTotal / 80);

        // Se o novo bloco for maior que o antigo, significa que cruzamos uma barreira de 80
        if (newMilestone > oldMilestone) {
            if(rodizioModal && rodizioTargetSpan) {
                // Mostra qual marca foi atingida (Ex: 80, 160...)
                rodizioTargetSpan.textContent = newMilestone * 80;
                rodizioModal.classList.remove('hidden');
            }
        }
    }
    
    // Atualiza o total anterior para a próxima verificação
    previousTotal = currentTotal;
});

function renderList(items) {
    if(items.length === 0) {
        listContainer.innerHTML = `<div style="text-align:center; color:var(--text-tertiary); padding:2rem;">Nenhum registro encontrado.</div>`;
        return;
    }

    listContainer.innerHTML = items.map((item, index) => {
        const dateFormatted = new Date(item.date).toLocaleDateString('pt-BR');
        
        return `
        <div class="slide-row fade-in" style="--card-index: ${index}">
            <div class="slide-data">
                <i class="far fa-calendar-alt"></i> ${dateFormatted}
            </div>
            
            <div class="slide-qtd">
                ${item.quantity} un.
            </div>

            <div class="slide-type">
                ${item.type}
            </div>

            <button class="btn-icon btn-delete-row" onclick="window.deleteSlideRecord('${item.id}')" style="color:var(--text-tertiary);">
                <i class="fas fa-trash-alt"></i>
            </button>
        </div>
        `;
    }).join('');
}

// --- ADICIONAR REGISTRO ---
if(formAdd) {
    formAdd.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = formAdd.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
        btn.disabled = true;

        const formData = new FormData(formAdd);
        const data = Object.fromEntries(formData.entries());

        try {
            await addDoc(collection(db, "slide_records"), {
                date: data.date,
                quantity: parseInt(data.quantity),
                type: data.type,
                createdBy: auth.currentUser?.uid,
                createdAt: serverTimestamp()
            });
            
            document.getElementById('add-slide-modal').classList.add('hidden');
            formAdd.reset();
            if(dateInput) dateInput.value = new Date().toISOString().split('T')[0];

        } catch (error) {
            console.error("Erro:", error);
            alert("Erro ao salvar.");
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });
}

// --- DELETAR ---
window.deleteSlideRecord = async (id) => {
    if(!confirm("Remover este registro?")) return;
    try {
        await deleteDoc(doc(db, "slide_records", id));
    } catch(e) {
        console.error(e);
    }
}