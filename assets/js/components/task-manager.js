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

// --- ELEMENTOS DO DOM ---
const modal = document.getElementById('task-manager-modal');
const closeBtn = document.getElementById('close-tm-btn');

// Views
const viewDetails = document.getElementById('view-details-content');
const viewK7 = document.getElementById('view-k7-form');
const infoGrid = document.getElementById('tm-info-grid'); 
const formK7 = document.getElementById('form-k7');

// Botões de Ação
const btnNext = document.getElementById('btn-next-stage');
const btnPrev = document.getElementById('btn-prev-stage'); // <--- NOVO
const btnDelete = document.getElementById('btn-delete-task');
const btnCancelK7 = document.getElementById('btn-cancel-k7');

let currentTask = null; 

// --- 1. UTILITÁRIOS ---
window.copyToClipboard = (text, btnElement) => {
    navigator.clipboard.writeText(text).then(() => {
        const originalContent = btnElement.innerHTML;
        btnElement.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => { btnElement.innerHTML = originalContent; }, 2000);
    }).catch(err => alert("Erro ao copiar."));
};

// --- 2. ENTRY POINT ---
window.openTaskManager = async (taskId) => {
    try {
        const docSnap = await getDoc(doc(db, "tasks", taskId));
        if (!docSnap.exists()) return alert("Tarefa não encontrada.");

        currentTask = { id: docSnap.id, ...docSnap.data() };
        
        renderDetails(currentTask);
        
        if(viewDetails) viewDetails.classList.remove('hidden');
        if(viewK7) viewK7.classList.add('hidden');
        
        if(modal) modal.classList.remove('hidden');

    } catch (e) { console.error(e); alert("Erro ao abrir tarefa."); }
};

if(closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));


// --- 3. RENDERIZAR DETALHES ---
function renderDetails(task) {
    // LÓGICA DO BOTÃO VOLTAR
    if(btnPrev) {
        // Se estiver na primeira etapa ('clivagem'), esconde o botão Voltar
        if (task.status === 'clivagem') {
            btnPrev.classList.add('hidden');
        } else {
            btnPrev.classList.remove('hidden');
        }
    }

    const internalProtocol = task.protocolo || "---";
    const publicCode = task.accessCode || "---";
    
    const statusMap = {
        'clivagem': 'Clivagem', 'processamento': 'Processamento', 
        'emblocamento': 'Emblocamento', 'corte': 'Corte', 
        'coloracao': 'Coloração', 'analise': 'Análise', 'liberar': 'Liberar Laudo',
        'concluido': 'Concluído'
    };
    const statusFormatted = statusMap[task.status] || task.status;
    
    // Configurações visuais (Status e Tipo)
    let statusBg = '#f3f4f6'; let statusColor = '#374151';
    if (task.status === 'analise') { statusBg = '#fef9c3'; statusColor = '#854d0e'; }
    if (task.status === 'liberar') { statusBg = '#dcfce7'; statusColor = '#166534'; }
    
    const typeLabel = task.type === 'necropsia' ? 'NECROPSIA' : 'BIÓPSIA';
    const typeColor = task.type === 'necropsia' ? '#3b82f6' : '#ec4899';

    const html = `
        <div class="tm-hero">
            <div class="tm-hero-info">
                <div class="tm-hero-species">
                    <span style="color:${typeColor}; border:1px solid ${typeColor}40; padding:2px 6px; border-radius:4px; margin-right:6px;">
                        ${typeLabel}
                    </span>
                    <i class="fas fa-paw"></i> ${task.especie || 'Espécie n/a'}
                </div>
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
                <span class="tm-data-value" style="font-weight:800; color:var(--color-primary);">${internalProtocol}</span>
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
                <div style="margin-top: 4px;">${getK7Badge(task.k7Color)}</div>
            </div>
        </div>
    `;

    infoGrid.innerHTML = html;
}

