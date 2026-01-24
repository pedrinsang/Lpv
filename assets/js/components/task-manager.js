import { db } from '../core.js';
import { 
    doc, 
    getDoc, 
    updateDoc, 
    deleteDoc, 
    collection, 
    query, 
    where, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const modal = document.getElementById('task-manager-modal');
const closeBtn = document.getElementById('close-tm-btn');

// Views e Elementos
const viewDetails = document.getElementById('view-details-content');
const viewK7 = document.getElementById('view-k7-form');
const infoGrid = document.getElementById('tm-info-grid'); 
const formK7 = document.getElementById('form-k7');

// Buttons
const btnNext = document.getElementById('btn-next-stage');
const btnDelete = document.getElementById('btn-delete-task');
const btnCancelK7 = document.getElementById('btn-cancel-k7');

let currentTask = null; 

// --- FUNÇÃO DE COPIAR ---
window.copyToClipboard = (text, btnElement) => {
    navigator.clipboard.writeText(text).then(() => {
        const originalContent = btnElement.innerHTML;
        btnElement.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => { btnElement.innerHTML = originalContent; }, 2000);
    }).catch(err => alert("Erro ao copiar."));
};

// 1. ABRIR GERENCIADOR
window.openTaskManager = async (taskId) => {
    try {
        const docSnap = await getDoc(doc(db, "tasks", taskId));
        if (!docSnap.exists()) return alert("Tarefa não encontrada.");

        currentTask = { id: docSnap.id, ...docSnap.data() };
        renderDetails(currentTask);
        
        viewDetails.classList.remove('hidden');
        viewK7.classList.add('hidden');
        
        const oldTitle = document.getElementById('tm-title');
        if(oldTitle) oldTitle.style.display = 'none';

        modal.classList.remove('hidden');
    } catch (e) { console.error(e); alert("Erro ao abrir tarefa."); }
};

