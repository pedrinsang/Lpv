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
/* --- DENTRO DE assets/js/components/task-manager.js --- */

// Substitua a função renderDetails existente por esta versão moderna:

function renderDetails(task) {
    const user = currentUserData || {};
    const role = user.role || '';
    
    // Permissões
    const isStaff = ['professor', 'pós graduando', 'pos-graduando', 'admin'].includes(role);
    const canRelease = role === 'admin' || role === 'professor' || (role.includes('graduando') && user.canReleaseReports === true);

    // --- CONFIGURAÇÃO DE NAVEGAÇÃO ---
    // (Mantida a lógica original, apenas ajustando visualização)
    if(btnNext) { 
        btnNext.classList.remove('hidden'); 
        btnNext.innerHTML = 'Próxima Etapa <i class="fas fa-arrow-right"></i>'; 
        btnNext.onclick = handleNextStage;
    }
    if(btnPrev) { 
        btnPrev.classList.remove('hidden'); 
        btnPrev.onclick = handlePrevStage; 
    }

    if (task.status === 'analise') {
        if (isStaff) {
            btnNext.innerHTML = 'Enviar para Liberação <i class="fas fa-paper-plane"></i>';
            btnNext.onclick = () => updateStatus('liberar');
        } else {
            btnNext.classList.add('hidden');
        }
    } 
    else if (task.status === 'liberar') {
        btnNext.classList.add('hidden'); // Esconde o "Próxima" padrão, usaremos botões customizados
        btnPrev.classList.remove('hidden');
    }
    else if (task.status === 'clivagem') {
        if(btnPrev) btnPrev.classList.add('hidden');
    }

    // --- DADOS VISUAIS ---
    const typeClass = task.type === 'necropsia' ? 'necropsia' : 'biopsia';
    const typeIcon = task.type === 'necropsia' ? 'fa-skull' : 'fa-microscope';
    const typeLabel = task.type === 'necropsia' ? 'Necropsia' : 'Biópsia';
    
    // Status Legível
    const statusMap = { 
        'clivagem':'Clivagem', 'processamento':'Processamento', 'emblocamento':'Emblocamento', 
        'corte':'Corte', 'coloracao':'Coloração', 'analise':'Análise', 
        'liberar':'Aguardando Liberação', 'concluido':'Concluído' 
    };

    // --- HTML FINANCEIRO ---
    let financialHtml = '';
    const finStatus = task.financialStatus || 'pendente';
    const btnChangeFin = isStaff ? 
        `<button onclick="window.toggleFinancialStatus()" style="background:transparent; border:1px solid currentColor; border-radius:6px; padding:4px 10px; cursor:pointer; font-size:0.75rem; color:inherit; opacity:0.8;">Mudar</button>` : '';

    if (finStatus === 'pendente') {
        financialHtml = `
            <div class="finance-alert pending">
                <div style="display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-exclamation-triangle" style="font-size:1.2rem;"></i>
                    <div>
                        <div style="font-weight:700;">Pagamento Pendente</div>
                        <div style="font-size:0.8rem; opacity:0.9;">Bloqueia download público</div>
                    </div>
                </div>
                ${btnChangeFin}
            </div>`;
    } else {
        financialHtml = `
            <div class="finance-alert paid">
                <div style="display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-check-circle" style="font-size:1.2rem;"></i>
                    <div>
                        <div style="font-weight:700;">Pagamento Realizado</div>
                        <div style="font-size:0.8rem; opacity:0.9;">Liberado para download</div>
                    </div>
                </div>
                ${btnChangeFin}
            </div>`;
    }

    // --- HTML BOTÕES DE AÇÃO (MODERNO) ---
    let actionsHtml = '';

    if (task.status === 'analise' && isStaff) {
        actionsHtml = `
            <button onclick="window.openReportEditorWrapper()" class="action-btn btn-main-action">
                <i class="fas fa-edit"></i> Preencher Laudo
            </button>
            ${task.report ? `<button onclick="window.exportToWord()" class="action-btn btn-word"><i class="fas fa-eye"></i> Ver Doc</button>` : ''}
        `;
    } 
    else if (task.status === 'liberar') {
        let btnReleaseHtml = canRelease ? 
            `<button onclick="window.finishReportWrapper()" class="action-btn btn-release"><i class="fas fa-check-double"></i> Liberar Laudo</button>` : 
            `<span style="font-size:0.8rem; color:#666; align-self:center;">Aguardando responsável</span>`;

        actionsHtml = `
            <button onclick="window.openReportEditorWrapper()" class="action-btn btn-edit"><i class="fas fa-pen"></i> Corrigir</button>
            <button onclick="window.exportToWord()" class="action-btn btn-word"><i class="fas fa-file-word"></i> Visualizar Doc</button>
            ${btnReleaseHtml}
        `;
    }

    // --- MONTAGEM FINAL DO HTML ---
    const html = `
        <div class="tm-hero-modern ${typeClass}">
            <div class="tm-hero-content">
                <div class="tm-hero-badge"><i class="fas ${typeIcon}"></i> ${typeLabel}</div>
                <h2>${task.animalNome || 'Sem Nome'}</h2>
                <p><i class="fas fa-paw"></i> ${task.especie || 'Espécie não inf.'} &bull; ${task.sexo || '-'} &bull; ${task.idade || '-'}</p>
            </div>
            <div style="text-align:right;">
                <div style="font-size:0.8rem; opacity:0.8; margin-bottom:4px;">STATUS ATUAL</div>
                <div style="background:white; color:#333; padding:5px 12px; border-radius:8px; font-weight:700;">
                    ${statusMap[task.status] || task.status}
                </div>
            </div>
        </div>

        <div class="tm-code-section">
            <div>
                <div class="tm-code-label">Código de Acesso Público</div>
                <div class="tm-code-value">${task.accessCode || "---"}</div>
            </div>
            <div style="text-align:right;">
                <div class="tm-code-label" style="margin-bottom:4px;">Protocolo Interno</div>
                <div style="font-weight:600; color:var(--text-secondary);">${task.protocolo || "---"}</div>
            </div>
            <button class="btn btn-sm btn-secondary" onclick="window.enableEditMode()" style="margin-left:15px;">
                <i class="fas fa-edit"></i> Editar Dados
            </button>
        </div>
        
        ${financialHtml}

        <div class="tm-info-cards">
            <div class="info-card">
                <div class="info-icon"><i class="fas fa-user-tag"></i></div>
                <div class="info-label">Proprietário</div>
                <div class="info-value">${task.proprietario || '-'}</div>
            </div>
            <div class="info-card">
                <div class="info-icon"><i class="fas fa-user-md"></i></div>
                <div class="info-label">Veterinário / Docente</div>
                <div class="info-value">${task.docente || '-'}</div>
            </div>
            <div class="info-card">
                <div class="info-icon"><i class="fas fa-user-graduate"></i></div>
                <div class="info-label">Pós-Graduando</div>
                <div class="info-value">${task.posGraduando || '-'}</div>
            </div>
            <div class="info-card">
                <div class="info-icon"><i class="fas fa-vial"></i></div>
                <div class="info-label">Cassetes (Qtd/Cor)</div>
                <div class="info-value">${task.k7Quantity || 0} un. <span class="tm-hero-modern ${typeClass}"style="font-size:0.8rem; margin-left:5px; padding:2px 6px; border-radius:4px;">${task.k7Color || '-'}</span></div>
            </div>
        </div>
        
        ${actionsHtml ? `<div class="tm-actions-footer">${actionsHtml}</div>` : ''}
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