// --- 4. EDIÇÃO ---
window.enableEditMode = async () => {
    infoGrid.innerHTML = '<div style="padding:3rem; text-align:center;"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';
    
    // Esconde navegação
    if(btnNext) btnNext.parentElement.style.display = 'none';

    try {
        const task = currentTask;
        const q = query(collection(db, "users"), where("role", "in", ["professor", "pós graduando"]));
        const snapshot = await getDocs(q);
        
        let optionsDocente = `<option value="${task.docente || ''}" selected>${task.docente || 'Selecione...'}</option>`;
        let optionsPos = `<option value="${task.posGraduando || ''}" selected>${task.posGraduando || 'Selecione...'}</option>`;
        
        snapshot.forEach(docSnap => {
            const u = docSnap.data();
            const role = (u.role || '').toLowerCase();
            if (role === 'professor' && u.name !== task.docente) {
                optionsDocente += `<option value="${u.name}">${u.name}</option>`;
            } else if ((role === 'pós graduando' || role === 'pos-graduando') && u.name !== task.posGraduando) {
                optionsPos += `<option value="${u.name}">${u.name}</option>`;
            }
        });

        infoGrid.innerHTML = `
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
                            <label>Docente</label>
                            <select name="docente" class="input-field">${optionsDocente}</select>
                        </div>
                        <div class="form-group">
                            <label>Pós-Graduando</label>
                            <select name="posGraduando" class="input-field">${optionsPos}</select>
                        </div>
                        <div class="form-group">
                            <label>K7 Qtd</label>
                            <input type="number" name="k7Quantity" class="input-field" value="${task.k7Quantity || 0}">
                        </div>
                         <div class="form-group span-3">
                            <label>Cor K7</label>
                            <div class="color-selector">
                                <label class="color-option"><input type="radio" name="k7Color" value="rosa" ${task.k7Color==='rosa'?'checked':''}> <span class="color-box" style="background:#fce7f3; border-color:#ec4899;"></span>Rosa</label>
                                <label class="color-option"><input type="radio" name="k7Color" value="azul" ${task.k7Color==='azul'?'checked':''}> <span class="color-box" style="background:#dbeafe; border-color:#3b82f6;"></span>Azul</label>
                                <label class="color-option"><input type="radio" name="k7Color" value="branco" ${task.k7Color==='branco'?'checked':''}> <span class="color-box" style="background:#f8fafc; border-color:#cbd5e1;"></span>Branco</label>
                            </div>
                        </div>
                    </div>
                    <div style="margin-top: 2rem; display: flex; gap: 10px; justify-content: flex-end;">
                        <button type="button" class="btn btn-secondary" onclick="window.cancelEdit()">Cancelar</button>
                        <button type="submit" class="btn btn-primary">Salvar</button>
                    </div>
                </form>
            </div>`;
    } catch (e) { console.error(e); }
};

window.saveEdit = async (e) => {
    e.preventDefault();
    const form = document.getElementById('edit-task-form');
    const formData = new FormData(form);
    const updates = Object.fromEntries(formData.entries());
    try {
        await updateDoc(doc(db, "tasks", currentTask.id), updates);
        currentTask = { ...currentTask, ...updates };
        renderDetails(currentTask);
    } catch (err) { alert("Erro ao salvar."); }
};

window.cancelEdit = () => { renderDetails(currentTask); };


// --- 5. LÓGICA DE NAVEGAÇÃO DE ETAPAS ---

const flow = ['clivagem', 'processamento', 'emblocamento', 'corte', 'coloracao', 'analise', 'liberar', 'concluido'];

// Avançar (Próxima)
if (btnNext) {
    btnNext.addEventListener('click', () => {
        if (!currentTask) return;

        // Se estiver na clivagem, fluxo especial para abrir form K7
        if (currentTask.status === 'clivagem') {
            openK7FormSmart(currentTask);
            return;
        }

        const currIdx = flow.indexOf(currentTask.status);
        if (currIdx >= 0 && currIdx < flow.length - 1) {
            updateStatus(flow[currIdx + 1]);
        } else {
            alert("Última etapa.");
        }
    });
}

