import { db, auth, logout } from '../core.js';
import { collection, query, where, getDocs, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { generateLaudoWord } from '../components/docx-generator.js';

// Importa task manager para permitir abrir o modal ao clicar (se necessário visualizar detalhes)
import '../components/task-manager.js'; 

console.log("Historico Module Loaded");

const listContainer = document.getElementById('reports-list');
const searchInput = document.getElementById('history-search');
const cleanupNotice = document.getElementById('cleanup-notice');
const deletedCountSpan = document.getElementById('deleted-count');

let allReports = [];

window.addEventListener('DOMContentLoaded', async () => {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            await loadAndCleanupHistory();
        } else {
            window.location.href = '../pages/auth.html';
        }
    });

    // Logout Sidebar
    const btnLogout = document.getElementById('btn-logout');
    if(btnLogout) btnLogout.addEventListener('click', logout);

    // Logout Header (Se existir na página)
    const btnLogoutHeader = document.getElementById('logout-btn-header');
    if(btnLogoutHeader) btnLogoutHeader.addEventListener('click', logout);
});

async function loadAndCleanupHistory() {
    try {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        
        // Busca apenas concluídos
        const q = query(
            collection(db, "tasks"), 
            where("status", "==", "concluido")
        );
        
        const querySnapshot = await getDocs(q);
        let deletedCount = 0;
        allReports = [];

        const promises = querySnapshot.docs.map(async (documento) => {
            const data = documento.data();
            const taskId = documento.id;
            
            // Define data de referência (liberação ou atualização)
            let releaseDate = data.releasedAt ? new Date(data.releasedAt) : (data.updatedAt ? new Date(data.updatedAt) : new Date());

            // Limpeza automática de 365 dias
            if (releaseDate < oneYearAgo) {
                await deleteDoc(doc(db, "tasks", taskId));
                deletedCount++;
                return null;
            }

            return { id: taskId, ...data, releaseDateObj: releaseDate };
        });

        const results = await Promise.all(promises);
        
        allReports = results
            .filter(item => item !== null)
            .sort((a, b) => b.releaseDateObj - a.releaseDateObj);

        if (deletedCount > 0 && cleanupNotice) {
            if(deletedCountSpan) deletedCountSpan.innerText = deletedCount;
            cleanupNotice.classList.remove('hidden');
        }

        renderList(allReports);

    } catch (error) {
        console.error("Erro ao carregar histórico:", error);
        if(listContainer) listContainer.innerHTML = `<div class="empty-state">Erro ao carregar dados.<br>${error.message}</div>`;
    }
}

function renderList(reports) {
    if (!listContainer) return;

    if (reports.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-folder-open" style="font-size: 3rem; margin-bottom: 1rem; opacity:0.5;"></i>
                <p>Nenhum laudo encontrado no histórico.</p>
            </div>`;
        return;
    }

    listContainer.innerHTML = reports.map(task => {
        const dataLib = task.releaseDateObj.toLocaleDateString('pt-BR');
        const tipoClass = task.type === 'necropsia' ? 'color:#3b82f6;' : 'color:#ec4899;';
        const tipoLabel = task.type === 'necropsia' ? 'Necropsia' : 'Biópsia';

        return `
        <div class="report-card" onclick="window.openTaskManager('${task.id}')">
            <div class="card-header">
                <div class="card-code">${task.accessCode || '---'}</div>
                <div class="card-date"><i class="far fa-calendar-alt"></i> ${dataLib}</div>
            </div>
            
            <div class="card-title">${task.animalNome || 'Sem Nome'}</div>
            <div class="card-subtitle">
                <span style="${tipoClass} font-weight:bold; font-size:0.8rem; text-transform:uppercase;">${tipoLabel}</span> • 
                ${task.proprietario || 'Proprietário não inf.'}
            </div>

            <div style="font-size: 0.85rem; color: var(--text-tertiary); margin-bottom: 10px;">
                <i class="fas fa-user-md"></i> ${task.docente || 'Veterinário'}
            </div>

            <div class="card-actions">
                <button onclick="event.stopPropagation(); window.downloadDoc('${task.id}')" class="btn btn-sm btn-primary" style="width:100%; display:flex; justify-content:center; align-items:center; gap:8px;">
                    <i class="fas fa-file-word"></i> Baixar Documento
                </button>
            </div>
        </div>
        `;
    }).join('');
}

// Wrapper para download direto
window.downloadDoc = async (taskId) => {
    const task = allReports.find(t => t.id === taskId);
    if (!task) return alert("Erro: Tarefa não encontrada na memória.");

    try {
        const btn = event.currentTarget; 
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;

        const reportData = task.report || {};
        const finalData = { ...reportData, ...task };

        await generateLaudoWord(task, finalData);

        btn.innerHTML = originalText;
        btn.disabled = false;
    } catch (e) {
        console.error(e);
        alert("Erro ao gerar arquivo.");
    }
};

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allReports.filter(task => 
            (task.animalNome && task.animalNome.toLowerCase().includes(term)) ||
            (task.proprietario && task.proprietario.toLowerCase().includes(term)) ||
            (task.accessCode && task.accessCode.toLowerCase().includes(term)) ||
            (task.protocolo && task.protocolo.toLowerCase().includes(term))
        );
        renderList(filtered);
    });
}