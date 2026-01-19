import { db } from '../core.js';
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const inputCode = document.getElementById('access-code');
const btnSearch = document.getElementById('btn-search');
const feedback = document.getElementById('search-feedback');
const resultDisplay = document.getElementById('result-display');

// Elementos do Resultado
const resStatus = document.getElementById('res-status-badge');
const resPet = document.getElementById('res-pet-name');
const resOwner = document.getElementById('res-owner');
const resDate = document.getElementById('res-date');
const resDesc = document.getElementById('res-desc');
const downloadArea = document.getElementById('download-area');
const pendingMsg = document.getElementById('pending-msg');
const btnPdf = document.getElementById('btn-download-pdf');

// Formatar Input para Uppercase
inputCode.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
});

// Ação de Busca
btnSearch.addEventListener('click', performSearch);
inputCode.addEventListener('keypress', (e) => {
    if(e.key === 'Enter') performSearch();
});

async function performSearch() {
    const code = inputCode.value.trim();
    
    // Resetar UI
    resultDisplay.classList.add('hidden');
    feedback.textContent = '';
    feedback.style.color = 'var(--text-secondary)';

    if (!code) {
        showError('Por favor, digite o código.');
        return;
    }

    // Feedback visual
    btnSearch.innerHTML = '<i class="fas fa-spinner fa-spin"></i> BUSCANDO...';
    btnSearch.disabled = true;

    try {
        // Busca na coleção 'tasks' onde 'accessCode' é igual ao digitado
        const q = query(collection(db, "tasks"), where("accessCode", "==", code));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            showError('Código não encontrado ou inválido.');
        } else {
            // Sucesso - Pega o primeiro documento encontrado
            const docData = querySnapshot.docs[0].data();
            renderResult(docData);
        }

    } catch (error) {
        console.error(error);
        showError('Erro ao conectar com o servidor.');
    } finally {
        btnSearch.innerHTML = '<i class="fas fa-search"></i> CONSULTAR';
        btnSearch.disabled = false;
    }
}

function renderResult(data) {
    // 1. Preencher Textos
    resPet.textContent = data.petName || "Pet Sem Nome";
    resOwner.textContent = `Tutor: ${data.ownerName || "Não informado"}`;
    resDesc.textContent = data.description || "Sem descrição";
    
    // Formatar Data
    if (data.createdAt) {
        const date = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
        resDate.textContent = date.toLocaleDateString('pt-BR');
    }

    // 2. Lógica de Status
    const status = data.status || 'pending';
    
    if (status === 'completed' || status === 'released') {
        resStatus.textContent = "LAUDO DISPONÍVEL";
        resStatus.className = "status-badge-large st-done";
        
        downloadArea.classList.remove('hidden');
        pendingMsg.classList.add('hidden');
        
        // Link do PDF (se existir no banco)
        if (data.reportUrl) {
            btnPdf.href = data.reportUrl;
            btnPdf.classList.remove('disabled');
        } else {
            btnPdf.href = "#";
            btnPdf.textContent = "PDF Processando...";
            btnPdf.classList.add('disabled');
        }
    } else {
        resStatus.textContent = "EM ANÁLISE";
        resStatus.className = "status-badge-large st-pending";
        
        downloadArea.classList.add('hidden');
        pendingMsg.classList.remove('hidden');
    }

    // Mostrar Card
    resultDisplay.classList.remove('hidden');
}

function showError(msg) {
    feedback.textContent = msg;
    feedback.style.color = 'var(--color-error)';
    // Efeito de tremer (opcional)
    const card = document.querySelector('.search-card');
    card.style.animation = 'none';
    card.offsetHeight; /* trigger reflow */
    card.style.animation = 'shake 0.3s';
}

// CSS Inline para animação de erro
const style = document.createElement('style');
style.innerHTML = `
@keyframes shake {
  0% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  50% { transform: translateX(5px); }
  75% { transform: translateX(-5px); }
  100% { transform: translateX(0); }
}`;
document.head.appendChild(style);