if(closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

// 2. RENDERIZAR DETALHES (MODO LEITURA)
function renderDetails(task) {
    if(btnNext) btnNext.parentElement.style.display = 'flex'; 
    if(btnNext) btnNext.classList.remove('hidden');

    const internalProtocol = task.protocolo || "---";
    const publicCode = task.accessCode || "---";
    
    const statusMap = {
        'analise': 'Análise', 'liberar': 'Liberar Laudo', 'clivagem': 'Clivagem',
        'processamento': 'Processamento', 'necropsias': 'Necropsia', 'biopsias': 'Biópsia',
        'emblocamento': 'Emblocamento', 'corte': 'Corte', 'coloracao': 'Coloração'
    };
    const statusFormatted = statusMap[task.status] || task.status;
    
    let statusBg = '#f3f4f6'; let statusColor = '#374151';
    if (task.status === 'analise') { statusBg = '#fef9c3'; statusColor = '#854d0e'; }
    if (task.status === 'liberar') { statusBg = '#dcfce7'; statusColor = '#166534'; }
    if (task.status === 'biopsias') { statusBg = '#fce7f3'; statusColor = '#9d174d'; }
    if (task.status === 'necropsias') { statusBg = '#dbeafe'; statusColor = '#1e40af'; }

    const html = `
        <div class="tm-hero">
            <div class="tm-hero-info">
                <div class="tm-hero-species"><i class="fas fa-paw"></i> ${task.especie || 'Espécie n/a'}</div>
                <h3>${task.animalNome || 'Sem Nome'}</h3>
            </div>
            <div class="tm-status-pill" style="background: ${statusBg}; color: ${statusColor};">
                <i class="fas fa-circle" style="font-size: 8px;"></i> ${statusFormatted}
            </div>
        </div>

        <div class="tm-code-strip">
            <div>
                <div class="tm-code-label">Código Público</div>
                <div class="tm-code-value">${publicCode}</div>
            </div>
            <div style="display:flex; gap:10px;">
                <button class="btn btn-secondary btn-sm" onclick="window.enableEditMode()">
                    <i class="fas fa-edit"></i> Editar
                </button>
                <button class="btn btn-secondary btn-sm" onclick="window.copyToClipboard('${publicCode}', this)">
                    <i class="far fa-copy"></i> Copiar
                </button>
            </div>
        </div>

        <div class="tm-data-grid">
            <div class="tm-data-item">
                <span class="tm-data-label">Protocolo Interno</span>
                <span class="tm-data-value">${internalProtocol}</span>
            </div>
            <div class="tm-data-item">
                <span class="tm-data-label">Proprietário</span>
                <span class="tm-data-value">${task.proprietario || '-'}</span>
            </div>
            <div class="tm-data-item">
                <span class="tm-data-label">Docente Responsável</span>
                <span class="tm-data-value">${task.docente || '-'}</span>
            </div>
            <div class="tm-data-item">
                <span class="tm-data-label">Pós-Graduando</span>
                <span class="tm-data-value">${task.posGraduando || '-'}</span>
            </div>
             <div class="tm-data-item">
                <span class="tm-data-label">Qtd. Cassetes (K7)</span>
                <span class="tm-data-value">${task.k7Quantity ? task.k7Quantity + ' unid.' : '-'}</span>
            </div>
            <div class="tm-data-item">
                <span class="tm-data-label">Cor do K7</span>
                <div style="margin-top: 4px;">
                    ${getK7Badge(task.k7Color)}
                </div>
            </div>
        </div>
    `;

    infoGrid.innerHTML = html;
    infoGrid.style.display = 'block'; 
    infoGrid.style.padding = '0';
}

// 3. RENDERIZAR MODO DE EDIÇÃO (COM BUSCA DE EQUIPE)
window.enableEditMode = async () => {
    // Feedback visual de carregamento
    infoGrid.innerHTML = '<div style="padding:2rem; text-align:center;"><i class="fas fa-spinner fa-spin"></i> Carregando formulário...</div>';
    
    if(btnNext) btnNext.parentElement.style.display = 'none';
    const task = currentTask;

    try {
        // 1. Busca usuários (Docentes e Pós) no Firestore
        const q = query(collection(db, "users"), where("role", "in", ["professor", "pós graduando"]));
        const snapshot = await getDocs(q);
        
        // 2. Monta as opções dos Selects
        let optionsDocente = `<option value="${task.docente || ''}" selected>${task.docente || 'Selecione...'}</option>`;
        let optionsPos = `<option value="${task.posGraduando || ''}" selected>${task.posGraduando || 'Selecione...'}</option>`;
        
        // Lista para evitar duplicatas caso o nome atual já venha do banco
        const currentDocente = task.docente;
        const currentPos = task.posGraduando;

        snapshot.forEach(docSnap => {
            const u = docSnap.data();
            const role = u.role.toLowerCase();
            
            if (role === 'professor' && u.name !== currentDocente) {
                optionsDocente += `<option value="${u.name}">${u.name}</option>`;
            } else if (role === 'pós graduando' && u.name !== currentPos) {
                optionsPos += `<option value="${u.name}">${u.name}</option>`;
            }
        });

        // 3. Renderiza o Formulário
        const html = `
            <div style="padding: 1.5rem; background: var(--bg-body);">
                <h3 style="margin-bottom: 1.5rem; color: var(--color-primary);">Editar Amostra</h3>
                
                <form id="edit-task-form" onsubmit="window.saveEdit(event)">
                    <div class="form-grid">
                        
                        <div class="form-group span-2">
                            <label>Nome do Animal</label>
                            <input type="text" name="animalNome" class="input-field" value="${task.animalNome || ''}" required>
                        </div>
                        <div class="form-group">
                            <label>Espécie</label>
                            <input type="text" name="especie" class="input-field" value="${task.especie || ''}">
                        </div>

                        <div class="form-group">
                            <label>Protocolo</label>
                            <input type="text" name="protocolo" class="input-field" value="${task.protocolo || ''}">
                        </div>
                        <div class="form-group span-2">
                            <label>Proprietário</label>
                            <input type="text" name="proprietario" class="input-field" value="${task.proprietario || ''}">
                        </div>

                        <div class="form-group">
                            <label>Docente Responsável</label>
                            <select name="docente" class="input-field">
                                ${optionsDocente}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Pós-Graduando</label>
                            <select name="posGraduando" class="input-field">
                                ${optionsPos}
                            </select>
                        </div>

                        <div class="form-group">
                            <label>Qtd. K7</label>
                            <input type="number" name="k7Quantity" class="input-field" value="${task.k7Quantity || 1}">
                        </div>

                        <div class="form-group span-3">
                            <label>Cor do Cassete (K7)</label>
                            <div class="color-selector">
                                <label class="color-option">
                                    <input type="radio" name="k7Color" value="rosa" ${task.k7Color === 'rosa' ? 'checked' : ''}>
                                    <span class="color-box" style="background: #fce7f3; border-color: #ec4899;"></span>
                                    <span>Rosa</span>
                                </label>
                                <label class="color-option">
                                    <input type="radio" name="k7Color" value="azul" ${task.k7Color === 'azul' ? 'checked' : ''}>
                                    <span class="color-box" style="background: #dbeafe; border-color: #3b82f6;"></span>
                                    <span>Azul</span>
                                </label>
                                <label class="color-option">
                                    <input type="radio" name="k7Color" value="branco" ${task.k7Color === 'branco' ? 'checked' : ''}>
                                    <span class="color-box" style="background: #f8fafc; border-color: #cbd5e1;"></span>
                                    <span>Branco</span>
                                </label>
                            </div>
                        </div>

                    </div>

                    <div style="margin-top: 2rem; display: flex; gap: 10px; justify-content: flex-end;">
                        <button type="button" class="btn btn-secondary" onclick="window.cancelEdit()">Cancelar</button>
                        <button type="submit" class="btn btn-primary">Salvar Alterações</button>
                    </div>
                </form>
            </div>
        `;

        infoGrid.innerHTML = html;

    } catch (e) {
        console.error("Erro ao carregar equipe:", e);
        infoGrid.innerHTML = '<div style="padding:2rem; color:red;">Erro ao carregar dados. Tente novamente.</div>';
    }
};

// 4. SALVAR EDIÇÃO
window.saveEdit = async (e) => {
    e.preventDefault();
    const form = document.getElementById('edit-task-form');
    const formData = new FormData(form);
    const updates = Object.fromEntries(formData.entries());
    
    const btn = form.querySelector('button[type="submit"]');
    btn.innerHTML = 'Salvando...';
    btn.disabled = true;

    try {
        await updateDoc(doc(db, "tasks", currentTask.id), updates);
        currentTask = { ...currentTask, ...updates };
        renderDetails(currentTask);
    } catch (err) {
        console.error(err);
        alert("Erro ao salvar alterações.");
        btn.disabled = false;
        btn.innerHTML = 'Salvar Alterações';
    }
};

window.cancelEdit = () => { renderDetails(currentTask); };

function getK7Badge(color) {
    if(!color) return '<span style="opacity:0.5">-</span>';
    let hex = '#cbd5e1'; let label = 'Padrão';
    if(color === 'rosa') { hex = '#ec4899'; label = 'Rosa (Biópsia)'; }
    if(color === 'azul') { hex = '#3b82f6'; label = 'Azul (Necropsia)'; }
    if(color === 'branco') { hex = '#f8fafc'; label = 'Branco'; }
    return `<div class="tm-k7-indicator"><span style="width:12px; height:12px; border-radius:50%; background:${hex}; border:1px solid rgba(0,0,0,0.1);"></span>${label}</div>`;
}

// EVENTOS DE NAVEGAÇÃO
btnNext.addEventListener('click', () => {
    if (!currentTask) return;
    if (currentTask.status === 'clivagem') {
        viewDetails.classList.add('hidden');
        viewK7.classList.remove('hidden');
        return;
    }
    const flow = ['clivagem', 'processamento', 'emblocamento', 'corte', 'coloracao', 'analise', 'liberar', 'concluido'];
    const currIdx = flow.indexOf(currentTask.status);
    if (currIdx >= 0 && currIdx < flow.length - 1) simpleAdvance(flow[currIdx + 1]);
    else alert("Última etapa.");
});

formK7.addEventListener('submit', async (e) => {
    e.preventDefault();
    const qty = document.getElementById('k7-quantity').value;
    const color = document.querySelector('input[name="k7Color"]:checked').value;
    const btn = formK7.querySelector('button[type="submit"]');
    btn.disabled = true; btn.innerHTML = 'Salvando...';
    try {
        await updateDoc(doc(db, "tasks", currentTask.id), { status: 'processamento', k7Quantity: qty, k7Color: color });
        modal.classList.add('hidden');
    } catch (e) { alert("Erro."); } 
    finally { btn.disabled = false; btn.innerHTML = 'Salvar e Processar'; }
});

btnCancelK7.addEventListener('click', () => { viewK7.classList.add('hidden'); viewDetails.classList.remove('hidden'); });

async function simpleAdvance(nextStatus) {
    if(!confirm(`Mover para ${nextStatus.toUpperCase()}?`)) return;
    try {
        await updateDoc(doc(db, "tasks", currentTask.id), { status: nextStatus });
        modal.classList.add('hidden');
    } catch (e) { alert("Erro ao mover."); }
}

btnDelete.addEventListener('click', async () => {
    if(!confirm("Excluir permanentemente?")) return;
    try { await deleteDoc(doc(db, "tasks", currentTask.id)); modal.classList.add('hidden'); } 
    catch (e) { alert("Erro ao excluir."); }
});