// Voltar (Anterior) - <--- NOVO
if (btnPrev) {
    btnPrev.addEventListener('click', () => {
        if (!currentTask) return;

        const currIdx = flow.indexOf(currentTask.status);
        // Só volta se não for o índice 0 (clivagem)
        if (currIdx > 0) {
            updateStatus(flow[currIdx - 1]);
        }
    });
}

// Helper para Atualizar Status
async function updateStatus(newStatus) {
    // Texto do alerta muda dependendo se está avançando ou voltando
    const action = flow.indexOf(newStatus) > flow.indexOf(currentTask.status) ? "Avançar" : "Voltar";
    
    if(!confirm(`${action} para ${newStatus.toUpperCase()}?`)) return;
    
    try {
        await updateDoc(doc(db, "tasks", currentTask.id), { status: newStatus });
        if(modal) modal.classList.add('hidden');
    } catch (e) { alert("Erro ao mudar status."); }
}

// --- 6. FORM K7 INTELIGENTE ---
function openK7FormSmart(task) {
    if(viewDetails) viewDetails.classList.add('hidden');
    if(viewK7) viewK7.classList.remove('hidden');

    let optionsHTML = '';
    const optionWhite = `<label class="color-option"><input type="radio" name="k7Color" value="branco"><span class="color-box" style="background:#f8fafc; border-color:#cbd5e1;"></span>Branco</label>`;

    if (task.type === 'necropsia') {
        optionsHTML = `<label class="color-option"><input type="radio" name="k7Color" value="azul" checked><span class="color-box" style="background:#dbeafe; border-color:#3b82f6;"></span>Azul</label>${optionWhite}`;
    } else {
        optionsHTML = `<label class="color-option"><input type="radio" name="k7Color" value="rosa" checked><span class="color-box" style="background:#fce7f3; border-color:#ec4899;"></span>Rosa</label>${optionWhite}`;
    }

    if(formK7) {
        formK7.innerHTML = `
            <div class="form-group"><label>Quantidade K7</label><input type="number" id="k7-quantity" class="input-field" min="1" value="1" required></div>
            <div class="form-group"><label>Cor</label><div class="color-selector">${optionsHTML}</div></div>
            <div class="modal-footer">
                <button type="button" id="btn-cancel-k7-dyn" class="btn btn-secondary">Voltar</button>
                <button type="submit" class="btn btn-primary">Salvar e Avançar</button>
            </div>`;
            
        document.getElementById('btn-cancel-k7-dyn').addEventListener('click', () => {
            viewK7.classList.add('hidden');
            viewDetails.classList.remove('hidden');
        });
    }
}

// Listeners Estáticos
if (formK7) {
    formK7.addEventListener('submit', async (e) => {
        e.preventDefault();
        const qty = document.getElementById('k7-quantity').value;
        const color = document.querySelector('input[name="k7Color"]:checked').value;
        try {
            await updateDoc(doc(db, "tasks", currentTask.id), { status: 'processamento', k7Quantity: qty, k7Color: color });
            if(modal) modal.classList.add('hidden');
        } catch (e) { alert("Erro ao salvar."); }
    });
}

if (btnDelete) {
    btnDelete.addEventListener('click', async () => {
        if(!confirm("Excluir tarefa?")) return;
        try { await deleteDoc(doc(db, "tasks", currentTask.id)); if(modal) modal.classList.add('hidden'); } catch(e){}
    });
}

function getK7Badge(color) {
    if(!color) return '-';
    let hex = '#cbd5e1'; let label = 'Padrão';
    if(color === 'rosa') { hex = '#ec4899'; label = 'Rosa'; }
    if(color === 'azul') { hex = '#3b82f6'; label = 'Azul'; }
    if(color === 'branco') { hex = '#f8fafc'; label = 'Branco'; }
    return `<div class="tm-k7-indicator"><span style="width:12px; height:12px; border-radius:50%; background:${hex}; border:1px solid rgba(0,0,0,0.1);"></span>${label}</div>`;
}