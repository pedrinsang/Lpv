import { db, auth } from '../core.js';
import { 
    doc, getDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// ALTERAÇÃO: Importa a nova função de PDF
import { generateLaudoPDF } from './docx-generator.js';

console.log("Task Manager Loaded - vPDF Update");

// --- INJEÇÃO DE ESTILOS MOBILE (MANTIDO) ---
const style = document.createElement('style');
style.innerHTML = `
    @media (max-width: 768px) {
        .modal-glass { width: 95% !important; max-height: 90vh; padding: 1rem !important; margin: 10px auto; overflow-y: auto; }
        .tm-hero-modern { flex-direction: column; text-align: center; gap: 15px; }
        .tm-hero-modern > div:last-child { text-align: center !important; width: 100%; }
        .tm-code-section { flex-direction: column; gap: 15px; align-items: stretch !important; }
        .tm-code-section > div { text-align: left !important; width: 100%; }
        .tm-info-cards { grid-template-columns: 1fr !important; }
        .tm-actions-footer { flex-direction: column; }
        .tm-actions-footer button { width: 100%; }
        .modal-footer { flex-direction: column-reverse; }
        .modal-footer button { width: 100%; }
    }
    .tm-valor-badge span { filter: blur(5px); transition: filter 0.3s ease; }
    .tm-valor-badge.revealed span { filter: none; }
`;
document.head.appendChild(style);

const modal = document.getElementById('task-manager-modal');
const closeBtn = document.getElementById('close-tm-btn');
const viewDetails = document.getElementById('view-details-content');
const viewK7 = document.getElementById('view-k7-form');
const infoGrid = document.getElementById('tm-info-grid'); 
const formK7 = document.getElementById('form-k7');
const reportModal = document.getElementById('report-editor-modal');

const btnNext = document.getElementById('btn-next-stage');
const btnPrev = document.getElementById('btn-prev-stage');
const btnDelete = document.getElementById('btn-delete-task');
const btnSaveReport = document.getElementById('btn-save-report'); 

let currentTask = null; 
let currentUserData = null; 

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

async function openTaskManager(taskId) {
    try {
        await fetchCurrentUserData();
        const docSnap = await getDoc(doc(db, "tasks", taskId));
        if (!docSnap.exists()) return alert("Tarefa não encontrada.");

        currentTask = { id: docSnap.id, ...docSnap.data() };
        renderDetails(currentTask);
        
        if(viewDetails) viewDetails.classList.remove('hidden');
        if(viewK7) viewK7.classList.add('hidden');
        if(reportModal) reportModal.classList.add('hidden'); 
        if(modal) modal.classList.remove('hidden');

    } catch (e) { console.error(e); alert("Erro ao abrir: " + e.message); }
}

if(closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

function renderDetails(task) {
    const user = currentUserData || {};
    const role = user.role || '';
    
    const isStaff = ['professor', 'pós graduando', 'pos-graduando', 'admin'].includes(role);
    const canRelease = role === 'admin' || role === 'professor' || role.includes('graduando');

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
        btnNext.classList.add('hidden'); 
        btnPrev.classList.remove('hidden');
    }
    else if (task.status === 'clivagem') {
        if(btnPrev) btnPrev.classList.add('hidden');
    }

    const typeClass = task.type === 'necropsia' ? 'necropsia' : 'biopsia';
    const typeIcon = task.type === 'necropsia' ? 'fa-skull' : 'fa-microscope';
    const typeLabel = task.type === 'necropsia' ? 'Necropsia' : 'Biópsia';
    
    const statusMap = { 
        'clivagem':'Clivagem', 'processamento':'Processamento', 'emblocamento':'Emblocamento', 
        'corte':'Corte', 'coloracao':'Coloração', 'analise':'Análise', 
        'liberar':'Aguardando Liberação', 'concluido':'Concluído' 
    };

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
                <div style="display:flex; align-items:center; gap:8px;">
                    ${task.valor ? `<span class="tm-valor-badge" onclick="this.classList.toggle('revealed')" style="cursor:pointer; font-size:0.85rem; font-weight:700; user-select:none;" title="Clique para ver"><i class="fas fa-eye"></i> <span style="filter:blur(5px); transition:filter 0.3s;">R$ ${task.valor}</span></span>` : ''}
                    ${btnChangeFin}
                </div>
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
                <div style="display:flex; align-items:center; gap:8px;">
                    ${task.valor ? `<span class="tm-valor-badge" onclick="this.classList.toggle('revealed')" style="cursor:pointer; font-size:0.85rem; font-weight:700; user-select:none;" title="Clique para ver"><i class="fas fa-eye"></i> <span style="filter:blur(5px); transition:filter 0.3s;">R$ ${task.valor}</span></span>` : ''}
                    ${btnChangeFin}
                </div>
            </div>`;
    }

    // ALTERAÇÃO: Botões agora chamam exportToPDF e têm ícone de PDF
    let actionsHtml = '';
    if (task.status === 'analise' && isStaff) {
        actionsHtml = `
            <button onclick="window.openReportEditorWrapper()" class="action-btn btn-main-action"><i class="fas fa-edit"></i> Preencher Laudo</button>
            ${task.report ? `<button onclick="window.exportToPDF()" class="action-btn btn-word"><i class="fas fa-file-pdf"></i> Ver PDF</button>` : ''}
        `;
    } 
    else if (task.status === 'liberar') {
        let btnReleaseHtml = canRelease ? 
            `<button onclick="window.finishReportWrapper()" class="action-btn btn-release"><i class="fas fa-check-double"></i> Liberar Laudo</button>` : 
            `<span style="font-size:0.8rem; color:#666; align-self:center;">Aguardando responsável</span>`;

        actionsHtml = `
            <button onclick="window.openReportEditorWrapper()" class="action-btn btn-edit"><i class="fas fa-pen"></i> Corrigir</button>
            <button onclick="window.exportToPDF()" class="action-btn btn-word"><i class="fas fa-file-pdf"></i> Visualizar PDF</button>
            ${btnReleaseHtml}
        `;
    }
    else if (task.status === 'concluido') {
         actionsHtml = `
            <button onclick="window.openReportEditorWrapper()" class="action-btn btn-edit"><i class="fas fa-eye"></i> Ver Detalhes</button>
            <button onclick="window.exportToPDF()" class="action-btn btn-word"><i class="fas fa-file-pdf"></i> Baixar PDF</button>
        `;
    }

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
            
            <button class="btn btn-sm btn-secondary" onclick="window.triggerEditEntry()" style="margin-left:15px;">
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
                <div class="info-value" style="display:flex; align-items:center; gap:8px;">
                    ${task.k7Quantity || 0} un. <span class="tm-hero-modern ${typeClass}"style="font-size:0.8rem; margin-left:5px; padding:2px 6px; border-radius:4px;">${task.k7Color || '-'}</span>
                    ${isStaff ? `<button onclick="window.openK7Edit()" style="background:transparent; border:1px solid var(--text-tertiary); border-radius:6px; padding:2px 8px; cursor:pointer; font-size:0.7rem; color:var(--text-secondary); margin-left:auto;" title="Editar K7"><i class="fas fa-pen"></i></button>` : ''}
                </div>
            </div>
        </div>
        
        ${actionsHtml ? `<div class="tm-actions-footer">${actionsHtml}</div>` : ''}
    `;

    infoGrid.innerHTML = html;
}

async function toggleFinancialStatus() {
    if(!currentTask) return;
    const currentStatus = currentTask.financialStatus || 'pendente';
    const newStatus = currentStatus === 'pago' ? 'pendente' : 'pago'; 

    if(!confirm(`Mudar status financeiro de ${currentStatus.toUpperCase()} para ${newStatus.toUpperCase()}?`)) return;

    try {
        await updateDoc(doc(db, "tasks", currentTask.id), { financialStatus: newStatus });
        currentTask.financialStatus = newStatus;
        renderDetails(currentTask); 
    } catch(e) { console.error(e); alert("Erro ao atualizar financeiro."); }
}

if(btnSaveReport) {
    btnSaveReport.addEventListener('click', async () => {
        const btn = btnSaveReport;
        btn.innerHTML = 'Salvando...'; btn.disabled = true;
        try {
            const formData = new FormData(document.getElementById('form-report-data'));
            const reportData = Object.fromEntries(formData.entries());
            await updateDoc(doc(db, "tasks", currentTask.id), { 
                report: reportData, 
                lastEditor: auth.currentUser.uid 
            });
            currentTask.report = reportData;
            document.getElementById('report-editor-modal').classList.add('hidden');
            renderDetails(currentTask); 
        } catch(e) { alert("Erro ao salvar: " + e.message); } 
        finally { btn.innerHTML = '<i class="fas fa-save"></i> Salvar e Voltar'; btn.disabled = false; }
    });
}

async function finishReportWrapper() {
    if(!currentTask) return;
    const finStatus = currentTask.financialStatus || 'pendente';
    if (finStatus !== 'pago' && finStatus !== 'isento') {
        if(!confirm("⚠️ AVISO FINANCEIRO: Status PENDENTE.\nDeseja liberar o laudo mesmo assim?")) return;
    }
    if(!confirm("Tem certeza que deseja LIBERAR e FINALIZAR este laudo?\nA data será congelada e ele irá para os Concluídos.")) return;

    try {
        const dataCongelada = new Date().toISOString();
        await updateDoc(doc(db, "tasks", currentTask.id), { 
            status: 'concluido', 
            releasedBy: auth.currentUser.uid, 
            releasedAt: dataCongelada 
        });
        alert("Laudo Liberado com Sucesso!"); 
        modal.classList.add('hidden'); 
        if(window.location.reload) window.location.reload(); 
    } catch(e) { console.error(e); alert("Erro ao liberar: " + e.message); }
}

// ALTERAÇÃO: Função agora chama generateLaudoPDF
async function exportToPDF() {
    if (!currentTask) return alert("Nenhuma tarefa selecionada.");
    const form = document.getElementById('form-report-data');
    let finalData = currentTask.report || {};
    if (form && !document.getElementById('report-editor-modal').classList.contains('hidden')) {
        const formData = new FormData(form);
        const formObj = Object.fromEntries(formData.entries());
        finalData = { ...finalData, ...formObj };
    }
    // Mudança de nome e função
    try { await generateLaudoPDF(currentTask, finalData); } catch (e) { alert("Erro PDF: " + e.message); }
}

function openReportEditor(task) {
    const reportModal = document.getElementById('report-editor-modal');
    if (!reportModal) return;
    
    const container = document.getElementById('print-area');
    const parentContainer = container.parentElement; 
    if (parentContainer) parentContainer.classList.add('mode-edit');
    container.classList.add('mode-edit');
    container.classList.remove('report-paper'); 

    const rep = task.report || {};
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
                
                <div class="form-section-title"><i class="fas fa-address-book"></i> Dados de Contato e Localização</div>
                
                <h5 style="color:var(--text-secondary); margin-bottom:10px; border-bottom:1px solid #eee;">Requisitante (Veterinário/Clínica)</h5>
                <div class="form-row">
                    <div class="form-col"><label>Clínica / Empresa</label><input type="text" name="clinica_requisitante" class="input-field-sm" value="${rep.clinica_requisitante || ''}" ${disabledAttr}></div>
                    <div class="form-col"><label>Endereço Completo</label><input type="text" name="endereco_requisitante" class="input-field-sm" value="${rep.endereco_requisitante || ''}" ${disabledAttr}></div>
                </div>
                <div class="form-row">
                    <div class="form-col"><label>Telefone / WhatsApp</label><input type="text" name="telefone_requisitante" class="input-field-sm" value="${rep.telefone_requisitante || ''}" ${disabledAttr}></div>
                    <div class="form-col"><label>Email</label><input type="email" name="email_requisitante" class="input-field-sm" value="${rep.email_requisitante || ''}" ${disabledAttr}></div>
                </div>

                <h5 style="color:var(--text-secondary); margin-bottom:10px; margin-top:15px; border-bottom:1px solid #eee;">Proprietário</h5>
                <div class="form-row">
                    <div class="form-col"><label>Endereço Completo</label><input type="text" name="endereco_proprietario" class="input-field-sm" value="${rep.endereco_proprietario || ''}" ${disabledAttr}></div>
                </div>
                <div class="form-row">
                    <div class="form-col"><label>Telefone / WhatsApp</label><input type="text" name="telefone_proprietario" class="input-field-sm" value="${rep.telefone_proprietario || ''}" ${disabledAttr}></div>
                    <div class="form-col"><label>Email</label><input type="email" name="email_proprietario" class="input-field-sm" value="${rep.email_proprietario || ''}" ${disabledAttr}></div>
                </div>

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
    
    const btnDown = document.getElementById('btn-download-word');
    if(btnDown) btnDown.classList.add('hidden');
    reportModal.classList.remove('hidden');
}

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
        renderDetails(currentTask); 
    } catch (e) { alert("Erro ao mover."); }
}

