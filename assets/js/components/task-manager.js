import { db, auth } from '../core.js';
import { 
    doc, getDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

import { generateLaudoPDF } from './docx-generator.js';

console.log("Task Manager Loaded - Mobile Layout Fix");

// --- ESTILOS INJETADOS (Correções Específicas Mobile) ---
const style = document.createElement('style');
style.innerHTML = `
    @media (max-width: 768px) {
        .modal-glass { 
            width: 100% !important; 
            height: 100% !important; 
            max-height: 100vh !important; 
            border-radius: 0 !important; 
            margin: 0 !important; 
            display: flex; 
            flex-direction: column; 
        }
        .tm-hero-modern { flex-direction: column; text-align: center; gap: 15px; }
        .tm-hero-modern > div:last-child { text-align: center !important; width: 100%; }
        
        /* Layout Vertical para as seções principais */
        .tm-code-section { flex-direction: column; gap: 20px; align-items: stretch !important; }
        .tm-code-section > div { text-align: left !important; width: 100%; }
        
        /* CORREÇÃO: Botão de Editar ocupa largura total */
        .tm-code-section > button { margin-left: 0 !important; width: 100%; margin-top: 5px; }

        /* CORREÇÃO CRÍTICA: Botão de Copiar no Mobile */
        .btn-copy-code {
            width: 40px !important; /* Tamanho fixo */
            height: 40px !important;
            padding: 0 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            flex-shrink: 0 !important; /* Impede de encolher ou esticar */
            background: rgba(0,0,0,0.05) !important; /* Fundo leve para área de toque */
            border-radius: 8px !important;
        }

        .tm-code-row {
            display: flex !important;
            align-items: center !important;
            justify-content: flex-start !important;
            gap: 10px !important;
            width: 100%;
        }

        .tm-info-cards { grid-template-columns: 1fr !important; }
        .tm-actions-footer { flex-direction: column; }
        .tm-actions-footer button { width: 100%; }
        .modal-footer { flex-direction: column-reverse; }
        .modal-footer button { width: 100%; }
    }
    
    .btn-copy-code:active { transform: scale(0.9); }
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
let btnSendBackCorrection = null;

if (btnSaveReport && btnSaveReport.parentElement) {
    btnSendBackCorrection = document.createElement('button');
    btnSendBackCorrection.id = 'btn-send-back-correction';
    btnSendBackCorrection.type = 'button';
    btnSendBackCorrection.className = 'btn btn-secondary btn-sm hidden';
    btnSendBackCorrection.innerHTML = '<i class="fas fa-undo"></i> Enviar para Correção';
    btnSendBackCorrection.style.borderColor = '#f59e0b';
    btnSendBackCorrection.style.color = '#92400e';
    btnSendBackCorrection.style.background = '#fffbeb';
    btnSaveReport.parentElement.insertBefore(btnSendBackCorrection, btnSaveReport);
}

let currentTask = null; 
let currentUserData = null; 

function normalizeName(value) {
    return (value || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function getPermissionContext(task = currentTask) {
    const user = currentUserData || {};
    const roles = user._roles || [];
    const normalizedTaskPos = normalizeName(task?.posGraduando);
    const taskPosUid = (task?.posResponsavelUid || '').toString().trim();
    const currentUid = (auth.currentUser?.uid || '').toString().trim();
    const normalizedUserName = normalizeName(user?.name || auth.currentUser?.displayName || '');

    const isAdmin = roles.includes('admin');
    const isProfessor = roles.includes('professor');
    const isPostGrad = roles.some(r => r.includes('graduando'));
    const isStaff = isAdmin || isProfessor || isPostGrad;
    const isPosResponsavelByUid = isPostGrad && !!taskPosUid && !!currentUid && taskPosUid === currentUid;
    const isPosResponsavelByLegacyName = isPostGrad && !taskPosUid && !!normalizedTaskPos && normalizedTaskPos === normalizedUserName;
    const isPosResponsavel = isPosResponsavelByUid || isPosResponsavelByLegacyName;

    return {
        isAdmin,
        isProfessor,
        isPostGrad,
        isStaff,
        isPosResponsavel,
        usesLegacyPosMatch: !taskPosUid,
        canFillReport: isAdmin || isProfessor || isPosResponsavel,
        canDownloadReport: isAdmin || isProfessor || isPosResponsavel,
        canCorrectReport: isAdmin || isProfessor,
        canReleaseInitial: isAdmin || isProfessor,
        canReleaseAfterReview: isAdmin || isProfessor || isPosResponsavel
    };
}

async function fetchCurrentUserData() {
    if (currentUserData) return currentUserData;
    if (!auth.currentUser) return null;
    try {
        const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
        if (userSnap.exists()) {
            currentUserData = userSnap.data();
            // Normaliza role para array lowercase
            if (currentUserData.role) {
                const r = currentUserData.role;
                currentUserData._roles = Array.isArray(r) ? r.map(x => x.toLowerCase()) : [r.toLowerCase()];
            } else {
                currentUserData._roles = [];
            }
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
        document.body.style.overflow = 'hidden';

    } catch (e) { console.error(e); alert("Erro ao abrir: " + e.message); }
}

function closeTaskModal() {
    if(modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
}

if(closeBtn) closeBtn.addEventListener('click', closeTaskModal);

if (modal) {
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeTaskModal();
    });
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
        closeTaskModal();
    }
});

function renderDetails(task) {
    const permission = getPermissionContext(task);
    const { isStaff, canFillReport, canReleaseInitial, canReleaseAfterReview, canDownloadReport, canCorrectReport, isPosResponsavel } = permission;

    if(btnNext) { 
        btnNext.classList.remove('hidden'); 
        btnNext.innerHTML = 'Próxima Etapa <i class="fas fa-arrow-right"></i>'; 
        btnNext.onclick = handleNextStage;
    }
    if(btnPrev) { 
        btnPrev.classList.remove('hidden'); 
        btnPrev.onclick = handlePrevStage; 
    }

    if (task.status === 'laminas_prontas') {
        btnNext.innerHTML = 'Enviar para Análise <i class="fas fa-microscope"></i>';
        btnNext.onclick = () => updateStatus('analise');
    }
    else if (task.status === 'analise') {
        if (isStaff) {
            btnNext.innerHTML = 'Enviar para Liberação <i class="fas fa-paper-plane"></i>';
            btnNext.onclick = () => updateStatus('liberar');
        } else {
            btnNext.classList.add('hidden');
        }
    } 
    else if (task.status === 'liberar' || task.status === 'em_correcao' || task.status === 'revisar_correcoes') {
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
        clivagem: 'Clivagem',
        processamento: 'Processamento',
        laminas_prontas: 'Lâminas Prontas',
        analise: 'Análise',
        liberar: 'Liberar Laudo',
        em_correcao: 'Em Correção',
        revisar_correcoes: 'Corrigido',
        concluido: 'Concluído',
        arquivado: 'Arquivado'
    };

    const correctedBannerBadge = task.status === 'revisar_correcoes'
        ? `<span style="font-size:0.68rem; font-weight:800; color:#92400e; background:#fef3c7; border:1px solid #f59e0b55; padding:3px 9px; border-radius:999px; margin-left:8px;"><i class="fas fa-wrench"></i> Corrigido</span>`
        : '';
    const correctionNeededBadge = task.status === 'em_correcao'
        ? `<span style="font-size:0.68rem; font-weight:800; color:#92400e; background:#fef3c7; border:1px solid #f59e0b55; padding:3px 9px; border-radius:999px; margin-left:8px;"><i class="fas fa-tools"></i> Em Correção</span>`
        : '';

    // --- SEÇÃO FINANCEIRA ---
    let financialHtml = '';
    const finStatus = task.financialStatus || task.situacao || 'pendente';
    
    let alertStyle = '';
    let iconClass = '';
    let statusTitle = '';
    let statusSub = '';
    let btnHtml = '';

    if (finStatus === 'didatico') {
        alertStyle = 'background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a;'; 
        iconClass = 'fa-graduation-cap';
        statusTitle = 'Isento';
        statusSub = 'Interesse Didático';
        btnHtml = ''; 
    } else if (finStatus === 'pago') {
        alertStyle = 'background: #dcfce7; border: 1px solid #86efac; color: #14532d;';
        iconClass = 'fa-check-circle';
        statusTitle = 'Pago';
        statusSub = 'Liberado';
        if(isStaff) {
            btnHtml = `<button onclick="window.toggleFinancialStatus()" style="background:transparent; border:1px solid currentColor; border-radius:4px; padding:2px 8px; font-size:0.65rem; font-weight:700; color:inherit; cursor:pointer; margin-top:3px; white-space:nowrap; opacity:0.8;">REVERTER</button>`;
        }
    } else {
        alertStyle = 'background: #fffbeb; border: 1px solid #fcd34d; color: #78350f;';
        iconClass = 'fa-exclamation-triangle';
        statusTitle = 'Pendente';
        statusSub = 'Bloqueia laudo';
        if(isStaff) {
            btnHtml = `<button onclick="window.toggleFinancialStatus()" style="background:transparent; border:1px solid currentColor; border-radius:4px; padding:2px 8px; font-size:0.65rem; font-weight:700; color:inherit; cursor:pointer; margin-top:3px; white-space:nowrap; opacity:0.8;">PAGAR</button>`;
        }
    }

    financialHtml = `
        <div class="finance-alert" style="${alertStyle} padding:8px 12px; border-radius:8px; margin-top:12px; display:flex; align-items:center; gap:10px;">
            <div style="font-size:1.2rem; flex-shrink:0;"><i class="fas ${iconClass}"></i></div>
            <div style="flex:1; min-width:0; line-height:1.2;">
                <div style="font-weight:800; font-size:0.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${statusTitle}</div>
                <div style="font-size:0.7rem; opacity:0.85; font-weight:600;">${statusSub}</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; flex-shrink:0;">
                ${task.valor && task.valor !== '0,00' ? `<div style="font-size:1rem; font-weight:800; letter-spacing:-0.5px;">R$ ${task.valor}</div>` : ''}
                ${btnHtml}
            </div>
        </div>`;

    // --- BOTÕES DE AÇÃO ---
    let actionsHtml = '';
    if (task.status === 'analise' && canFillReport) {
        actionsHtml = `
            <button onclick="window.openReportEditorWrapper()" class="action-btn btn-main-action"><i class="fas fa-edit"></i> Preencher Laudo</button>
            ${task.report && canDownloadReport ? `<button onclick="window.exportToPDF()" class="action-btn btn-word"><i class="fas fa-file-pdf"></i> Ver PDF</button>` : ''}
        `;
    } 
    else if (task.status === 'liberar') {
        let btnReleaseHtml = canReleaseInitial ? 
            `<button onclick="window.finishReportWrapper()" class="action-btn btn-release"><i class="fas fa-check-double"></i> Liberar Laudo</button>` : 
            `<span style="font-size:0.8rem; color:#666; align-self:center;">Aguardando professor</span>`;

        actionsHtml = `
            ${canCorrectReport ? `<button onclick="window.openReportEditorWrapper()" class="action-btn btn-edit"><i class="fas fa-pen"></i> Corrigir</button>` : ''}
            ${canDownloadReport ? `<button onclick="window.exportToPDF()" class="action-btn btn-word"><i class="fas fa-file-pdf"></i> Visualizar PDF</button>` : ''}
            ${btnReleaseHtml}
        `;
    }
    else if (task.status === 'em_correcao') {
        const correctionHint = permission.isProfessor
            ? `<span style="font-size:0.8rem; color:#991b1b; align-self:center; font-weight:700;">Correção pendente para professor</span>`
            : `<span style="font-size:0.8rem; color:#666; align-self:center;">Aguardando correção do professor</span>`;

        actionsHtml = `
            ${canCorrectReport ? `<button onclick="window.openReportEditorWrapper()" class="action-btn btn-edit"><i class="fas fa-pen"></i> Corrigir</button>` : ''}
            ${canDownloadReport ? `<button onclick="window.exportToPDF()" class="action-btn btn-word"><i class="fas fa-file-pdf"></i> Visualizar PDF</button>` : ''}
            ${correctionHint}
        `;
    }
    else if (task.status === 'revisar_correcoes') {
        let btnReleaseHtml = canReleaseAfterReview
            ? `<button onclick="window.finishReportWrapper()" class="action-btn btn-release"><i class="fas fa-check-double"></i> Liberar Laudo</button>`
            : `<span style="font-size:0.8rem; color:#666; align-self:center;">Aguardando professor ou pós responsável</span>`;

        actionsHtml = `
            ${(isPosResponsavel || canCorrectReport) ? `<button onclick="window.openReportEditorWrapper()" class="action-btn btn-edit"><i class="fas fa-pen"></i> Editar Laudo</button>` : ''}
            ${canDownloadReport ? `<button onclick="window.exportToPDF()" class="action-btn btn-word"><i class="fas fa-file-pdf"></i> Visualizar PDF</button>` : ''}
            ${btnReleaseHtml}
        `;
    }
    else if (task.status === 'concluido') {
         actionsHtml = `
            <button onclick="window.openReportEditorWrapper()" class="action-btn btn-edit"><i class="fas fa-eye"></i> Ver Detalhes</button>
            ${canDownloadReport ? `<button onclick="window.exportToPDF()" class="action-btn btn-word"><i class="fas fa-file-pdf"></i> Baixar PDF</button>` : ''}
        `;
    }

    // --- HTML FINAL DO CARD ---
    const html = `
        <div class="tm-hero-modern ${typeClass}">
            <div class="tm-hero-content">
                <div class="tm-hero-badge"><i class="fas ${typeIcon}"></i> ${typeLabel}${correctedBannerBadge}${correctionNeededBadge}</div>
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
                
                <div class="tm-code-row" style="display:flex; align-items:center; gap:8px;">
                    <div class="tm-code-value" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        ${task.accessCode || "---"}
                    </div>
                    
                    ${task.accessCode ? `
                    <button class="btn-copy-code" onclick="window.copyToClipboard('${task.accessCode}', this)" style="background:transparent; border:none; cursor:pointer; color:var(--text-secondary); padding:4px;" title="Copiar">
                        <i class="far fa-copy" style="font-size:1.1rem;"></i>
                    </button>` : ''}
                </div>
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

window.copyToClipboard = async function(text, btn) {
    if(!text) return;
    try {
        await navigator.clipboard.writeText(text);
        const icon = btn.querySelector('i');
        icon.className = 'fas fa-check';
        icon.style.color = '#10b981'; 
        setTimeout(() => {
            icon.className = 'far fa-copy';
            icon.style.color = '';
        }, 2000);
    } catch(e) { console.error(e); }
}

async function toggleFinancialStatus() {
    if(!currentTask) return;
    const currentStatus = currentTask.financialStatus || 'pendente';
    if(currentStatus === 'didatico') return; 
    
    const newStatus = currentStatus === 'pago' ? 'pendente' : 'pago'; 

    if(!confirm(`Mudar status financeiro para ${newStatus.toUpperCase()}?`)) return;

    try {
        await updateDoc(doc(db, "tasks", currentTask.id), { financialStatus: newStatus });
        currentTask.financialStatus = newStatus;
        renderDetails(currentTask); 
    } catch(e) { console.error(e); alert("Erro ao atualizar financeiro."); }
}

if(btnSaveReport) {
    const persistReport = async ({ sendBackToCorrection = false } = {}) => {
        const permission = getPermissionContext(currentTask);
        if (currentTask?.status === 'analise' && !permission.canFillReport) {
            alert('Somente o dono da tarefa (pós responsável), professor ou admin podem preencher o laudo nesta etapa.');
            return;
        }

        if (currentTask?.status === 'revisar_correcoes' && !permission.canCorrectReport && !permission.isPosResponsavel) {
            alert('Somente o pós responsável, professor ou admin podem editar nesta etapa.');
            return;
        }

        if (sendBackToCorrection && currentTask?.status !== 'revisar_correcoes') {
            alert('Esta ação só está disponível na etapa Corrigido.');
            return;
        }

        if (sendBackToCorrection && !(permission.isPosResponsavel || permission.canCorrectReport)) {
            alert('Somente o pós responsável, professor ou admin podem enviar novamente para correção.');
            return;
        }

        const btn = btnSaveReport;
        const btnRework = btnSendBackCorrection;
        const originalPrimary = btn.innerHTML;
        const originalRework = btnRework ? btnRework.innerHTML : '';

        btn.innerHTML = 'Salvando...'; btn.disabled = true;
        if (btnRework) {
            btnRework.disabled = true;
            btnRework.innerHTML = sendBackToCorrection
                ? '<i class="fas fa-spinner fa-spin"></i> Enviando...'
                : btnRework.innerHTML;
        }

        try {
            const formData = new FormData(document.getElementById('form-report-data'));
            const reportData = Object.fromEntries(formData.entries());
            const patch = {
                report: reportData,
                lastEditor: auth.currentUser.uid
            };

            if ((currentTask?.status === 'liberar' || currentTask?.status === 'em_correcao') && permission.canCorrectReport) {
                patch.status = 'revisar_correcoes';
                patch.correctedBy = auth.currentUser.uid;
                patch.correctedAt = new Date().toISOString();
            }

            if (sendBackToCorrection && currentTask?.status === 'revisar_correcoes') {
                patch.status = 'em_correcao';
                patch.sentBackForCorrectionBy = auth.currentUser.uid;
                patch.sentBackForCorrectionAt = new Date().toISOString();
            }

            await updateDoc(doc(db, "tasks", currentTask.id), { 
                ...patch
            });
            currentTask.report = reportData;
            if (patch.status) currentTask.status = patch.status;
            document.getElementById('report-editor-modal').classList.add('hidden');
            renderDetails(currentTask); 
            if (sendBackToCorrection) {
                alert('Laudo enviado novamente para correção.');
            }
        } catch(e) { alert("Erro ao salvar: " + e.message); } 
        finally {
            btn.innerHTML = originalPrimary || '<i class="fas fa-save"></i> Salvar e Voltar';
            btn.disabled = false;
            if (btnRework) {
                btnRework.innerHTML = originalRework || '<i class="fas fa-undo"></i> Enviar para Correção';
                btnRework.disabled = false;
            }
        }
    };

    btnSaveReport.addEventListener('click', async () => {
        await persistReport({ sendBackToCorrection: false });
    });

    if (btnSendBackCorrection) {
        btnSendBackCorrection.addEventListener('click', async () => {
            if (!confirm('Deseja enviar este laudo novamente para correção do professor?')) return;
            await persistReport({ sendBackToCorrection: true });
        });
    }
}

async function finishReportWrapper() {
    if(!currentTask) return;
    if (currentTask.status === 'em_correcao') {
        alert('Este laudo está em correção e precisa ser corrigido pelo professor antes de liberar.');
        return;
    }

    const permission = getPermissionContext(currentTask);
    const isPostReviewStage = currentTask.status === 'revisar_correcoes';
    const canReleaseInStage = isPostReviewStage
        ? permission.canReleaseAfterReview
        : permission.canReleaseInitial;

    if (!canReleaseInStage) {
        if (isPostReviewStage) {
            alert('Na fase pós-revisão, apenas professor, pós-graduando responsável ou admin podem liberar o laudo.');
        } else {
            alert('Na fase pré-correção, apenas professor ou admin podem liberar o laudo.');
        }
        return;
    }

    if (isPostReviewStage && permission.usesLegacyPosMatch && !permission.isAdmin && !permission.isProfessor) {
        if (!confirm('Este caso ainda usa vínculo por nome do pós responsável (modo legado). Deseja continuar com a liberação?')) return;
    }

    const finStatus = currentTask.financialStatus || 'pendente';
    if (finStatus !== 'pago' && finStatus !== 'didatico') {
        if(!confirm("⚠️ AVISO FINANCEIRO: Status PENDENTE.\nDeseja liberar o laudo mesmo assim?")) return;
    }
    const releasePrompt = isPostReviewStage
        ? "Tem certeza que deseja LIBERAR este laudo após revisão das correções?\nA data será congelada e ele irá para os Concluídos."
        : "Tem certeza que deseja LIBERAR e FINALIZAR este laudo na fase pré-correção?\nA data será congelada e ele irá para os Concluídos.";
    if(!confirm(releasePrompt)) return;

    try {
        const dataCongelada = new Date().toISOString();
        const patch = {
            status: 'concluido',
            releasedBy: auth.currentUser.uid,
            releasedAt: dataCongelada
        };

        if (currentTask.status === 'revisar_correcoes') {
            patch.reviewedBy = auth.currentUser.uid;
            patch.reviewedAt = dataCongelada;
        }

        await updateDoc(doc(db, "tasks", currentTask.id), { 
            ...patch
        });
        alert("Laudo Liberado com Sucesso!"); 
        closeTaskModal();
        if(window.location.reload) window.location.reload(); 
    } catch(e) { console.error(e); alert("Erro ao liberar: " + e.message); }
}

async function exportToPDF() {
    if (!currentTask) return alert("Nenhuma tarefa selecionada.");
    const permission = getPermissionContext(currentTask);
    if (!permission.canDownloadReport) {
        alert('Sem permissão para baixar ou visualizar este laudo.');
        return;
    }

    const form = document.getElementById('form-report-data');
    let finalData = currentTask.report || {};
    if (form && !document.getElementById('report-editor-modal').classList.contains('hidden')) {
        const formData = new FormData(form);
        const formObj = Object.fromEntries(formData.entries());
        finalData = { ...finalData, ...formObj };
    }
    try { await generateLaudoPDF(currentTask, finalData); } catch (e) { alert("Erro PDF: " + e.message); }
}

function syncNecropsyOnlyFields(form) {
    if (!form) return;

    const selectedType = form.querySelector('input[name="tipo_material_radio"]:checked')?.value || currentTask?.type || 'biopsia';
    const showNecropsyFields = selectedType === 'necropsia';

    form.querySelectorAll('[data-necropsia-only="true"]').forEach((row) => {
        row.classList.toggle('hidden', !showNecropsyFields);
    });
}

function bindReportMaterialVisibility(form) {
    if (!form) return;
    form.querySelectorAll('input[name="tipo_material_radio"]').forEach((radio) => {
        radio.addEventListener('change', () => syncNecropsyOnlyFields(form));
    });
    syncNecropsyOnlyFields(form);
}

function openReportEditor(task) {
    const permission = getPermissionContext(task);
    if ((task.status === 'liberar' || task.status === 'em_correcao') && !permission.canCorrectReport) {
        alert('Apenas professor pode corrigir laudos.');
        return;
    }

    if (task.status === 'analise' && !permission.canFillReport) {
        alert('Somente o dono da tarefa (pós responsável), professor ou admin podem preencher o laudo nesta etapa.');
        return;
    }

    if (task.status === 'revisar_correcoes' && !permission.canCorrectReport && !permission.isPosResponsavel) {
        alert('Somente o pós responsável ou professor podem abrir esta revisão.');
        return;
    }

    const reportModal = document.getElementById('report-editor-modal');
    if (!reportModal) return;
    
    const container = document.getElementById('print-area');
    const parentContainer = container.parentElement; 
    if (parentContainer) parentContainer.classList.add('mode-edit');
    container.classList.add('mode-edit');
    container.classList.remove('report-paper'); 

    const rep = task.report || {};
    const canEditInCorrectionReview = task.status === 'revisar_correcoes' && (permission.isPosResponsavel || permission.canCorrectReport);
    const isReadOnly = task.status === 'concluido' || (task.status === 'revisar_correcoes' && !canEditInCorrectionReview);
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
                    <div class="form-col"><label>Clínica / Empresa</label><input type="text" name="clinica_requisitante" class="input-field-sm" value="${rep.clinica_requisitante || task.remetenteClinicaEmpresa || ''}" ${disabledAttr}></div>
                    <div class="form-col"><label>Endereço Completo</label><input type="text" name="endereco_requisitante" class="input-field-sm" value="${rep.endereco_requisitante || task.remetenteEndereco || ''}" ${disabledAttr}></div>
                </div>
                <div class="form-row">
                    <div class="form-col"><label>Telefone / WhatsApp</label><input type="text" name="telefone_requisitante" class="input-field-sm" value="${rep.telefone_requisitante || task.remetenteContato || ''}" ${disabledAttr}></div>
                    <div class="form-col"><label>Email</label><input type="email" name="email_requisitante" class="input-field-sm" value="${rep.email_requisitante || ''}" ${disabledAttr}></div>
                </div>

                <h5 style="color:var(--text-secondary); margin-bottom:10px; margin-top:15px; border-bottom:1px solid #eee;">Proprietário</h5>
                <div class="form-row">
                    <div class="form-col"><label>Endereço Completo</label><input type="text" name="endereco_proprietario" class="input-field-sm" value="${rep.endereco_proprietario || task.proprietarioEndereco || ''}" ${disabledAttr}></div>
                </div>
                <div class="form-row">
                    <div class="form-col"><label>Telefone / WhatsApp</label><input type="text" name="telefone_proprietario" class="input-field-sm" value="${rep.telefone_proprietario || task.proprietarioContato || ''}" ${disabledAttr}></div>
                    <div class="form-col"><label>Email</label><input type="email" name="email_proprietario" class="input-field-sm" value="${rep.email_proprietario || ''}" ${disabledAttr}></div>
                </div>

                <div class="form-section-title"><i class="fas fa-box-open"></i> 1. Dados do Material</div>
                <div class="form-row">
                    <div class="form-col"><label>Material Remetido</label><div class="radio-cards-container"><label><input type="radio" name="tipo_material_radio" value="biopsia" ${isChecked('biopsia', 'tipo_material_radio')} ${disabledAttr}><div class="radio-card-label"><i class="fas fa-microscope"></i> Biópsia</div></label><label><input type="radio" name="tipo_material_radio" value="necropsia" ${isChecked('necropsia', 'tipo_material_radio')} ${disabledAttr}><div class="radio-card-label"><i class="fas fa-skull"></i> Necropsia</div></label></div></div>
                    <div class="form-col"><label>Descrição do Material</label><input type="text" name="tipo_material_desc" class="input-field-sm" value="${rep.tipo_material_desc || ''}" ${disabledAttr}></div>
                </div>
                <div class="form-row" data-necropsia-only="true">
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

    if (btnSendBackCorrection) {
        const showReworkButton = task.status === 'revisar_correcoes' && (permission.isPosResponsavel || permission.canCorrectReport);
        btnSendBackCorrection.classList.toggle('hidden', !showReworkButton);
    }

    bindReportMaterialVisibility(document.getElementById('form-report-data'));

    reportModal.classList.remove('hidden');
}

function handleNextStage() {
    if (!currentTask) return;
    if (currentTask.status === 'clivagem') { openK7FormSmart(currentTask); return; }
    const flow = ['clivagem', 'processamento', 'laminas_prontas', 'analise', 'liberar', 'em_correcao', 'revisar_correcoes', 'concluido'];
    const currIdx = flow.indexOf(currentTask.status);
    if (currIdx >= 0 && currIdx < flow.length - 1) updateStatus(flow[currIdx + 1]);
}

function handlePrevStage() {
    if (!currentTask) return;
    const flow = ['clivagem', 'processamento', 'laminas_prontas', 'analise', 'liberar', 'em_correcao', 'revisar_correcoes', 'concluido'];
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
    btnDelete.addEventListener('click', async () => { if(confirm("Excluir?")) { try { await deleteDoc(doc(db, "tasks", currentTask.id)); closeTaskModal(); } catch(e){} } });
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