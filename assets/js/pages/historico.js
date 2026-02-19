import { db, auth, logout } from '../core.js';
import { collection, query, where, getDocs, deleteDoc, doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { generateLaudoPDF } from '../components/docx-generator.js';
import '../components/task-manager.js'; 

console.log("Historico Module Loaded - vFinal");

const listContainer = document.getElementById('reports-list');
const searchInput = document.getElementById('history-search');
const cleanupNotice = document.getElementById('cleanup-notice');
const btnExport = document.getElementById('btn-export-excel');
const btnClear = document.getElementById('btn-clear-history');

let allReports = [];

window.addEventListener('DOMContentLoaded', async () => {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            await loadHistory();
        } else {
            window.location.href = '../pages/auth.html';
        }
    });

    const btnLogout = document.getElementById('btn-logout');
    if(btnLogout) btnLogout.addEventListener('click', logout);

    const btnLogoutHeader = document.getElementById('logout-btn-header');
    if(btnLogoutHeader) btnLogoutHeader.addEventListener('click', logout);
});

// Lógica de carregamento sem exclusão automática
async function loadHistory() {
    try {
        const q = query(
            collection(db, "tasks"), 
            where("status", "==", "concluido")
        );
        
        const querySnapshot = await getDocs(q);
        allReports = [];

        allReports = querySnapshot.docs.map((documento) => {
            const data = documento.data();
            const taskId = documento.id;
            let releaseDate = data.releasedAt ? new Date(data.releasedAt) : (data.updatedAt ? new Date(data.updatedAt) : new Date());

            return { id: taskId, ...data, releaseDateObj: releaseDate };
        }).sort((a, b) => b.releaseDateObj - a.releaseDateObj);

        if (cleanupNotice) cleanupNotice.classList.add('hidden');

        renderList(allReports);

    } catch (error) {
        console.error("Erro ao carregar histórico:", error);
        if(listContainer) listContainer.innerHTML = `<div class="empty-state">Erro ao carregar dados.<br>${error.message}</div>`;
    }
}

// Mantém o design original dos cards com as cores azul/rosa
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

    listContainer.innerHTML = reports.map((task, index) => {
        const dataLib = task.releaseDateObj.toLocaleDateString('pt-BR');
        const tipoClass = task.type === 'necropsia' ? 'color:#3b82f6;' : 'color:#ec4899;';
        const tipoLabel = task.type === 'necropsia' ? 'Necropsia' : 'Biópsia';

        return `
        <div class="report-card" style="--card-index: ${index}" onclick="window.openTaskManager('${task.id}')">
            <div class="card-header">
                <div class="card-code">${task.protocolo || '---'}</div>
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
                    <i class="fas fa-file-pdf"></i> Baixar PDF
                </button>
            </div>
        </div>
        `;
    }).join('');
}

// Download de PDF Individual
window.downloadDoc = async (taskId) => {
    const task = allReports.find(t => t.id === taskId);
    if (!task) return alert("Erro: Tarefa não encontrada.");

    try {
        const btn = event.currentTarget; 
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;

        const reportData = task.report || {};
        await generateLaudoPDF(task, { ...reportData, ...task });

        btn.innerHTML = originalText;
        btn.disabled = false;
    } catch (e) {
        console.error(e);
        alert("Erro ao gerar arquivo.");
    }
};

// Exportação Excel Estilizada
if (btnExport) {
    btnExport.addEventListener('click', () => {
        if (allReports.length === 0) return alert("Não há dados para exportar.");

        const rows = allReports.map(task => [
            task.protocolo || "---",
            task.dataEntrada ? new Date(task.dataEntrada + 'T12:00:00').toLocaleDateString('pt-BR') : "---",
            task.animalNome || "---",
            task.animalRg || "---",
            task.especie || "---",
            task.raca || "---",
            task.sexo || "---",
            task.idade || "---",
            task.proprietario || "---",
            task.docente || "---",
            task.posGraduando || "---",
            task.type === 'necropsia' ? 'Necropsia' : 'Biópsia',
            task.report?.diagnostico || "---",
            task.origem || "---",
            parseFloat(task.valor?.replace(',', '.') || 0)
        ]);

        const totalValue = rows.reduce((sum, row) => sum + row[14], 0);
        const header = ["PROTOCOLO", "DATA ENTRADA", "NOME", "RG", "ESPÉCIE", "RAÇA", "SEXO", "IDADE", "PROPRIETÁRIO", "DOCENTE", "PÓS-GRADUANDO", "TIPO", "DIAGNÓSTICO", "HVU/EXTERNO", "VALOR (R$)"];
        const footer = ["TOTAL", "", "", "", "", "", "", "", "", "", "", "", "", "", totalValue];
        const dataMatrix = [header, ...rows, footer];

        const ws = XLSX.utils.aoa_to_sheet(dataMatrix);
        const range = XLSX.utils.decode_range(ws['!ref']);

        for (let R = range.s.r; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
                if (!ws[cellRef]) continue;
                ws[cellRef].s = {
                    border: {
                        top: { style: "thin", color: { rgb: "CCCCCC" } },
                        bottom: { style: "thin", color: { rgb: "CCCCCC" } },
                        left: { style: "thin", color: { rgb: "CCCCCC" } },
                        right: { style: "thin", color: { rgb: "CCCCCC" } }
                    },
                    alignment: { vertical: "center", horizontal: "center" },
                    font: { name: "Arial", sz: 10 }
                };
                if (R === 0) {
                    ws[cellRef].s.fill = { fgColor: { rgb: "2F75B5" } };
                    ws[cellRef].s.font = { color: { rgb: "FFFFFF" }, bold: true };
                } else if (R === range.e.r) {
                    ws[cellRef].s.fill = { fgColor: { rgb: "D9D9D9" } };
                    ws[cellRef].s.font = { bold: true };
                } else if (R % 2 === 0) {
                    ws[cellRef].s.fill = { fgColor: { rgb: "F2F2F2" } };
                }
                if ([2, 4, 5, 6].includes(C) && R !== 0) ws[cellRef].s.alignment.horizontal = "left";
            }
        }

        ws['!cols'] = [{wch:15},{wch:15},{wch:20},{wch:15},{wch:15},{wch:15},{wch:15},{wch:12},{wch:25},{wch:25},{wch:25},{wch:20},{wch:30},{wch:20},{wch:15}];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Resumo LPV");
        XLSX.writeFile(wb, `Resumo_Anual_LPV_${new Date().getFullYear()}.xlsx`);

        if (btnClear) btnClear.classList.remove('hidden');
    });
}

// Apagar Histórico Manual
if (btnClear) {
    btnClear.addEventListener('click', async () => {
        if (confirm("ATENÇÃO: Deseja apagar permanentemente TODO o histórico concluído?")) {
            try {
                btnClear.disabled = true;
                btnClear.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Apagando...';
                const batch = writeBatch(db);
                allReports.forEach(report => batch.delete(doc(db, "tasks", report.id)));
                await batch.commit();
                alert("Histórico limpo com sucesso!");
                window.location.reload();
            } catch (e) {
                console.error(e);
                alert("Erro ao apagar histórico.");
                btnClear.disabled = false;
            }
        }
    });
}

// Busca
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allReports.filter(task => 
            (task.animalNome && task.animalNome.toLowerCase().includes(term)) ||
            (task.proprietario && task.proprietario.toLowerCase().includes(term)) ||
            (task.protocolo && task.protocolo.toLowerCase().includes(term))
        );
        renderList(filtered);
    });
}