function openK7FormSmart(task) {
    viewDetails.classList.add('hidden'); viewK7.classList.remove('hidden');
    
    const currentColor = task.k7Color || (task.type === 'necropsia' ? 'azul' : 'rosa');
    const currentQty = task.k7Quantity || 1;
    const isNecro = task.type === 'necropsia';
    
    // Restringir cores: necropsia = azul/branco, biópsia = rosa/branco
    const mainColor = isNecro ? 'azul' : 'rosa';
    const mainLabel = isNecro ? 'Azul' : 'Rosa';
    const mainBg = isNecro ? '#3b82f6' : '#ec4899';
    
    const optionsHTML = `
        <label class="k7-color-btn ${currentColor === mainColor ? 'selected' : ''}" style="--btn-color: ${mainBg};">
            <input type="radio" name="k7Color" value="${mainColor}" ${currentColor === mainColor ? 'checked' : ''}>
            <span class="k7-color-circle" style="background:${mainBg};"></span>
            <span>${mainLabel}</span>
        </label>
        <label class="k7-color-btn ${currentColor === 'branco' ? 'selected' : ''}" style="--btn-color: #94a3b8;">
            <input type="radio" name="k7Color" value="branco" ${currentColor === 'branco' ? 'checked' : ''}>
            <span class="k7-color-circle" style="background:#f1f5f9; border:2px solid #cbd5e1;"></span>
            <span>Branco</span>
        </label>
    `;
    
    if(formK7) {
        formK7.innerHTML = `
            <style>
                .k7-color-btn {
                    display: flex; align-items: center; gap: 10px;
                    padding: 12px 20px; border-radius: 12px; cursor: pointer;
                    border: 2px solid var(--border-glass); background: var(--bg-glass);
                    transition: all 0.25s ease; user-select: none; flex: 1;
                }
                .k7-color-btn input { display: none; }
                .k7-color-btn .k7-color-circle {
                    width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
                    transition: transform 0.25s ease, box-shadow 0.25s ease;
                }
                .k7-color-btn span:last-child { font-weight: 600; font-size: 0.95rem; color: var(--text-primary); }
                .k7-color-btn:hover { border-color: var(--btn-color); background: rgba(0,0,0,0.03); }
                .k7-color-btn:hover .k7-color-circle { transform: scale(1.1); }
                .k7-color-btn.selected {
                    border-color: var(--btn-color);
                    background: linear-gradient(135deg, rgba(0,0,0,0.02), rgba(0,0,0,0.06));
                    box-shadow: 0 0 0 3px color-mix(in srgb, var(--btn-color) 25%, transparent);
                }
                .k7-color-btn.selected .k7-color-circle {
                    transform: scale(1.2);
                    box-shadow: 0 0 12px var(--btn-color);
                }
                .k7-color-btn.selected span:last-child { color: var(--btn-color); font-weight: 800; }
                .k7-color-btn.selected::after {
                    content: '\\f00c'; font-family: 'Font Awesome 6 Free'; font-weight: 900;
                    margin-left: auto; color: var(--btn-color); font-size: 1.1rem;
                }
            </style>
            <div class="form-group"><label style="font-weight:700; margin-bottom:8px; display:block;">Quantidade de Cassetes</label><input type="number" id="k7-quantity" class="input-field" min="1" value="${currentQty}" style="font-size:1.2rem; text-align:center; max-width:120px;"></div>
            <div class="form-group"><label style="font-weight:700; margin-bottom:8px; display:block;">Cor do Cassete</label><div style="display:flex; gap:12px;">${optionsHTML}</div></div>
            <div class="modal-footer"><button type="button" id="btn-cancel-k7-dyn" class="btn btn-secondary">Voltar</button><button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Salvar</button></div>
        `;
        
        // Toggle visual selection on click
        formK7.querySelectorAll('.k7-color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                formK7.querySelectorAll('.k7-color-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });
        
        document.getElementById('btn-cancel-k7-dyn').addEventListener('click', () => { viewK7.classList.add('hidden'); viewDetails.classList.remove('hidden'); });
        formK7.onsubmit = async (e) => { 
            e.preventDefault(); 
            const qty = parseInt(document.getElementById('k7-quantity').value, 10) || 1; 
            const color = document.querySelector('input[name="k7Color"]:checked').value; 
            const updateData = { k7Quantity: qty, k7Color: color };
            if (currentTask.status === 'clivagem') updateData.status = 'processamento';
            try { 
                await updateDoc(doc(db, "tasks", currentTask.id), updateData); 
                Object.assign(currentTask, updateData);
                renderDetails(currentTask); 
                viewK7.classList.add('hidden'); 
                viewDetails.classList.remove('hidden'); 
            } catch(err){ alert("Erro: " + err.message); } 
        };
    }
}

if(btnDelete) {
    btnDelete.addEventListener('click', async () => { if(confirm("Excluir?")) { try { await deleteDoc(doc(db, "tasks", currentTask.id)); modal.classList.add('hidden'); } catch(e){} } });
}

function openReportEditorWrapper() { openReportEditor(currentTask); }

window.triggerEditEntry = function() {
    if(currentTask && window.openEditEntry) {
        const tmModal = document.getElementById('task-manager-modal');
        if(tmModal) tmModal.classList.add('hidden');
        window.openEditEntry(currentTask);
    } else {
        console.error("Não foi possível editar: Task ou função global não encontrada.");
    }
}

window.openTaskManager = openTaskManager;
window.exportToPDF = exportToPDF;
window.openReportEditorWrapper = openReportEditorWrapper;
window.finishReportWrapper = finishReportWrapper;
window.toggleFinancialStatus = toggleFinancialStatus;
window.openK7Edit = function() { if(currentTask) openK7FormSmart(currentTask); };