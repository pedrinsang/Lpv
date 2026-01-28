import { db, auth } from '../core.js';
import { 
    doc, getDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Importa o gerador de Word
import { generateLaudoWord } from './docx-generator.js';

console.log("Task Manager Carregado - Fluxo de Aprovação Corrigido");

// --- ELEMENTOS DO DOM ---
const modal = document.getElementById('task-manager-modal');
const closeBtn = document.getElementById('close-tm-btn');
const viewDetails = document.getElementById('view-details-content');
const viewK7 = document.getElementById('view-k7-form');
const infoGrid = document.getElementById('tm-info-grid'); 
const formK7 = document.getElementById('form-k7');
const reportModal = document.getElementById('report-editor-modal');

// Botões de Navegação (Rodapé do Modal Principal)
const btnNext = document.getElementById('btn-next-stage');
const btnPrev = document.getElementById('btn-prev-stage');
const btnDelete = document.getElementById('btn-delete-task');
const btnSaveReport = document.getElementById('btn-save-report'); // Botão dentro do modal de edição

let currentTask = null; 
let currentUserData = null; 

// ==========================================================================
// 1. DADOS DE USUÁRIO
// ==========================================================================
async function fetchCurrentUserData() {
    if (currentUserData) return currentUserData;
    if (!auth.currentUser) return null;
    try {
        const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
        if (userSnap.exists()) {
            currentUserData = userSnap.data();
            if(currentUserData.role) currentUserData.role = currentUserData.role.toLowerCase();
        }
    } catch(e) { console.error("Erro user data:", e); }
    return currentUserData;
}

// ==========================================================================
// 2. ABRIR TAREFA
// ==========================================================================
async function openTaskManager(taskId) {
    try {
        await fetchCurrentUserData();
        const docSnap = await getDoc(doc(db, "tasks", taskId));
        if (!docSnap.exists()) return alert("Tarefa não encontrada.");

        currentTask = { id: docSnap.id, ...docSnap.data() };
        
        // Renderiza a interface principal
        renderDetails(currentTask);
        
        // Exibe o modal principal
        if(viewDetails) viewDetails.classList.remove('hidden');
        if(viewK7) viewK7.classList.add('hidden');
        if(reportModal) reportModal.classList.add('hidden'); // Garante que o editor comece fechado
        if(modal) modal.classList.remove('hidden');

    } catch (e) { console.error(e); alert("Erro ao abrir: " + e.message); }
}

if(closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

// ==========================================================================
// 3. RENDERIZAÇÃO DA TELA DE DETALHES (FLUXO CORRIGIDO)
// ==========================================================================
function renderDetails(task) {
    const user = currentUserData || {};
    const role = user.role || '';
    
    // Permissões
    const isStaff = ['professor', 'pós graduando', 'pos-graduando', 'admin'].includes(role);
    const canRelease = role === 'admin' || role === 'professor' || (role.includes('graduando') && user.canReleaseReports === true);

    // --- CONFIGURAÇÃO DOS BOTÕES DE NAVEGAÇÃO (NEXT/PREV) ---
    // Reset inicial
    if(btnNext) { 
        btnNext.classList.remove('hidden'); 
        btnNext.innerHTML = 'Próxima Etapa <i class="fas fa-arrow-right"></i>'; 
        btnNext.onclick = handleNextStage;
        btnNext.disabled = false;
    }
    if(btnPrev) { 
        btnPrev.classList.remove('hidden'); 
        btnPrev.onclick = handlePrevStage; 
    }

    // Regras de Navegação por Status
    if (task.status === 'analise') {
        // Na análise, o botão "Próxima" serve para enviar para Liberação
        if (isStaff) {
            btnNext.innerHTML = 'Enviar para Liberação <i class="fas fa-paper-plane"></i>';
            btnNext.onclick = () => updateStatus('liberar');
        } else {
            btnNext.classList.add('hidden');
        }
    } 
    else if (task.status === 'liberar') {
        // Na liberação, escondemos o "Próxima" padrão (pois a ação final é o botão de Liberar customizado)
        // Mas MANTEMOS o "Anterior" para poder voltar para análise se precisar corrigir
        btnNext.classList.add('hidden'); 
        btnPrev.classList.remove('hidden');
    }
    else if (task.status === 'clivagem') {
        if(btnPrev) btnPrev.classList.add('hidden'); // Não tem anterior
    }


    // --- CONSTRUÇÃO DO HTML INTERNO ---
    const typeLabel = task.type === 'necropsia' ? 'NECROPSIA' : 'BIÓPSIA';
    const typeColor = task.type === 'necropsia' ? '#3b82f6' : '#ec4899';
    const statusMap = { 'clivagem':'Clivagem', 'processamento':'Processamento', 'emblocamento':'Emblocamento', 'corte':'Corte', 'coloracao':'Coloração', 'analise':'Análise', 'liberar':'Liberar Laudo', 'concluido':'Concluído' };

    // 1. Bloco Financeiro (Com botão de alterar)
    let financialHtml = '';
    const finStatus = task.financialStatus || 'pendente';
    // Botão de alterar visível para staff
    const btnChangeFin = isStaff ? 
        `<button class="btn btn-sm btn-outline-secondary" onclick="window.toggleFinancialStatus()" style="margin-left:auto; font-size:0.8rem; cursor:pointer; padding:2px 8px;">
            <i class="fas fa-sync-alt"></i> Alterar
         </button>` : '';

    if (finStatus === 'pendente') {
        financialHtml = `<div style="background:#fffbeb; border:1px solid #fcd34d; color:#b45309; padding:10px; border-radius:8px; margin-bottom:15px; display:flex; align-items:center; gap:10px;">
                <i class="fas fa-exclamation-triangle"></i> <div><strong>Financeiro Pendente</strong></div> ${btnChangeFin}
            </div>`;
    } else {
        financialHtml = `<div style="background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; padding:10px; border-radius:8px; margin-bottom:15px; display:flex; align-items:center; gap:10px;">
                <i class="fas fa-check-circle"></i> <div><strong>Financeiro Pago</strong></div> ${btnChangeFin}
            </div>`;
    }

    // 2. Área de Ações Específicas (Botões Grandes)
    let customActionsHtml = '';

    if (task.status === 'analise' && isStaff) {
        // Botões da Fase de Análise: Editar e Pré-visualizar
        customActionsHtml = `
            <div style="margin-top:20px; display:flex; gap:10px; flex-wrap:wrap; justify-content: flex-end; border-top:1px solid #eee; padding-top:15px; justify-content: space-evenly;">
                <button onclick="window.openReportEditorWrapper()" style="background:#8b5cf6; color:white; border:none; padding:10px 15px; border-radius:6px; cursor:pointer; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <i class="fas fa-edit"></i> Preencher/Editar Laudo
                </button>
                ${task.report ? `
                <button onclick="window.exportToWord()" style="background:#3b82f6; color:white; border:none; padding:10px 15px; border-radius:6px; cursor:pointer; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <i class="fas fa-eye"></i> Pré-visualizar DOCX
                </button>` : ''}
            </div>
        `;
    } 
    else if (task.status === 'liberar') {
        // Botões da Fase de Liberação: Editar, Baixar, Liberar
        let btnReleaseHtml = '';
        if (canRelease) {
            btnReleaseHtml = `
                <button onclick="window.finishReportWrapper()" style="background:#10b981; color:white; border:none; padding:10px 15px; border-radius:6px; cursor:pointer; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <i class="fas fa-check-double"></i> Liberar e Finalizar
                </button>`;
        } else {
            btnReleaseHtml = `<div style="padding:10px; color:#666; font-style:italic; font-size:0.9rem;">Aguardando liberação do responsável.</div>`;
        }

        customActionsHtml = `
            <div style="margin-top:20px; display:flex; gap:10px; flex-wrap:wrap; justify-content: flex-end; border-top:1px solid #eee; padding-top:15px; justify-content: space-evenly;">
                <button onclick="window.openReportEditorWrapper()" style="background:#6b7280; color:white; border:none; padding:10px 15px; border-radius:6px; cursor:pointer; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <i class="fas fa-edit"></i> Corrigir/Editar
                </button>
                <button onclick="window.exportToWord()" style="background:#3b82f6; color:white; border:none; padding:10px 15px; border-radius:6px; cursor:pointer; font-weight:600; display:flex; align-items:center; gap:8px; ">
                    <i class="fas fa-eye"></i> Pré-visualizar DOCX
                </button>
                ${btnReleaseHtml}
            </div>
        `;
    }

    const html = `
        <div class="tm-hero">
            <div class="tm-hero-info">
                <div class="tm-hero-species">
                    <span style="color:${typeColor}; border:1px solid ${typeColor}40; padding:2px 6px; border-radius:4px; margin-right:6px;">${typeLabel}</span>
                    <i class="fas fa-paw"></i> ${task.especie || '-'}
                </div>
                <h3>${task.animalNome || 'Sem Nome'}</h3>
            </div>
            <div class="tm-status-pill">${statusMap[task.status] || task.status}</div>
        </div>

        <div class="tm-code-strip">
            <div><div class="tm-code-label">Código Público</div><div class="tm-code-value">${task.accessCode || "---"}</div></div>
            <div style="display:flex; gap:10px;">
                <button class="btn btn-secondary btn-sm" onclick="window.enableEditMode()"> <i class="fas fa-edit"></i> Editar Dados</button>
            </div>
        </div>
        
        ${financialHtml}

        <div class="tm-data-grid">
            <div class="tm-data-item"><span class="tm-data-label">Protocolo</span><span class="tm-data-value" style="font-weight:800; color:var(--color-primary);">${task.protocolo || "---"}</span></div>
            <div class="tm-data-item"><span class="tm-data-label">Proprietário</span><span class="tm-data-value">${task.proprietario || '-'}</span></div>
            <div class="tm-data-item"><span class="tm-data-label">Docente</span><span class="tm-data-value">${task.docente || '-'}</span></div>
            <div class="tm-data-item"><span class="tm-data-label">Pós-Graduando</span><span class="tm-data-value">${task.posGraduando || '-'}</span></div>
            <div class="tm-data-item"><span class="tm-data-label">K7 Qtd/Cor</span><div style="margin-top:4px;">${task.k7Quantity || 0} unid. (${task.k7Color || '-'})</div></div>
        </div>
        
        ${customActionsHtml}
    `;

    infoGrid.innerHTML = html;
}

// ==========================================================================
// 4. AÇÕES (FINANCEIRO, SALVAR, LIBERAR)
// ==========================================================================

// ALTERAR FINANCEIRO
async function toggleFinancialStatus() {
    if(!currentTask) return;
    const currentStatus = currentTask.financialStatus || 'pendente';
    const newStatus = currentStatus === 'pago' ? 'pendente' : 'pago'; 

    if(!confirm(`Mudar status financeiro de ${currentStatus.toUpperCase()} para ${newStatus.toUpperCase()}?`)) return;

    try {
        await updateDoc(doc(db, "tasks", currentTask.id), { financialStatus: newStatus });
        currentTask.financialStatus = newStatus;
        renderDetails(currentTask); // Atualiza visual instantaneamente
    } catch(e) { console.error(e); alert("Erro ao atualizar financeiro."); }
}

// SALVAR RASCUNHO (SEM MUDAR ETAPA)
if(btnSaveReport) {
    btnSaveReport.addEventListener('click', async () => {
        const btn = btnSaveReport;
        btn.innerHTML = 'Salvando...'; btn.disabled = true;

        try {
            const formData = new FormData(document.getElementById('form-report-data'));
            const reportData = Object.fromEntries(formData.entries());
            
            // Salva apenas o relatório, NÃO muda o status
            await updateDoc(doc(db, "tasks", currentTask.id), { 
                report: reportData, 
                lastEditor: auth.currentUser.uid 
            });
            
            currentTask.report = reportData;
            
            // Fecha modal de edição e volta para detalhes
            document.getElementById('report-editor-modal').classList.add('hidden');
            renderDetails(currentTask); // Atualiza para aparecer o botão de "Pré-visualizar"
            
            // Feedback discreto
            // alert("Rascunho salvo!"); 
        } catch(e) { alert("Erro ao salvar: " + e.message); } 
        finally { btn.innerHTML = '<i class="fas fa-save"></i> Salvar e Voltar'; btn.disabled = false; }
    });
}

// LIBERAR E FINALIZAR (CONGELAR DATA)
async function finishReportWrapper() {
    if(!currentTask) return;
    
    // 1. Checa Financeiro
    const finStatus = currentTask.financialStatus || 'pendente';
    if (finStatus !== 'pago' && finStatus !== 'isento') {
        if(!confirm("⚠️ AVISO FINANCEIRO: Status PENDENTE.\nDeseja liberar o laudo mesmo assim?")) return;
    }

    if(!confirm("Tem certeza que deseja LIBERAR e FINALIZAR este laudo?\nA data será congelada e ele irá para os Concluídos.")) return;

    try {
        // Data Congelada (Agora)
        const dataCongelada = new Date().toISOString();

        await updateDoc(doc(db, "tasks", currentTask.id), { 
            status: 'concluido', 
            releasedBy: auth.currentUser.uid, 
            releasedAt: dataCongelada 
        });
        
        alert("Laudo Liberado com Sucesso!"); 
        modal.classList.add('hidden'); // Fecha tudo
        if(window.location.reload) window.location.reload(); 
    } catch(e) { console.error(e); alert("Erro ao liberar: " + e.message); }
}

// ==========================================================================
// 5. EDITOR E EXPORTAÇÃO
// ==========================================================================

async function exportToWord() {
    if (!currentTask) return alert("Nenhuma tarefa selecionada.");
    
    // Tenta pegar do form se estiver aberto, senão usa do objeto salvo
    const form = document.getElementById('form-report-data');
    let finalData = currentTask.report || {};
    
    if (form && !document.getElementById('report-editor-modal').classList.contains('hidden')) {
        const formData = new FormData(form);
        const formObj = Object.fromEntries(formData.entries());
        finalData = { ...finalData, ...formObj };
    }

    // Feedback visual
    const allBtns = document.querySelectorAll('button'); 
    // Desabilita botões temporariamente pra evitar clique duplo
    
    try {
        await generateLaudoWord(currentTask, finalData);
    } catch (e) {
        console.error(e);
        alert("Erro ao gerar Word: " + e.message);
    }
}

function openReportEditor(task) {
    const reportModal = document.getElementById('report-editor-modal');
    if (!reportModal) return;
    
    // Configura o visual do modal (Remove estilo A4 antigo)
    const container = document.getElementById('print-area');
    const parentContainer = container.parentElement; 
    if (parentContainer) parentContainer.classList.add('mode-edit');
    container.classList.add('mode-edit');
    container.classList.remove('report-paper'); 

    const rep = task.report || {};
    // Bloqueia se já estiver concluído
    const isReadOnly = task.status === 'concluido';
    const disabledAttr = isReadOnly ? 'disabled style="background:#f0f0f0; color:#555;"' : '';

    const isChecked = (val, fieldName) => {
        if (fieldName === 'tipo_material_radio') {
            if (rep.tipo_material_radio) return rep.tipo_material_radio === val ? 'checked' : '';
            return task.type === val ? 'checked' : '';
        }
        return rep[fieldName] === val ? 'checked' : '';
    };

    container.innerHTML = `
        <div class="report-form-wrapper">
            <div class="report-header">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h4><i class="fas fa-file-medical-alt"></i> Laudo Digital ${isReadOnly ? '(Finalizado)' : ''}</h4>
                    <button type="button" class="btn-close-modal" onclick="document.getElementById('report-editor-modal').classList.add('hidden')" style="background:transparent; border:none; color:var(--text-tertiary); cursor:pointer; font-size:1.2rem;"><i class="fas fa-times"></i></button>
                </div>
                <p style="font-size:0.9rem; color:var(--text-tertiary);">Protocolo: <span style="color:var(--color-primary); font-weight:bold;">${task.protocolo || task.accessCode}</span></p>
            </div>
            <form id="form-report-data">
                <div class="form-section-title"><i class="fas fa-box-open"></i> 1. Dados do Material</div>
                <div class="form-row">
                    <div class="form-col"><label>Material Remetido</label><div class="radio-cards-container"><label><input type="radio" name="tipo_material_radio" value="biopsia" ${isChecked('biopsia', 'tipo_material_radio')} ${disabledAttr}><div class="radio-card-label"><i class="fas fa-microscope"></i> Biópsia</div></label><label><input type="radio" name="tipo_material_radio" value="necropsia" ${isChecked('necropsia', 'tipo_material_radio')} ${disabledAttr}><div class="radio-card-label"><i class="fas fa-skull"></i> Necropsia</div></label></div></div>
                    <div class="form-col"><label>Descrição do Material</label><input type="text" name="tipo_material_desc" class="input-field-sm" value="${rep.tipo_material_desc || ''}" ${disabledAttr}></div>
                </div>
                <div class="form-row">
                    <div class="form-col"><label>Tipo de Morte</label><div class="radio-cards-container"><label><input type="radio" name="morte_tipo" value="espontanea" ${isChecked('espontanea', 'morte_tipo')} ${disabledAttr}><div class="radio-card-label">Espontânea</div></label><label><input type="radio" name="morte_tipo" value="eutanasia" ${isChecked('eutanasia', 'morte_tipo')} ${disabledAttr}><div class="radio-card-label">Eutanásia</div></label></div></div>
                    <div class="form-col"><label>Tempo Morte/Colheita</label><input type="text" name="tempo_morte" class="input-field-sm" value="${rep.tempo_morte || ''}" ${disabledAttr}></div>
                </div>
                <div class="form-row">
                    <div class="form-col"><label>Conservação</label><div class="radio-cards-container"><label><input type="radio" name="conservacao" value="formol" ${!rep.conservacao || rep.conservacao === 'formol' ? 'checked' : ''} ${disabledAttr}><div class="radio-card-label">Formol</div></label><label><input type="radio" name="conservacao" value="refrigerado" ${isChecked('refrigerado', 'conservacao')} ${disabledAttr}><div class="radio-card-label">Refrig.</div></label><label><input type="radio" name="conservacao" value="congelado" ${isChecked('congelado', 'conservacao')} ${disabledAttr}><div class="radio-card-label">Cong.</div></label></div></div>
                </div>
                <div class="form-section-title"><i class="fas fa-diagnoses"></i> 2. Análise Patológica</div>
                <div class="form-row"><div class="form-col"><label>Histórico Clínico</label><textarea name="historico" rows="3" class="input-area" ${disabledAttr}>${rep.historico || ''}</textarea></div></div>
                <div class="form-row"><div class="form-col"><label>Diagnóstico Presuntivo</label><textarea name="suspeita" rows="2" class="input-area" ${disabledAttr}>${rep.suspeita || ''}</textarea></div></div>
                <div class="form-row"><div class="form-col"><label>Descrição Macroscópica</label><textarea name="macroscopia" rows="3" class="input-area" ${disabledAttr}>${rep.macroscopia || ''}</textarea></div></div>
                <div class="form-row"><div class="form-col"><label>Descrição Microscópica</label><textarea name="microscopia" rows="5" class="input-area" ${disabledAttr}>${rep.microscopia || ''}</textarea></div></div>
                <div class="form-row"><div class="form-col"><label style="color:var(--color-primary);">Diagnóstico Final</label><textarea name="diagnostico" rows="2" class="input-area" style="font-weight:bold; border-color:var(--color-primary); background:rgba(var(--color-primary-rgb), 0.05);" ${disabledAttr}>${rep.diagnostico || ''}</textarea></div></div>
                <div class="form-row"><div class="form-col"><label>Comentários</label><textarea name="comentarios" rows="2" class="input-area" ${disabledAttr}>${rep.comentarios || ''}</textarea></div></div>
            </form>
        </div>`;
    
    // Esconde o botão antigo de download que ficava DENTRO do modal, pois agora ele fica fora
    const btnDown = document.getElementById('btn-download-word');
    if(btnDown) btnDown.classList.add('hidden');
    
    reportModal.classList.remove('hidden');
}

// ==========================================================================
// 6. FUNÇÕES AUXILIARES DE NAVEGAÇÃO
// ==========================================================================

function handleNextStage() {
    if (!currentTask) return;
    if (currentTask.status === 'clivagem') { openK7FormSmart(currentTask); return; }
    
    const flow = ['clivagem', 'processamento', 'emblocamento', 'corte', 'coloracao', 'analise', 'liberar', 'concluido'];
    const currIdx = flow.indexOf(currentTask.status);
    if (currIdx >= 0 && currIdx < flow.length - 1) updateStatus(flow[currIdx + 1]);
}

function handlePrevStage() {
    if (!currentTask) return;
    const flow = ['clivagem', 'processamento', 'emblocamento', 'corte', 'coloracao', 'analise', 'liberar', 'concluido'];
    const currIdx = flow.indexOf(currentTask.status);
    if (currIdx > 0) updateStatus(flow[currIdx - 1]);
}

async function updateStatus(newStatus) {
    if(!confirm(`Mover tarefa para a etapa: ${newStatus.toUpperCase()}?`)) return;
    try { 
        await updateDoc(doc(db, "tasks", currentTask.id), { status: newStatus }); 
        currentTask.status = newStatus;
        // Re-renderiza para atualizar os botões de acordo com a nova etapa
        renderDetails(currentTask); 
    } catch (e) { alert("Erro ao mover."); }
}

function openK7FormSmart(task) {
    viewDetails.classList.add('hidden'); viewK7.classList.remove('hidden');
    // ... Logica do K7 (simplificada aqui, use a existente se preferir) ...
    let optionsHTML = '';
    const optionWhite = `<label class="color-option"><input type="radio" name="k7Color" value="branco"><span class="color-box" style="background:#f8fafc; border-color:#cbd5e1;"></span>Branco</label>`;
    if (task.type === 'necropsia') { optionsHTML = `<label class="color-option"><input type="radio" name="k7Color" value="azul" checked><span class="color-box" style="background:#dbeafe; border-color:#3b82f6;"></span>Azul</label>${optionWhite}`; } 
    else { optionsHTML = `<label class="color-option"><input type="radio" name="k7Color" value="rosa" checked><span class="color-box" style="background:#fce7f3; border-color:#ec4899;"></span>Rosa</label>${optionWhite}`; }
    if(formK7) {
        formK7.innerHTML = `
            <div class="form-group"><label>Qtd K7</label><input type="number" id="k7-quantity" class="input-field" min="1" value="1"></div>
            <div class="form-group"><label>Cor</label><div class="color-selector">${optionsHTML}</div></div>
            <div class="modal-footer"><button type="button" id="btn-cancel-k7-dyn" class="btn btn-secondary">Voltar</button><button type="submit" class="btn btn-primary">Salvar</button></div>
        `;
        document.getElementById('btn-cancel-k7-dyn').addEventListener('click', () => { viewK7.classList.add('hidden'); viewDetails.classList.remove('hidden'); });
        formK7.onsubmit = async (e) => { e.preventDefault(); const qty = document.getElementById('k7-quantity').value; const color = document.querySelector('input[name="k7Color"]:checked').value; try { await updateDoc(doc(db, "tasks", currentTask.id), { status: 'processamento', k7Quantity: qty, k7Color: color }); currentTask.status='processamento'; renderDetails(currentTask); viewK7.classList.add('hidden'); viewDetails.classList.remove('hidden'); } catch(e){alert("Erro");} };
    }
}

if(btnDelete) {
    btnDelete.addEventListener('click', async () => { if(confirm("Excluir?")) { try { await deleteDoc(doc(db, "tasks", currentTask.id)); modal.classList.add('hidden'); } catch(e){} } });
}

function openReportEditorWrapper() { openReportEditor(currentTask); }

// EXPORTS GLOBAIS
window.openTaskManager = openTaskManager;
window.exportToWord = exportToWord; 
window.openReportEditorWrapper = openReportEditorWrapper;
window.finishReportWrapper = finishReportWrapper;
window.toggleFinancialStatus = toggleFinancialStatus;
window.enableEditMode = async () => { alert("Use o Firebase Console para editar dados estruturais no momento."); };